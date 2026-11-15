import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { parseStoredReference } from "@tabs/shared/secretProviders/storedReference";
import { SecretResolver } from "../secrets/SecretResolverCore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { gitCafeHost } from "./gitCafeHosts.ts";

const TOKEN_TTL_MS = 5 * 60_000;
const MISSING_TTL_MS = 10_000;
const DEFAULT_HOST = "git.cafe";

export interface GitCafeCredential {
  readonly host: string;
  readonly token: Redacted.Redacted<string>;
  readonly source: "settings" | "env" | "cafe";
}

export class GitCafeCliMissingError extends Schema.TaggedError<GitCafeCliMissingError>()(
  "GitCafeCliMissingError",
  { host: Schema.String },
) {
  override get message(): string {
    return `No GitCafe credential for ${this.host}: set CAFE_TOKEN, or install the GitCafe CLI and run \`cafe auth login\`.`;
  }
}

export class GitCafeNotSignedInError extends Schema.TaggedError<GitCafeNotSignedInError>()(
  "GitCafeNotSignedInError",
  { host: Schema.String },
) {
  override get message(): string {
    return `No GitCafe credential for ${this.host}: run \`cafe auth login --host https://${this.host}/api\`.`;
  }
}

export class GitCafeCliFailedError extends Schema.TaggedError<GitCafeCliFailedError>()(
  "GitCafeCliFailedError",
  { host: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The GitCafe CLI could not hand over a credential for ${this.host}. Check \`cafe auth status\` on the server.`;
  }
}

export type GitCafeCredentialUnavailableError =
  | GitCafeCliMissingError
  | GitCafeNotSignedInError
  | GitCafeCliFailedError;

export class GitCafeCredentials extends Context.Service<
  GitCafeCredentials,
  {
    readonly get: (
      host: string,
    ) => Effect.Effect<GitCafeCredential, GitCafeCredentialUnavailableError>;
    readonly invalidate: (host: string) => Effect.Effect<void>;
  }
>()("tabs/sourceControl/GitCafeCredentials") {}

/** CAFE_TOKEN only applies to CAFE_HOST (default git.cafe), so it never reaches another host. */
export function environmentToken(
  host: string,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const configured = env.CAFE_HOST?.trim();
  const configuredHost = configured
    ? URL.parse(configured.includes("://") ? configured : `https://${configured}`)?.host
    : DEFAULT_HOST;
  if (configuredHost?.toLowerCase() !== host.trim().toLowerCase()) return null;
  return env.CAFE_TOKEN?.trim() || null;
}

function credentialPassword(output: string): string | null {
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("password=")) return line.slice("password=".length).trim() || null;
  }
  return null;
}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const resolver = yield* Effect.serviceOption(SecretResolver);
  const cache = new Map<
    string,
    {
      readonly expires: number;
      readonly value: GitCafeCredential | GitCafeCredentialUnavailableError;
    }
  >();

  /** `cafe` has no auth-token command; its credential helper keeps tokens out of argv and logs. */
  const fromCafe = (host: string) =>
    process
      .run({
        operation: "GitCafeCredentials.get",
        command: "cafe",
        args: ["auth", "http", "credential", "--host", `https://${host}/api`, "get"],
        cwd: globalThis.process.cwd(),
        stdin: `protocol=https\nhost=${host}\n\n`,
        env: { ...globalThis.process.env, CAFE_NO_UPDATE_CHECK: "1" },
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.mapError((error): GitCafeCredentialUnavailableError => {
          const cause = (error as { readonly cause?: unknown }).cause;
          const code = (cause as { readonly code?: string } | undefined)?.code;
          return code === "ENOENT" || /not.?found|ENOENT/iu.test(String(error))
            ? new GitCafeCliMissingError({ host })
            : error._tag === "VcsProcessExitError"
              ? new GitCafeNotSignedInError({ host })
              : new GitCafeCliFailedError({ host, cause: error });
        }),
        Effect.flatMap((output) => {
          const token = credentialPassword(output.stdout);
          return token === null
            ? Effect.fail(
                new GitCafeNotSignedInError({ host }) as GitCafeCredentialUnavailableError,
              )
            : Effect.succeed(token);
        }),
      );

  const lookup = Effect.fn("GitCafeCredentials.lookup")(function* (host: string) {
    const fromEnv = environmentToken(host, globalThis.process.env);
    const token = fromEnv ?? (yield* fromCafe(host));
    return {
      host,
      token: Redacted.make(token),
      source: fromEnv !== null ? "env" : "cafe",
    } satisfies GitCafeCredential;
  });

  return GitCafeCredentials.of({
    get: Effect.fn("GitCafeCredentials.get")(function* (host: string) {
      const key = host.trim().toLowerCase();
      // A token saved in settings applies to git.cafe only, and is read on every request so a
      // change needs no restart.
      if (key === DEFAULT_HOST) {
        const saved = yield* serverSettings.getSettings.pipe(
          Effect.map((settings) => settings.gitcafe.token.trim()),
          Effect.orElseSucceed(() => ""),
          // A reference is read from its secret provider each time, so a rotated secret applies.
          Effect.flatMap((token) => {
            const reference = parseStoredReference(token);
            if (reference === null) return Effect.succeed(token);
            return resolver._tag === "Some"
              ? resolver.value.read([reference]).pipe(Effect.map(([value]) => value?.trim() ?? ""))
              : Effect.succeed("");
          }),
        );
        if (saved.length > 0)
          return {
            host: key,
            token: Redacted.make(saved),
            source: "settings",
          } satisfies GitCafeCredential;
      }
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) {
        return "token" in hit.value ? hit.value : yield* Effect.fail(hit.value);
      }
      const result = yield* Effect.result(lookup(key));
      if (result._tag === "Success") {
        cache.set(key, { expires: Date.now() + TOKEN_TTL_MS, value: result.success });
        return result.success;
      }
      // A CLI that crashed may work next time; missing logins are remembered briefly.
      if (result.failure._tag !== "GitCafeCliFailedError")
        cache.set(key, { expires: Date.now() + MISSING_TTL_MS, value: result.failure });
      return yield* Effect.fail(result.failure);
    }),
    invalidate: (host: string) =>
      Effect.sync(() => {
        cache.delete(host.trim().toLowerCase());
      }),
  });
});

export const layer = Layer.effect(GitCafeCredentials, make);

export { gitCafeHost };
