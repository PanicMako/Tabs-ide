// @effect-diagnostics nodeBuiltinImport:off - realpathSync.native resolves Windows 8.3 short names, which the Effect realPath does not.
import * as NodeFS from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform } from "@tabs/shared/hostProcess";
import { assert, it, describe } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Metric from "effect/Metric";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  GitCommandError,
  ReviewDiffPreviewInput,
  type ReviewDiffFileContentsInput,
  type ReviewDiffPreviewResult,
  type WorktreeSubmodules,
} from "@tabs/contracts";
import * as ServerConfig from "../config.ts";
import { gitCommandDuration } from "../observability/Metrics.ts";
import {
  makeGitVcsDriverCore,
  parseGitCheckoutProgressLine,
  splitNullSeparatedGitStdoutPaths,
} from "./GitVcsDriverCore.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";

const encodeGitCommandError = Schema.encodeEffect(Schema.fromJsonString(GitCommandError));

const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-git-vcs-driver-test-",
});
const layerTest = GitVcsDriver.layer.pipe(
  Layer.provide(layerServerConfig),
  Layer.provideMerge(NodeServices.layer),
);

const makeNonRepositoryHandle = () =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(128)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.encodeText(Stream.make("fatal: not a git repository")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

const makeSuccessfulHandle = (stdout: string) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.encodeText(Stream.make(stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

const makeTmpDir = (
  prefix = "git-vcs-driver-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });

const writeTextFile = (
  cwd: string,
  relativePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const filePath = pathService.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(pathService.dirname(filePath), { recursive: true });
    yield* fileSystem.writeFileString(filePath, contents);
  });

const makeReviewDiffFileContentsInput = (
  cwd: string,
  overrides: Partial<Omit<ReviewDiffFileContentsInput, "cwd">> = {},
): ReviewDiffFileContentsInput => ({
  cwd,
  sourceKind: "working-tree",
  changeType: "change",
  baseRef: "HEAD",
  headRef: null,
  oldPath: "README.md",
  newPath: "README.md",
  ...overrides,
});

const git = (
  cwd: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv,
): Effect.Effect<string, GitCommandError, GitVcsDriver.GitVcsDriver> =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const result = yield* driver.execute({
      operation: "GitVcsDriver.test.git",
      cwd,
      args,
      ...(env ? { env } : {}),
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });

const initRepoWithCommit = (
  cwd: string,
): Effect.Effect<
  { readonly initialBranch: string },
  GitCommandError | PlatformError.PlatformError,
  GitVcsDriver.GitVcsDriver | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    yield* driver.initRepo({ cwd });
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(cwd, "README.md", "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
    const initialBranch = yield* git(cwd, ["branch", "--show-current"]);
    return { initialBranch };
  });

it.effect("audit real gitlink failure preserves worktree and reports failure", () =>
  Effect.gen(function* () {
    const cwd = yield* makeTmpDir();
    const { initialBranch } = yield* initRepoWithCommit(cwd);
    yield* writeTextFile(
      cwd,
      ".gitmodules",
      '[submodule "missing"]\n\tpath = missing\n\turl = /nonexistent/tabs-audit-repo.git\n',
    );
    const sha = yield* git(cwd, ["rev-parse", "HEAD"]);
    yield* git(cwd, ["add", ".gitmodules"]);
    yield* git(cwd, ["update-index", "--add", "--cacheinfo", `160000,${sha},missing`]);
    yield* git(cwd, ["commit", "-m", "actual gitlink"]);
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const target = path.join(yield* makeTmpDir(), "checkout");
    let finished: { ok: boolean; detail: string | null } | undefined;
    const result = yield* (yield* GitVcsDriver.GitVcsDriver).createWorktree(
      { cwd, path: target, refName: initialBranch, newRefName: "audit/failure" },
      {
        progress: {
          onSubmodulesFinished: (value) =>
            Effect.sync(() => {
              finished = value;
            }),
        },
      },
    );
    assert.equal(result.worktree.path, target);
    assert.isTrue(yield* fs.exists(target));
    assert.isDefined(finished);
    assert.equal(finished!.ok, false);
    assert.isString(finished!.detail);
  }).pipe(Effect.provide(layerTest)),
);
