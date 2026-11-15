import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { SourceControlProviderError } from "@tabs/contracts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as OriginCli from "./OriginCli.ts";
import {
  OriginPullRequestListSchema,
  OriginPullRequestSchema,
  OriginRepositorySchema,
  pullReference,
  toOriginChangeRequest,
  type OriginRepository,
} from "./originPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import {
  probeSourceControlProvider,
  providerAuth,
  type SourceControlCliDiscoverySpec,
  type SourceControlManagedCliDiscoverySpec,
} from "./SourceControlProviderDiscovery.ts";

const isOriginCliError = Schema.is(OriginCli.OriginCliError);

export const discovery = {
  type: "cli",
  kind: "cursor-origin",
  label: "Cursor Origin",
  executable: OriginCli.ORIGIN_COMMAND,
  versionArgs: ["--version"],
  authArgs: ["auth", "status", "--json"],
  parseAuth: (input) => {
    const status = OriginCli.parseOriginAuthStatus(input.stdout);
    const account = OriginCli.originAccount(status);
    if (status === null) return providerAuth({ status: "unknown" });
    return status.authenticated && status.tokenValid !== false
      ? providerAuth({
          status: "authenticated",
          account: account ?? undefined,
          host: "origin.cursor.com",
        })
      : providerAuth({
          status: "unauthenticated",
          detail: "Run `origin auth login` to sign in to Cursor Origin.",
        });
  },
  installHint:
    "Install the Origin CLI with `curl -fsSL https://downloads.cursor.com/origin/install.sh | sh`, then run `origin auth login`.",
} satisfies SourceControlCliDiscoverySpec;

/**
 * Discovery names the account by its namespace slug, which owns its repositories, rather than the
 * email `origin auth status` reports.
 */
export const makeDiscovery = Effect.gen(function* () {
  const cli = yield* OriginCli.OriginCli;
  const process = yield* VcsProcess.VcsProcess;
  return {
    type: "managed-cli",
    kind: discovery.kind,
    label: discovery.label,
    installHint: discovery.installHint,
    probe: Effect.fn("OriginSourceControlProvider.discovery")(function* (cwd: string) {
      const item = yield* probeSourceControlProvider({ cwd, process, spec: discovery });
      if (item.status !== "available" || item.auth.status !== "authenticated") return item;
      const namespace = yield* cli.personalNamespace(cwd).pipe(Effect.option);
      return { ...item, auth: { ...item.auth, account: namespace } };
    }),
    // `origin.cursor.com` is recognised from the remote alone, so there is nothing to refine.
    refineUnknownRemote: () => Effect.succeed(null),
  } satisfies SourceControlManagedCliDiscoverySpec;
});

const cloneUrls = (repository: OriginRepository, fallbackName: string) => {
  const nameWithOwner =
    repository.fullName ??
    (repository.owner ? `${repository.owner.slug}/${repository.name}` : fallbackName);
  const url = repository.cloneUrl ?? `https://origin.cursor.com/${nameWithOwner}.git`;
  // Origin documents no SSH clone URL, and `origin auth login` already configures git's HTTPS
  // credential helper, so HTTPS stands in for both.
  return { nameWithOwner, url, sshUrl: url };
};

export const make = Effect.gen(function* () {
  const cli = yield* OriginCli.OriginCli;
  const fs = yield* FileSystem.FileSystem;
  const process = yield* VcsProcess.VcsProcess;

  const mapError = (
    operation: string,
    cwd: string,
    extra?: { readonly repository?: string; readonly reference?: string },
  ) =>
    Effect.mapError(
      (cause: unknown) =>
        new SourceControlProviderError({
          provider: "cursor-origin",
          operation,
          cwd,
          command: OriginCli.ORIGIN_COMMAND,
          ...(extra?.repository
            ? {
                repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                  extra.repository,
                ),
              }
            : {}),
          ...(extra?.reference
            ? {
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  extra.reference,
                ),
              }
            : {}),
          detail: isOriginCliError(cause) ? cause.detail : "Cursor Origin operation failed.",
          cause,
        }),
    );

  const getRepository = (cwd: string, repository: string, operation: string) =>
    cli.api(
      { cwd, operation, path: OriginCli.originRepositoryPath(repository) },
      OriginRepositorySchema,
    );

  return SourceControlProvider.SourceControlProvider.of({
    kind: "cursor-origin",
    listChangeRequests: (input) =>
      Effect.gen(function* () {
        const repository = yield* cli.resolveRepository(input);
        const head = SourceControlProvider.sourceBranch(input);
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
        const query = new URLSearchParams({
          head,
          state: input.state,
          pageSize: String(limit),
          sortBy: "updated",
        });
        const page = yield* cli.api(
          {
            cwd: input.cwd,
            operation: "listChangeRequests",
            path: `${OriginCli.originRepositoryPath(repository)}/pulls?${query}`,
          },
          OriginPullRequestListSchema,
        );
        return (page.pullRequests ?? []).map(toOriginChangeRequest);
      }).pipe(mapError("listChangeRequests", input.cwd, { reference: input.headSelector })),
    getChangeRequest: (input) =>
      Effect.gen(function* () {
        const reference = pullReference(input.reference);
        const repository = reference.repository ?? (yield* cli.resolveRepository(input));
        if (reference.number === null)
          return yield* new OriginCli.OriginCliError({
            operation: "getChangeRequest",
            cwd: input.cwd,
            reason: "not-found",
            detail: "Specify a pull request number or Cursor Origin pull request URL.",
          });
        return toOriginChangeRequest(
          yield* cli.api(
            {
              cwd: input.cwd,
              operation: "getChangeRequest",
              path: `${OriginCli.originRepositoryPath(repository)}/pulls/${reference.number}`,
            },
            OriginPullRequestSchema,
          ),
        );
      }).pipe(mapError("getChangeRequest", input.cwd, { reference: input.reference })),
    createChangeRequest: (input) =>
      Effect.gen(function* () {
        const repository = input.target?.repository ?? (yield* cli.resolveRepository(input));
        yield* cli.api(
          {
            cwd: input.cwd,
            operation: "createChangeRequest",
            method: "POST",
            path: `${OriginCli.originRepositoryPath(repository)}/pulls`,
            body: {
              title: input.title,
              body: yield* fs.readFileString(input.bodyFile),
              head: SourceControlProvider.sourceBranch(input),
              base: input.target?.refName ?? input.baseRefName,
              // Origin creates drafts unless told otherwise.
              draft: false,
            },
          },
          Schema.Unknown,
        );
      }).pipe(mapError("createChangeRequest", input.cwd, { reference: input.headSelector })),
    getRepositoryCloneUrls: (input) =>
      getRepository(input.cwd, input.repository, "getRepositoryCloneUrls").pipe(
        Effect.map((repository) => cloneUrls(repository, input.repository)),
        mapError("getRepositoryCloneUrls", input.cwd, { repository: input.repository }),
      ),
    createRepository: (input) =>
      Effect.gen(function* () {
        if (input.visibility === "public")
          return yield* new OriginCli.OriginCliError({
            operation: "createRepository",
            cwd: input.cwd,
            reason: "failed",
            detail: "Cursor Origin repositories are private. Choose private visibility.",
          });
        const parts = input.repository.split("/");
        if (parts.length > 2 || parts.some((part) => part.trim().length === 0))
          return yield* new OriginCli.OriginCliError({
            operation: "createRepository",
            cwd: input.cwd,
            reason: "failed",
            detail: "Specify an Origin repository as owner/name or name.",
          });
        const [owner, name] =
          parts.length === 2 ? parts : [yield* cli.personalNamespace(input.cwd), input.repository];
        yield* cli.api(
          {
            cwd: input.cwd,
            operation: "createRepository",
            method: "POST",
            path: `/v1/origin/repos/${encodeURIComponent(owner ?? "")}`,
            body: { name },
          },
          OriginRepositorySchema,
        );
        // Origin creates repositories internal (visible to the whole team) and only takes a
        // visibility on update, so the repository is made private straight after.
        const madePrivate = yield* cli
          .api(
            {
              cwd: input.cwd,
              operation: "createRepository",
              method: "PATCH",
              path: OriginCli.originRepositoryPath(`${owner}/${name}`),
              body: { visibility: "private" },
            },
            OriginRepositorySchema,
          )
          .pipe(
            Effect.retry({
              times: 2,
              schedule: Schedule.spaced("1 second"),
              while: (error) =>
                error.reason !== "rate-limited" && error.reason !== "unauthenticated",
            }),
            Effect.mapError(
              (cause) =>
                new OriginCli.OriginCliError({
                  operation: "createRepository",
                  cwd: input.cwd,
                  reason: cause.reason,
                  detail: `Created ${owner}/${name}, but could not make it private, so your Cursor team can still see it. Set it to private on cursor.com.`,
                  cause,
                }),
            ),
          );
        return cloneUrls(madePrivate, `${owner}/${name}`);
      }).pipe(mapError("createRepository", input.cwd, { repository: input.repository })),
    getDefaultBranch: (input) =>
      Effect.gen(function* () {
        const repository = yield* cli.resolveRepository(input);
        return (
          (yield* getRepository(input.cwd, repository, "getDefaultBranch")).defaultBranch ?? null
        );
      }).pipe(mapError("getDefaultBranch", input.cwd)),
    checkoutChangeRequest: (input) =>
      Effect.gen(function* () {
        const repository = yield* cli.resolveRepository(input);
        const { repository: linked, number } = pullReference(input.reference);
        const reference = input.reference.trim();
        // The CLI reads a leading dash as a flag; no branch starts with one.
        if (number === null && reference.startsWith("-"))
          return yield* new OriginCli.OriginCliError({
            operation: "checkoutChangeRequest",
            cwd: input.cwd,
            reason: "not-found",
            detail: "Specify a pull request number, branch, or Cursor Origin pull request URL.",
          });
        if (linked !== null && linked !== repository.toLowerCase())
          return yield* new OriginCli.OriginCliError({
            operation: "checkoutChangeRequest",
            cwd: input.cwd,
            reason: "not-found",
            detail: `That pull request is in ${linked}, not this checkout's ${repository}.`,
          });
        const remoteName =
          input.context?.remoteName ??
          (yield* process
            .run({
              operation: "OriginSourceControlProvider.remote",
              command: "git",
              args: ["remote"],
              cwd: input.cwd,
            })
            .pipe(Effect.map((result) => result.stdout.split(/\r?\n/u)[0]?.trim() || "origin")));
        yield* cli.execute({
          cwd: input.cwd,
          operation: "checkoutChangeRequest",
          args: [
            "pr",
            "checkout",
            "-R",
            repository,
            "--remote",
            remoteName,
            ...(input.force ? ["--force"] : []),
            number === null ? reference : String(number),
          ],
        });
      }).pipe(mapError("checkoutChangeRequest", input.cwd, { reference: input.reference })),
  });
});
