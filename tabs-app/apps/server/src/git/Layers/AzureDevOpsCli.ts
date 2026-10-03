import { Effect, Layer } from "effect";
import { runProcess } from "../../processRunner";
import { AzureDevOpsCliError } from "../Errors.ts";
import { AzureDevOpsCli, type AzureDevOpsCliShape } from "../Services/AzureDevOpsCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodePullRequest(value: unknown) {
  const raw = record(value);
  if (!raw) return null;
  const number = raw?.pullRequestId;
  const title = text(raw?.title);
  const source = text(raw?.sourceRefName)?.replace(/^refs\/heads\//, "");
  const target = text(raw?.targetRefName)?.replace(/^refs\/heads\//, "");
  const links = record(raw?._links);
  const web = record(links?.web);
  const repository = record(raw?.repository);
  const repositoryWebUrl = text(repository?.webUrl);
  const url =
    text(web?.href) ??
    (repositoryWebUrl && typeof number === "number"
      ? `${repositoryWebUrl}/pullrequest/${number}`
      : null);
  if (typeof number !== "number" || number <= 0 || !title || !source || !target || !url)
    return null;
  const author = record(raw.createdBy);
  const authorLogin = text(author?.uniqueName ?? author?.displayName);
  const status = text(raw.status)?.toLowerCase();
  const mergeStatus = text(raw.mergeStatus)?.toLowerCase();
  const completionOptions = record(raw.completionOptions);
  const autoMergeEnabled = record(raw.autoCompleteSetBy) !== null;
  const reviewers = Array.isArray(raw.reviewers)
    ? raw.reviewers.flatMap((entry) => {
        const reviewer = record(entry);
        const login = text(reviewer?.uniqueName ?? reviewer?.displayName);
        return login
          ? [
              {
                login,
                ...(text(reviewer?.imageUrl) ? { avatarUrl: text(reviewer?.imageUrl)! } : {}),
              },
            ]
          : [];
      })
    : [];
  return {
    provider: "azure-devops" as const,
    number: Math.trunc(number),
    title,
    url,
    baseBranch: target,
    headBranch: source,
    state:
      status === "completed"
        ? ("merged" as const)
        : status === "abandoned"
          ? ("closed" as const)
          : ("open" as const),
    isDraft: raw.isDraft === true,
    author: authorLogin
      ? {
          login: authorLogin,
          ...(text(author?.imageUrl) ? { avatarUrl: text(author?.imageUrl)! } : {}),
        }
      : null,
    reviewers,
    autoMergeEnabled,
    ...(autoMergeEnabled
      ? {
          autoMergeMethod:
            completionOptions?.squashMerge === true ? ("squash" as const) : ("merge" as const),
        }
      : {}),
    mergeability: ["conflicts", "failure", "rejectedbypolicy"].includes(mergeStatus ?? "")
      ? ("conflicting" as const)
      : mergeStatus === "succeeded"
        ? ("mergeable" as const)
        : ("unknown" as const),
    ...(typeof raw.description === "string" ? { body: raw.description } : {}),
    ...(text(raw.creationDate) ? { createdAt: text(raw.creationDate)! } : {}),
    ...(text(raw.closedDate ?? raw.creationDate)
      ? { updatedAt: text(raw.closedDate ?? raw.creationDate)! }
      : {}),
  };
}

export function decodeAzureDevOpsPullRequests(value: unknown) {
  const rows = Array.isArray(value) ? value : [value];
  return rows.flatMap((entry) => {
    const pullRequest = decodePullRequest(entry);
    return pullRequest ? [pullRequest] : [];
  });
}

function normalizeAzureDevOpsCliError(operation: string, error: unknown): AzureDevOpsCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: az")) {
      return new AzureDevOpsCliError({
        operation,
        detail: "Azure CLI (`az`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new AzureDevOpsCliError({
      operation,
      detail: `Azure DevOps CLI command failed: ${error.message}`,
      cause: error,
    });
  }
  return new AzureDevOpsCliError({
    operation,
    detail: "Azure DevOps CLI command failed.",
    cause: error,
  });
}

export const makeAzureDevOpsCli = Effect.sync(() => {
  const execute: AzureDevOpsCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("az", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeAzureDevOpsCliError("execute", error),
    });

  return {
    execute,
    getAuthStatus: (input) =>
      execute({
        cwd: input.cwd,
        args: ["account", "show", "--query", "user.name", "-o", "tsv"],
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.catch((err) => {
          if (err && typeof err === "object" && "cause" in err) {
            const cause = err.cause;
            if (cause && typeof cause === "object") {
              const stdout =
                "stdout" in cause && typeof cause.stdout === "string" ? cause.stdout : "";
              const stderr =
                "stderr" in cause && typeof cause.stderr === "string" ? cause.stderr : "";
              if (stdout || stderr) {
                return Effect.succeed(`${stdout}\n${stderr}`);
              }
            }
          }
          return Effect.fail(err);
        }),
      ),
    listPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "repos",
          "pr",
          "list",
          "--detect",
          "true",
          "--status",
          input.state === "open"
            ? "active"
            : input.state === "merged"
              ? "completed"
              : input.state === "closed"
                ? "abandoned"
                : "all",
          "--include-links",
          "--top",
          String(input.limit),
          "--only-show-errors",
          "--output",
          "json",
        ],
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => decodeAzureDevOpsPullRequests(JSON.parse(result.stdout.trim() || "[]")),
            catch: (error) => normalizeAzureDevOpsCliError("listPullRequests", error),
          }),
        ),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "repos",
          "pr",
          "show",
          "--detect",
          "true",
          "--id",
          input.reference.replace(/^#/, ""),
          "--only-show-errors",
          "--output",
          "json",
        ],
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => {
              const [pullRequest] = decodeAzureDevOpsPullRequests(
                JSON.parse(result.stdout.trim() || "{}"),
              );
              if (!pullRequest)
                throw new Error("Azure DevOps returned an incomplete pull request.");
              return pullRequest;
            },
            catch: (error) => normalizeAzureDevOpsCliError("getPullRequest", error),
          }),
        ),
      ),
    mutatePullRequest: (input) => {
      const reference = input.reference.replace(/^#/, "");
      let args: ReadonlyArray<string>;
      switch (input.action) {
        case "merge":
          args = [
            "repos",
            "pr",
            "update",
            "--detect",
            "true",
            "--id",
            reference,
            "--status",
            "completed",
            "--squash",
            input.mergeMethod === "squash" ? "true" : "false",
          ];
          break;
        case "close":
          args = [
            "repos",
            "pr",
            "update",
            "--detect",
            "true",
            "--id",
            reference,
            "--status",
            "abandoned",
          ];
          break;
        case "reopen":
          args = [
            "repos",
            "pr",
            "update",
            "--detect",
            "true",
            "--id",
            reference,
            "--status",
            "active",
          ];
          break;
        case "ready":
        case "draft":
          args = [
            "repos",
            "pr",
            "update",
            "--detect",
            "true",
            "--id",
            reference,
            "--draft",
            input.action === "draft" ? "true" : "false",
          ];
          break;
        case "enable_auto_merge":
          args = [
            "repos",
            "pr",
            "update",
            "--detect",
            "true",
            "--id",
            reference,
            "--auto-complete",
            "true",
            "--squash",
            input.mergeMethod === "squash" ? "true" : "false",
          ];
          break;
        case "disable_auto_merge":
          args = [
            "repos",
            "pr",
            "update",
            "--detect",
            "true",
            "--id",
            reference,
            "--auto-complete",
            "false",
          ];
          break;
        case "edit_pull_request":
          args = [
            "repos",
            "pr",
            "update",
            "--detect",
            "true",
            "--id",
            reference,
            ...(input.title === undefined ? [] : ["--title", input.title]),
            ...(input.body === undefined ? [] : ["--description", input.body]),
          ];
          break;
        case "add_reviewer":
        case "remove_reviewer":
          args = [
            "repos",
            "pr",
            "reviewer",
            input.action === "add_reviewer" ? "add" : "remove",
            "--detect",
            "true",
            "--id",
            reference,
            "--reviewers",
            input.value ?? "",
          ];
          break;
        default:
          return Effect.fail(
            new AzureDevOpsCliError({
              operation: "mutatePullRequest",
              detail: `Azure DevOps does not support ${input.action.replaceAll("_", " ")} here.`,
            }),
          );
      }
      return execute({
        cwd: input.cwd,
        args: [...args, "--only-show-errors", "--output", "json"],
      }).pipe(Effect.asVoid);
    },
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "repos",
          "pr",
          "create",
          "--detect",
          "true",
          "--source-branch",
          input.headBranch,
          "--target-branch",
          input.baseBranch,
          "--title",
          input.title,
          "--description",
          input.body,
          "--draft",
          input.draft ? "true" : "false",
          "--only-show-errors",
          "--output",
          "json",
        ],
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => {
              const [pullRequest] = decodeAzureDevOpsPullRequests(
                JSON.parse(result.stdout.trim() || "{}"),
              );
              if (!pullRequest)
                throw new Error("Azure DevOps returned an incomplete pull request.");
              return pullRequest;
            },
            catch: (error) => normalizeAzureDevOpsCliError("createPullRequest", error),
          }),
        ),
      ),
  } satisfies AzureDevOpsCliShape;
});

export const AzureDevOpsCliLive = Layer.effect(AzureDevOpsCli, makeAzureDevOpsCli);
