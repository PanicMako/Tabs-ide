import * as GitWorkflowService from "./git/GitWorkflowService.ts";
import { WorkspaceCompatibilityError, WorkspaceCompatibilityRpcGroup } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { makeGitCore } from "./git/Layers/GitCore.ts";
import { GitEnvironment } from "./git/Services/GitEnvironment.ts";
import { GitEnvironmentLive } from "./git/Layers/GitEnvironment.ts";
import { makeGitManager as makeLegacyGitManager } from "./git/Layers/GitManager.ts";
import { GitCore as LegacyGitCore } from "./git/Services/GitCore.ts";
import { GitHubCliLive } from "./git/Layers/GitHubCli.ts";
import { PullRequestReadCacheLive } from "./git/Layers/PullRequestReadCache.ts";
import * as TextGeneration from "./textGeneration/TextGeneration.ts";
import { createSupportBundle } from "./diagnostics/SupportBundle.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
import * as Keybindings from "./keybindings.ts";
import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as SourceControlRepositoryService from "./sourceControl/SourceControlRepositoryService.ts";

export const makeWorkspaceCompatibilityHandlers = Effect.gen(function* () {
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const refreshStatus = (input: unknown) =>
    typeof input === "object" && input !== null && "cwd" in input && typeof input.cwd === "string"
      ? gitWorkflow.invalidateStatus(input.cwd)
      : Effect.void;
  const legacyGit = yield* makeGitCore();
  const legacyGitEnvironment = yield* GitEnvironment.pipe(Effect.provide(GitEnvironmentLive));
  const legacyPrManager = yield* makeLegacyGitManager.pipe(
    Effect.provideService(LegacyGitCore, legacyGit),
    Effect.provide(GitHubCliLive),
    Effect.provide(PullRequestReadCacheLive),
    Effect.provide(TextGeneration.layer),
  );
  const keybindings = yield* Keybindings.Keybindings;
  const config = yield* ServerConfig.ServerConfig;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const terminalManager = yield* TerminalManager.TerminalManager;
  const sourceControlRepositories =
    yield* SourceControlRepositoryService.SourceControlRepositoryService;
  return WorkspaceCompatibilityRpcGroup.of({
    "terminal.list": () => terminalManager.list(),
    "git.fetch": (input) =>
      legacyGit.fetchLatest(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.fetch",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.pull": (input) =>
      legacyGit.pullCurrentBranch(input.cwd).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.pull",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.listWorkflowRuns": (input) =>
      legacyGit.listWorkflowRuns(input).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.listWorkflowRuns",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.createWorktree": (input) =>
      legacyGit.createWorktree(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.createWorktree",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.removeWorktree": (input) =>
      legacyGit.removeWorktree(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.removeWorktree",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.createBranch": (input) =>
      legacyGit.createBranch(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.createBranch",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.createFork": (input) =>
      legacyGit.createFork(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.createFork",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.checkout": (input) =>
      Effect.scoped(legacyGit.checkoutBranch(input)).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.checkout",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.renameBranch": (input) =>
      legacyGit.renameBranch(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.renameBranch",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.deleteBranch": (input) =>
      legacyGit
        .deleteBranch({
          cwd: input.cwd,
          branch: input.branch,
          ...(input.force !== undefined ? { force: input.force } : {}),
        })
        .pipe(
          Effect.tap(() => refreshStatus(input)),
          Effect.mapError(
            (error) =>
              new WorkspaceCompatibilityError({
                operation: "git.deleteBranch",
                detail: error instanceof Error ? error.message : "Workspace operation failed.",
              }),
          ),
        ),
    "git.setBranchUpstream": (input) =>
      legacyGit.setBranchUpstream(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.setBranchUpstream",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.init": (input) =>
      legacyGit.initRepo(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.init",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.diff": (input) =>
      legacyGit.diff(input).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.diff",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.stageFiles": (input) =>
      legacyGit.stageFiles(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.stageFiles",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.unstageFiles": (input) =>
      legacyGit.unstageFiles(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.unstageFiles",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.discardChanges": (input) =>
      legacyGit.discardChanges(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.discardChanges",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.saveStash": (input) =>
      legacyGit.saveStash(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.saveStash",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.listStashes": (input) =>
      legacyGit.listStashes(input).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.listStashes",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.applyStash": (input) =>
      legacyGit.applyStash(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.applyStash",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.dropStash": (input) =>
      legacyGit.dropStash(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.dropStash",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.resolveConflict": (input) =>
      legacyGit.resolveConflict(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.resolveConflict",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.conflictSnapshot": (input) =>
      legacyGit.readConflictSnapshot(input).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.conflictSnapshot",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.applyHunk": (input) =>
      legacyGit.applyHunk(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.applyHunk",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.merge": (input) =>
      legacyGit.mergeBranch(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.merge",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.rebase": (input) =>
      legacyGit.rebaseBranch(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.rebase",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.continueOperation": (input) =>
      legacyGit.continueOperation(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.continueOperation",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.abortOperation": (input) =>
      legacyGit.abortOperation(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.abortOperation",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.skipRebase": (input) =>
      legacyGit.skipRebase(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.skipRebase",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.listPullRequests": (input) =>
      legacyPrManager.listPullRequests(input).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.listPullRequests",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.mutatePullRequest": (input) =>
      legacyPrManager.mutatePullRequest(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.mutatePullRequest",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.createPullRequest": (input) =>
      legacyPrManager.createPullRequest(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.createPullRequest",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.push": (input) =>
      legacyGit.pushCurrentBranch(input.cwd, null).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.push",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.performRepositoryAction": (input) =>
      Effect.gen(function* () {
        const operation = input.operation;
        for (const [key, value] of Object.entries(operation)) {
          if (
            key !== "action" &&
            typeof value === "string" &&
            (value.startsWith("-") || value.includes("\0"))
          ) {
            return yield* Effect.fail(
              new WorkspaceCompatibilityError({
                operation: "repositoryAction",
                detail: "Git arguments must not be command options.",
              }),
            );
          }
        }
        const args = (() => {
          switch (operation.action) {
            case "push_ref":
              return [
                "push",
                ...(operation.forceWithLease ? ["--force-with-lease"] : []),
                operation.remote,
                operation.ref,
              ];
            case "pull_ref":
              return ["pull", operation.remote, operation.ref];
            case "push_tag":
              return ["push", operation.remote, operation.tag];
            case "add_remote":
              return ["remote", "add", operation.name, operation.url];
            case "remove_remote":
              return ["remote", "remove", operation.name];
            case "reset":
              return ["reset", `--${operation.mode}`, operation.sha];
          }
        })();
        yield* legacyGit.execute({
          operation: `GitCore.${operation.action}`,
          cwd: input.cwd,
          args,
        });
      }).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.performRepositoryAction",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.publishRelease": (input) =>
      legacyGitEnvironment.publishRelease(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.publishRelease",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.triggerReleaseWorkflow": (input) =>
      legacyGitEnvironment.triggerReleaseWorkflow(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.triggerReleaseWorkflow",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.gitHubSwitchAccount": (input) =>
      legacyGitEnvironment.switchAccount(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.gitHubSwitchAccount",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.gitHubLogout": (input) =>
      legacyGitEnvironment.logout(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.gitHubLogout",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.amendCommit": (input) =>
      legacyGit.amendCommit(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.amendCommit",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.undoLastCommit": (input) =>
      legacyGit.undoLastCommit(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.undoLastCommit",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.revertCommit": (input) =>
      legacyGit.revertCommit(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.revertCommit",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.cherryPick": (input) =>
      legacyGit.cherryPick(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.cherryPick",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.createTag": (input) =>
      legacyGit.createTag(input).pipe(
        Effect.tap(() => refreshStatus(input)),
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.createTag",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "git.watchedBranchStatuses": (input) =>
      legacyGit.watchedBranchStatuses(input).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "git.watchedBranchStatuses",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "server.batchUpsertKeybindings": (input) =>
      keybindings
        .batchUpsertKeybindingRules(input.rules)
        .pipe(Effect.map((result) => ({ ...result, issues: [] })))
        .pipe(
          Effect.mapError(
            (error) =>
              new WorkspaceCompatibilityError({
                operation: "server.batchUpsertKeybindings",
                detail: error instanceof Error ? error.message : "Workspace operation failed.",
              }),
          ),
        ),
    "server.batchRemoveKeybindings": (input) =>
      keybindings
        .batchRemoveKeybindingRules(input.rules)
        .pipe(Effect.map((result) => ({ ...result, issues: [] })))
        .pipe(
          Effect.mapError(
            (error) =>
              new WorkspaceCompatibilityError({
                operation: "server.batchRemoveKeybindings",
                detail: error instanceof Error ? error.message : "Workspace operation failed.",
              }),
          ),
        ),
    "server.cloneRepository": (input) =>
      sourceControlRepositories.cloneRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "server.cloneRepository",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "server.lookupRepository": (input) =>
      sourceControlRepositories.lookupRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "server.lookupRepository",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
    "server.createSupportBundle": (input) =>
      Effect.gen(function* () {
        const descriptor = yield* serverEnvironment.getDescriptor;
        const traces = yield* TraceDiagnostics.readTraceDiagnostics({
          traceFilePath: config.serverTracePath,
          maxFiles: config.traceMaxFiles,
        });
        return yield* Effect.tryPromise({
          try: () =>
            createSupportBundle({
              environmentId: descriptor.environmentId,
              appVersion: descriptor.serverVersion,
              traces,
            }),
          catch: (error) =>
            new WorkspaceCompatibilityError({
              operation: "supportBundle",
              detail: error instanceof Error ? error.message : "Support bundle export failed.",
            }),
        });
      }).pipe(
        Effect.mapError(
          (error) =>
            new WorkspaceCompatibilityError({
              operation: "server.createSupportBundle",
              detail: error instanceof Error ? error.message : "Workspace operation failed.",
            }),
        ),
      ),
  });
});
