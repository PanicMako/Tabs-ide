import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import {
  PositiveInt,
  SourceControlProviderError,
  TrimmedNonEmptyString,
  type ChangeRequest,
} from "@tabs/contracts";
import { isSshRemoteUrl } from "@tabs/shared/sourceControl";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitCafeApi from "./GitCafeApi.ts";
import * as GitCafeHosts from "./gitCafeHosts.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import {
  probeSourceControlProvider,
  providerAuth,
  type SourceControlCliDiscoverySpec,
  type SourceControlManagedCliDiscoverySpec,
} from "./SourceControlProviderDiscovery.ts";

const AUTH_HOST = "git.cafe";
const ADMISSION_TIMEOUT = "30 seconds";
const ADMISSION_POLL_INTERVAL = "500 millis";
const cliArgs = (host: string) => [
  "--host",
  `https://${host}/api`,
  "--no-input",
  "--no-update-check",
];

const decodeAuth = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Struct({
      schemaVersion: Schema.Literal(1),
      data: Schema.Struct({ host: Schema.String, username: TrimmedNonEmptyString }),
    }),
  ),
);
const decodeFailure = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Struct({
      schemaVersion: Schema.Literal(1),
      error: Schema.Struct({
        code: Schema.String,
        message: Schema.String,
        status: Schema.NullOr(Schema.Finite),
      }),
    }),
  ),
);
const cliFailure = (output: string) =>
  [output.trim(), ...output.split(/\r?\n/u).toReversed()]
    .map((line) => decodeFailure(line.trim()))
    .find(Result.isSuccess)?.success.error;

export const discovery = {
  type: "cli",
  kind: "gitcafe",
  label: "GitCafe",
  executable: "cafe",
  versionArgs: ["--version"],
  authArgs: [...cliArgs(AUTH_HOST), "auth", "status", "--json"],
  parseAuth: (input) => {
    const signedIn = decodeAuth(input.stdout.trim());
    if (input.exitCode === 0 && Result.isSuccess(signedIn))
      return providerAuth({
        status: "authenticated",
        host: AUTH_HOST,
        account: signedIn.success.data.username,
      });
    const failure = cliFailure(input.stderr) ?? cliFailure(input.stdout);
    if (failure)
      return providerAuth({
        // Forbidden/offline responses do not establish that a login is gone.
        status:
          failure.code === "AUTHENTICATION_REQUIRED" || failure.status === 401
            ? "unauthenticated"
            : "unknown",
        host: AUTH_HOST,
        detail: failure.message,
      });
    return providerAuth({
      status: "unknown",
      host: AUTH_HOST,
      detail: `GitCafe authentication status could not be read. Run \`cafe auth login --host https://${AUTH_HOST}/api\`.`,
    });
  },
  installHint: `Install the GitCafe CLI with \`bun install -g @gitcafe/cli\`, then run \`cafe auth login --host https://${AUTH_HOST}/api\`, or set CAFE_TOKEN on the server.`,
} satisfies SourceControlCliDiscoverySpec;

export const parseAuth = discovery.parseAuth;

const Repository = Schema.Struct({
  name: TrimmedNonEmptyString,
  defaultBranch: Schema.NullOr(TrimmedNonEmptyString),
});
const Pull = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  state: Schema.Literals(["open", "closed", "merged"]),
  draft: Schema.Boolean,
  sourceBranch: TrimmedNonEmptyString,
  targetBranch: TrimmedNonEmptyString,
  headOid: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});
const PullDetail = Schema.Struct({
  ...Pull.fields,
  sourceRepo: Schema.NullOr(
    Schema.Struct({ owner: TrimmedNonEmptyString, name: TrimmedNonEmptyString }),
  ),
  closedAt: Schema.NullOr(Schema.String),
  mergedAt: Schema.NullOr(Schema.String),
});
const Pulls = Schema.Struct({ items: Schema.Array(Pull), next: Schema.NullOr(Schema.String) });
const RepositoryAdmission = Schema.Struct({
  repoId: TrimmedNonEmptyString,
  state: Schema.String,
  owner: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
const RepositoryId = Schema.Struct({ id: TrimmedNonEmptyString });
const CreatedPull = Schema.Struct({ number: PositiveInt });
const encodeBranches = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

interface Target {
  readonly host: GitCafeHosts.GitCafeHost;
  readonly repository: string;
}

const cloneUrls = (target: Target) => ({
  nameWithOwner: target.repository,
  url: `https://${target.host}/${target.repository}`,
  sshUrl: `ssh@${target.host}:${target.repository}.git`,
});

/** A pull request's web URL: `/pulls/<n>` is canonical and `/pull/<n>` redirects to it. */
export const parseGitCafePullUrl = (value: string) => {
  const url = URL.parse(value);
  if (url === null) return null;
  const host = GitCafeHosts.gitCafeHost(url.hostname);
  const match = /^\/([^/]+\/[^/]+)\/pulls?\/(\d+)(?:\/|$)/u.exec(url.pathname);
  return host && match?.[1] && match[2]
    ? { host, repository: match[1], number: Number(match[2]) }
    : null;
};

export const make = Effect.gen(function* () {
  const api = yield* GitCafeApi.GitCafeApi;
  const fileSystem = yield* FileSystem.FileSystem;
  const process = yield* VcsProcess.VcsProcess;

  const git = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    allowNonZeroExit = false,
  ) => process.run({ operation, command: "git", cwd, args, allowNonZeroExit });

  const error = (operation: string, cwd: string, detail: string, cause?: unknown) =>
    new SourceControlProviderError({
      provider: "gitcafe",
      operation,
      cwd,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });
  const read = <S extends Schema.Codec<unknown, unknown, never, never>>(
    operation: string,
    cwd: string,
    request: Omit<GitCafeApi.GitCafeApiRequest, "operation">,
    schema: S,
  ) =>
    api.request({ ...request, operation }).pipe(
      Effect.mapError((cause) => error(operation, cwd, cause.detail, cause)),
      Effect.flatMap((raw) =>
        Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
          Effect.mapError((cause) =>
            error(operation, cwd, "GitCafe returned an unreadable response.", cause),
          ),
        ),
      ),
    );
  const resolveTarget = Effect.fn("GitCafeSourceControlProvider.resolveTarget")(function* (
    operation: string,
    input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly repository?: string;
    },
  ) {
    const named =
      input.repository === undefined ? null : GitCafeHosts.parseGitCafeRemote(input.repository);
    if (named) return named;
    const readRemote = git(operation, input.cwd, ["remote", "get-url", "origin"]).pipe(
      Effect.map((result) => result.stdout.trim()),
    );
    const remoteUrl =
      input.context?.remoteUrl ??
      (input.repository === undefined
        ? yield* readRemote.pipe(
            Effect.mapError((cause) =>
              error(operation, input.cwd, "Could not read the GitCafe remote.", cause),
            ),
          )
        : yield* readRemote.pipe(Effect.orElseSucceed(() => null)));
    const remote = remoteUrl ? GitCafeHosts.parseGitCafeRemote(remoteUrl) : null;
    if (input.repository === undefined) {
      if (remote) return remote;
      return yield* error(operation, input.cwd, "No GitCafe repository remote was found.");
    }
    const repository = GitCafeHosts.gitCafeRepositoryPath(input.repository);
    if (repository !== null)
      return { host: remote?.host ?? AUTH_HOST, repository } satisfies Target;
    return yield* error(
      operation,
      input.cwd,
      "A GitCafe repository is named owner/name or by its git.cafe URL.",
    );
  });

  const getPull = Effect.fn("GitCafeSourceControlProvider.getPull")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly reference: string;
  }) {
    const match = parseGitCafePullUrl(input.reference.trim());
    const target: Target = match
      ? { host: match.host, repository: match.repository }
      : yield* resolveTarget("getChangeRequest", input);
    const number = match
      ? String(match.number)
      : /^#?([1-9]\d*)$/u.exec(input.reference.trim())?.[1];
    if (number === undefined)
      return yield* error(
        "getChangeRequest",
        input.cwd,
        "A GitCafe pull request is a number or a git.cafe pull request URL.",
      );
    const pull = yield* read(
      "getChangeRequest",
      input.cwd,
      { host: target.host, path: `/repos/${target.repository}/pulls/${number}` },
      PullDetail,
    );
    const owner = target.repository.split("/")[0] ?? null;
    return {
      provider: "gitcafe",
      number: pull.number,
      title: pull.title,
      url: `https://${target.host}/${target.repository}/pulls/${pull.number}`,
      baseRefName: pull.targetBranch,
      headRefName: pull.sourceBranch,
      state: pull.state,
      ...(pull.draft ? { isDraft: true } : {}),
      closedAt: pull.closedAt,
      mergedAt: pull.mergedAt,
      updatedAt: pull.updatedAt,
      isCrossRepository: pull.sourceRepo !== null,
      headRepositoryNameWithOwner: pull.sourceRepo
        ? `${pull.sourceRepo.owner}/${pull.sourceRepo.name}`
        : target.repository,
      headRepositoryOwnerLogin: pull.sourceRepo?.owner ?? owner,
    } satisfies ChangeRequest;
  });

  return SourceControlProvider.SourceControlProvider.of({
    kind: "gitcafe",
    resolveLink: ({ cwd, url }) => {
      const link = parseGitCafePullUrl(url.href);
      if (link === null) return undefined;
      return getPull({ cwd, reference: url.href }).pipe(
        Effect.map((pull) => ({ title: pull.title, body: null })),
      );
    },
    getChangeRequest: getPull,
    listChangeRequests: Effect.fn("GitCafeSourceControlProvider.listChangeRequests")(
      function* (input) {
        const target = yield* resolveTarget("listChangeRequests", input);
        const source = SourceControlProvider.sourceControlRefFromInput(input);
        const branch = SourceControlProvider.sourceBranch(input);
        const limit = input.limit ?? 20;
        const items: Array<ChangeRequest> = [];
        let after: string | null = null;
        do {
          const query = new URLSearchParams({
            sourceBranches: encodeBranches([branch]),
            limit: String(Math.min(limit, 100)),
            sort: "newest",
          });
          if (input.state !== "all") query.set("state", input.state);
          if (after !== null) query.set("after", after);
          const page: typeof Pulls.Type = yield* read(
            "listChangeRequests",
            input.cwd,
            { host: target.host, path: `/repos/${target.repository}/pulls?${query}` },
            Pulls,
          );
          for (const pull of page.items) {
            if (pull.sourceBranch !== branch || items.length >= limit) continue;
            // List rows omit fork identity; read matching branches in full.
            const detail = yield* getPull({
              cwd: input.cwd,
              reference: `https://${target.host}/${target.repository}/pulls/${pull.number}`,
            });
            if (
              (!source?.repository || detail.headRepositoryNameWithOwner === source.repository) &&
              (!source?.owner || detail.headRepositoryOwnerLogin === source.owner)
            )
              items.push(detail);
          }
          after = page.items.length === 0 || page.next === after ? null : page.next;
        } while (after !== null && items.length < limit);
        return items;
      },
    ),
    createChangeRequest: Effect.fn("GitCafeSourceControlProvider.createChangeRequest")(
      function* (input) {
        const target = yield* resolveTarget("createChangeRequest", {
          ...input,
          ...(input.target?.repository ? { repository: input.target.repository } : {}),
        });
        const source = SourceControlProvider.sourceControlRefFromInput(input);
        const sourceRepository =
          source?.repository ??
          (source?.owner
            ? `${source.owner}/${target.repository.split("/")[1]}`
            : target.repository);
        const branch = SourceControlProvider.sourceBranch(input);
        // GitCafe names the head by its repository's id, so the head repository is looked up first.
        const head = yield* read(
          "createChangeRequest",
          input.cwd,
          { host: target.host, path: `/repos/${sourceRepository}` },
          RepositoryId,
        );
        const description = yield* fileSystem
          .readFileString(input.bodyFile)
          .pipe(
            Effect.mapError((cause) =>
              error(
                "createChangeRequest",
                input.cwd,
                "Could not read the pull request description.",
                cause,
              ),
            ),
          );
        yield* read(
          "createChangeRequest",
          input.cwd,
          {
            host: target.host,
            method: "POST",
            path: `/repos/${target.repository}/pulls`,
            body: {
              repo: head.id,
              source: branch,
              target: input.target?.refName ?? input.baseRefName,
              title: input.title,
              ...(description.trim().length === 0 ? {} : { description }),
            },
          },
          CreatedPull,
        );
      },
    ),
    getRepositoryCloneUrls: Effect.fn("GitCafeSourceControlProvider.getRepositoryCloneUrls")(
      function* (input) {
        const target = yield* resolveTarget("getRepositoryCloneUrls", input);
        yield* read(
          "getRepositoryCloneUrls",
          input.cwd,
          { host: target.host, path: `/repos/${target.repository}` },
          Repository,
        );
        return cloneUrls(target);
      },
    ),
    createRepository: Effect.fn("GitCafeSourceControlProvider.createRepository")(function* (input) {
      const target = yield* resolveTarget("createRepository", input);
      const [owner = "", name = ""] = target.repository.split("/");
      const pending = yield* read(
        "createRepository",
        input.cwd,
        {
          host: target.host,
          method: "POST",
          path: `/orgs/${owner}/repos`,
          body: {
            name,
            requestKey: crypto.randomUUID(),
            visibility: input.visibility,
            defaultBranch: "main",
          },
        },
        RepositoryAdmission,
      );
      // GitCafe admits a repository asynchronously, so wait for it to settle the way
      // `cafe repo create --clone` does.
      const settled = (state: string) => state === "complete" || state === "blocked";
      const resource = settled(pending.state)
        ? pending
        : yield* read(
            "createRepository",
            input.cwd,
            {
              host: target.host,
              path: `/orgs/${pending.owner}/admissions/${pending.repoId}`,
            },
            RepositoryAdmission,
          ).pipe(
            Effect.repeat({
              until: (admission) => settled(admission.state),
              schedule: Schedule.spaced(ADMISSION_POLL_INTERVAL),
            }),
            Effect.timeoutOption(ADMISSION_TIMEOUT),
            Effect.map(Option.getOrElse(() => pending)),
          );
      if (resource.state !== "complete")
        return yield* error(
          "createRepository",
          input.cwd,
          `GitCafe repository ${target.repository} is ${resource.state}. Check it on GitCafe before retrying.`,
        );
      return cloneUrls({ host: target.host, repository: `${resource.owner}/${resource.name}` });
    }),
    getDefaultBranch: Effect.fn("GitCafeSourceControlProvider.getDefaultBranch")(function* (input) {
      const target = yield* resolveTarget("getDefaultBranch", input);
      const repository = yield* read(
        "getDefaultBranch",
        input.cwd,
        { host: target.host, path: `/repos/${target.repository}` },
        Repository,
      );
      return repository.defaultBranch;
    }),
    // `cafe` has no forced checkout, so the branch is fetched and switched with git.
    checkoutChangeRequest: Effect.fn("GitCafeSourceControlProvider.checkoutChangeRequest")(
      function* (input) {
        const pull = yield* getPull(input);
        const pullHost = new URL(pull.url).host;
        const sourceRepository = pull.headRepositoryNameWithOwner;
        if (!sourceRepository)
          return yield* error(
            "checkoutChangeRequest",
            input.cwd,
            "GitCafe did not name the pull request's source repository.",
          );
        const useSsh =
          input.context?.remoteUrl !== undefined && isSshRemoteUrl(input.context.remoteUrl);
        const url = useSsh
          ? `ssh@${pullHost}:${sourceRepository}.git`
          : `https://${pullHost}/${sourceRepository}.git`;
        yield* Effect.gen(function* () {
          const localBranch = pull.isCrossRepository
            ? `pr-${pull.number}/${pull.headRefName}`
            : pull.headRefName;
          yield* git("GitCafeSourceControlProvider.checkoutChangeRequest", input.cwd, [
            "fetch",
            "--",
            url,
            pull.headRefName,
          ]);
          const existing = yield* git(
            "GitCafeSourceControlProvider.checkoutChangeRequest",
            input.cwd,
            ["show-ref", "--verify", "--quiet", `refs/heads/${localBranch}`],
            true,
          );
          if (existing.exitCode !== 0 || input.force === true) {
            yield* git("GitCafeSourceControlProvider.checkoutChangeRequest", input.cwd, [
              "checkout",
              "--no-track",
              "-B",
              localBranch,
              "FETCH_HEAD",
              "--",
            ]);
          } else {
            yield* git("GitCafeSourceControlProvider.checkoutChangeRequest", input.cwd, [
              "checkout",
              localBranch,
              "--",
            ]);
          }
        }).pipe(
          Effect.mapError((cause) =>
            error(
              "checkoutChangeRequest",
              input.cwd,
              "Could not check out the GitCafe pull request.",
              cause,
            ),
          ),
        );
      },
    ),
  });
});

export const makeDiscovery = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;
  return {
    type: "managed-cli",
    kind: discovery.kind,
    label: discovery.label,
    installHint: discovery.installHint,
    probe: (cwd: string) => probeSourceControlProvider({ cwd, spec: discovery, process }),
    refineUnknownRemote: () => Effect.succeed(null),
  } satisfies SourceControlManagedCliDiscoverySpec;
});
