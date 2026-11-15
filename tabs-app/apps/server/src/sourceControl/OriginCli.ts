/**
 * Requests borrow the `origin` CLI's session token and go straight to `api.cursor.com/v1/origin`:
 * spawning the CLI per request costs about 0.8s, a warm request about 0.2s.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { decodeJsonResult } from "@tabs/shared/schemaJson";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import type { SourceControlProviderContext } from "./SourceControlProvider.ts";
import { originRepositoryFromRemote } from "./originPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MISSING_TOKEN_TTL_MS = 10_000;
const SESSION_TTL_MS = 5 * 60_000;
const MAX_OUTPUT_BYTES = 8_000_000;
const API_BASE_URL = "https://api.cursor.com";

export const ORIGIN_COMMAND = "origin";

export class OriginCliError extends Schema.TaggedError<OriginCliError>()("OriginCliError", {
  operation: Schema.String,
  cwd: Schema.String,
  detail: Schema.String,
  reason: Schema.Literals([
    "missing-tool",
    "unauthenticated",
    "rate-limited",
    "not-found",
    "invalid-response",
    "failed",
  ]),
  httpStatus: Schema.optional(Schema.Int),
  /** When a rate-limited request may be sent again, in epoch milliseconds. */
  retryAt: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Cursor Origin failed in ${this.operation}: ${this.detail}`;
  }
}

const OriginAuthStatusSchema = Schema.Struct({
  authenticated: Schema.Boolean,
  tokenValid: Schema.optional(Schema.Boolean),
  account: Schema.optional(
    Schema.NullOr(Schema.Struct({ email: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
});
type OriginAuthStatus = typeof OriginAuthStatusSchema.Type;

export function parseOriginAuthStatus(raw: string): OriginAuthStatus | null {
  const decoded = decodeJsonResult(OriginAuthStatusSchema)(raw);
  return Result.isSuccess(decoded) ? decoded.success : null;
}

export function originAccount(status: OriginAuthStatus | null): string | null {
  if (!status?.authenticated || status.tokenValid === false) return null;
  return status.account?.email?.trim() || null;
}

const OriginNamespaceListSchema = Schema.Struct({
  namespaces: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({ namespace: Schema.Struct({ slug: Schema.String, type: Schema.String }) }),
      ),
    ),
  ),
});

export function originRepositoryPath(repository: string): string {
  return `/v1/origin/repos/${repository.split("/").map(encodeURIComponent).join("/")}`;
}

function errorBodyMessage(body: string): string | null {
  const decoded = decodeJsonResult(
    Schema.Struct({
      message: Schema.optional(Schema.String),
      error: Schema.optional(
        Schema.Union([Schema.String, Schema.Struct({ message: Schema.optional(Schema.String) })]),
      ),
    }),
  )(body);
  if (Result.isFailure(decoded)) return null;
  const { message, error } = decoded.success;
  return message ?? (typeof error === "string" ? error : error?.message) ?? null;
}

const UNAUTHENTICATED_DETAIL =
  "Cursor Origin CLI is not signed in. Run `origin auth login` and retry.";

export function classifyOriginFailure(input: {
  readonly operation: string;
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
}): OriginCliError {
  const text = `${input.stderr}\n${input.stdout}`;
  const reason: OriginCliError["reason"] =
    /not authenticated|not (?:logged|signed) in|origin auth login|unauthenticated|unauthorized/iu.test(
      text,
    )
      ? "unauthenticated"
      : /rate.?limit|too many requests|\b429\b/iu.test(text)
        ? "rate-limited"
        : /\bnot[_ ]found\b/iu.test(text)
          ? "not-found"
          : "failed";
  const firstLine = input.stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return new OriginCliError({
    operation: input.operation,
    cwd: input.cwd,
    reason,
    detail:
      reason === "unauthenticated"
        ? UNAUTHENTICATED_DETAIL
        : input.operation === "authToken"
          ? "Cursor Origin CLI could not hand over a session token. Check `origin auth status`."
          : (errorBodyMessage(input.stdout) ??
            firstLine?.replace(/^Error:\s*/u, "") ??
            "Cursor Origin CLI command failed."),
  });
}

export function classifyOriginResponse(input: {
  readonly operation: string;
  readonly cwd: string;
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly now?: number;
}): OriginCliError {
  const reason: OriginCliError["reason"] =
    input.status === 401
      ? "unauthenticated"
      : input.status === 429
        ? "rate-limited"
        : input.status === 404
          ? "not-found"
          : "failed";
  const now = input.now ?? Date.now();
  const reset = Number(input.headers?.["x-ratelimit-reset"]) * 1_000;
  const retryAfter = Number(input.headers?.["retry-after"]);
  const retryAt =
    reason !== "rate-limited"
      ? undefined
      : Number.isFinite(retryAfter) && retryAfter >= 0
        ? now + retryAfter * 1_000
        : Number.isFinite(reset) && reset > now
          ? reset
          : undefined;
  return new OriginCliError({
    operation: input.operation,
    cwd: input.cwd,
    reason,
    httpStatus: input.status,
    ...(retryAt === undefined ? {} : { retryAt }),
    detail:
      reason === "unauthenticated"
        ? UNAUTHENTICATED_DETAIL
        : reason === "rate-limited"
          ? "Cursor Origin API rate limit exceeded."
          : (errorBodyMessage(input.body) ??
            `Cursor Origin request failed (HTTP ${input.status}).`),
  });
}

interface OriginApiInput {
  readonly cwd: string;
  readonly operation: string;
  /** A full `/v1/origin/...` path, query included. */
  readonly path: string;
  readonly method?: "GET" | "POST" | "PATCH";
  readonly body?: unknown;
}

export class OriginCli extends Context.Service<
  OriginCli,
  {
    readonly execute: (input: {
      readonly cwd: string;
      readonly operation: string;
      readonly args: ReadonlyArray<string>;
    }) => Effect.Effect<string, OriginCliError>;
    readonly api: <S extends Schema.Codec<unknown, unknown, never, never>>(
      input: OriginApiInput,
      schema: S,
    ) => Effect.Effect<S["Type"], OriginCliError>;
    /** The signed-in account, held until the session's token is refused. */
    readonly viewer: (cwd: string) => Effect.Effect<string, OriginCliError>;
    readonly personalNamespace: (cwd: string) => Effect.Effect<string, OriginCliError>;
    readonly resolveRepository: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProviderContext;
    }) => Effect.Effect<string, OriginCliError>;
  }
>()("tabs/sourceControl/OriginCli") {}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;
  const httpClient = yield* HttpClient.HttpClient;

  const run = (input: { cwd: string; operation: string; args: ReadonlyArray<string> }) =>
    process
      .run({
        operation: `CursorOrigin.${input.operation}`,
        command: ORIGIN_COMMAND,
        args: input.args,
        cwd: input.cwd,
        env: { ...globalThis.process.env, NO_COLOR: "1" },
        allowNonZeroExit: true,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
      .pipe(
        Effect.mapError((cause) => {
          const missing = /ENOENT|not.?found/iu.test(String(cause));
          return new OriginCliError({
            operation: input.operation,
            cwd: input.cwd,
            reason: missing ? "missing-tool" : "failed",
            detail: missing
              ? "Cursor Origin CLI (`origin`) is required but not available on PATH."
              : "Cursor Origin CLI could not be run.",
            cause,
          });
        }),
      );

  const execute: OriginCli["Service"]["execute"] = Effect.fn("OriginCli.execute")(
    function* (input) {
      const result = yield* run(input);
      if (result.exitCode !== 0) return yield* classifyOriginFailure({ ...input, ...result });
      return result.stdout;
    },
  );

  // The CLI's session token is kept a few minutes or until Origin refuses it.
  let token: Result.Result<Redacted.Redacted<string>, OriginCliError> | null = null;
  let tokenExpiresAt = 0;
  const currentToken = (cwd: string) =>
    Effect.gen(function* () {
      if (token !== null && tokenExpiresAt > Date.now()) return yield* Effect.fromResult(token);
      token = yield* execute({ cwd, operation: "authToken", args: ["auth", "token"] }).pipe(
        Effect.flatMap((stdout) => {
          const read = stdout.trim();
          return read.length === 0
            ? Effect.fail(
                new OriginCliError({
                  operation: "authToken",
                  cwd,
                  reason: "unauthenticated",
                  detail: UNAUTHENTICATED_DETAIL,
                }),
              )
            : Effect.succeed(Redacted.make(read));
        }),
        Effect.result,
      );
      tokenExpiresAt =
        Date.now() + (Result.isSuccess(token) ? SESSION_TTL_MS : MISSING_TOKEN_TTL_MS);
      return yield* Effect.fromResult(token);
    });

  const send = (input: OriginApiInput, bearer: string) => {
    const request = HttpClientRequest.make(input.method ?? "GET")(
      `${API_BASE_URL}${input.path}`,
    ).pipe(HttpClientRequest.bearerToken(bearer), HttpClientRequest.acceptJson);
    return httpClient
      .execute(
        input.body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, input.body),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.text.pipe(Effect.map((body) => ({ response, body }))),
        ),
        Effect.timeout(DEFAULT_TIMEOUT_MS),
        Effect.mapError(
          (cause) =>
            new OriginCliError({
              operation: input.operation,
              cwd: input.cwd,
              reason: "failed",
              detail: "Could not reach Cursor Origin.",
              cause,
            }),
        ),
      );
  };

  const api: OriginCli["Service"]["api"] = Effect.fn("OriginCli.api")(function* (input, schema) {
    const bearer = yield* currentToken(input.cwd);
    let exchange = yield* send(input, Redacted.value(bearer));
    // A refused token may have been rotated by `origin auth login`; read it again once.
    if (exchange.response.status === 401) {
      if (token !== null && Result.isSuccess(token) && token.success === bearer) token = null;
      exchange = yield* send(input, Redacted.value(yield* currentToken(input.cwd)));
    }
    if (exchange.response.status < 200 || exchange.response.status >= 300)
      return yield* classifyOriginResponse({
        operation: input.operation,
        cwd: input.cwd,
        status: exchange.response.status,
        body: exchange.body,
        headers: exchange.response.headers as Readonly<Record<string, string | undefined>>,
      });
    const body = exchange.body.trim().length === 0 ? "{}" : exchange.body;
    return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(body).pipe(
      Effect.mapError(
        (cause) =>
          new OriginCliError({
            operation: input.operation,
            cwd: input.cwd,
            reason: "invalid-response",
            detail: "Cursor Origin returned a response this version cannot read.",
            cause,
          }),
      ),
    );
  });

  const resolveRepository: OriginCli["Service"]["resolveRepository"] = Effect.fn(
    "OriginCli.resolveRepository",
  )(function* (input) {
    const remoteUrl =
      input.context?.remoteUrl ??
      (yield* process
        .run({
          operation: "OriginCli.resolveRepository",
          command: "git",
          args: ["remote", "get-url", "origin"],
          cwd: input.cwd,
          allowNonZeroExit: true,
          timeoutMs: 5_000,
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.orElseSucceed(() => ""),
        ));
    const repository = remoteUrl ? originRepositoryFromRemote(remoteUrl) : null;
    if (!repository)
      return yield* new OriginCliError({
        operation: "resolveRepository",
        cwd: input.cwd,
        reason: "not-found",
        detail: "This checkout has no Cursor Origin remote.",
      });
    return repository;
  });

  const personalNamespace: OriginCli["Service"]["personalNamespace"] = (cwd) =>
    api(
      { cwd, operation: "personalNamespace", path: "/v1/origin/namespaces" },
      OriginNamespaceListSchema,
    ).pipe(
      Effect.flatMap((list) => {
        const slug = list.namespaces?.find((entry) => entry.namespace.type === "user")?.namespace
          .slug;
        return slug
          ? Effect.succeed(slug)
          : Effect.fail(
              new OriginCliError({
                operation: "personalNamespace",
                cwd,
                reason: "not-found",
                detail:
                  "This Cursor account has no Origin namespace. Claim one at cursor.com/codebase.",
              }),
            );
      }),
    );

  let viewerAccount: string | null = null;
  let viewerExpiresAt = 0;
  const viewer: OriginCli["Service"]["viewer"] = Effect.fn("OriginCli.viewer")(function* (cwd) {
    if (viewerAccount !== null && viewerExpiresAt > Date.now()) return viewerAccount;
    const result = yield* run({ cwd, operation: "authStatus", args: ["auth", "status", "--json"] });
    const status = parseOriginAuthStatus(result.stdout);
    if (status === null && result.exitCode !== 0)
      return yield* classifyOriginFailure({ cwd, operation: "authStatus", ...result });
    const account = originAccount(status);
    if (account === null)
      return yield* new OriginCliError({
        operation: "viewer",
        cwd,
        reason: "unauthenticated",
        detail: UNAUTHENTICATED_DETAIL,
      });
    viewerAccount = account;
    viewerExpiresAt = Date.now() + SESSION_TTL_MS;
    return account;
  });

  return OriginCli.of({ execute, api, viewer, personalNamespace, resolveRepository });
});

export const layer = Layer.effect(OriginCli, make);
