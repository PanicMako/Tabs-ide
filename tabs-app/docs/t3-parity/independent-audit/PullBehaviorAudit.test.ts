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

it.effect("audit pull fast-forwards, skips unchanged and refuses divergence", () =>
  Effect.gen(function* () {
    const cwd = yield* makeTmpDir();
    const remote = yield* makeTmpDir();
    const peer = yield* makeTmpDir();
    const { initialBranch } = yield* initRepoWithCommit(cwd);
    const driver = yield* GitVcsDriver.GitVcsDriver;
    yield* git(remote, ["init", "--bare"]);
    yield* git(cwd, ["remote", "add", "origin", remote]);
    yield* git(cwd, ["push", "-u", "origin", initialBranch]);
    yield* git(remote, ["symbolic-ref", "HEAD", `refs/heads/${initialBranch}`]);
    yield* git(peer, ["clone", remote, "."]);
    yield* git(peer, ["config", "user.email", "audit@example.invalid"]);
    yield* git(peer, ["config", "user.name", "Audit"]);
    yield* writeTextFile(peer, "remote.txt", "remote update\n");
    yield* git(peer, ["add", "."]);
    yield* git(peer, ["commit", "-m", "remote update"]);
    yield* git(peer, ["push"]);
    const upstreamSha = yield* git(peer, ["rev-parse", "HEAD"]);
    const pulled = yield* driver.pullCurrentBranch(cwd);
    assert.equal(pulled.status, "pulled");
    assert.equal(yield* git(cwd, ["rev-parse", "HEAD"]), upstreamSha);
    assert.equal((yield* driver.pullCurrentBranch(cwd)).status, "skipped_up_to_date");
    yield* writeTextFile(cwd, "local.txt", "local commit\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "local"]);
    const localSha = yield* git(cwd, ["rev-parse", "HEAD"]);
    yield* writeTextFile(peer, "remote.txt", "divergent remote\n");
    yield* git(peer, ["commit", "-am", "remote divergent"]);
    yield* git(peer, ["push"]);
    const failed = yield* driver.pullCurrentBranch(cwd).pipe(Effect.result);
    assert.isTrue(Result.isFailure(failed));
    assert.equal(yield* git(cwd, ["rev-parse", "HEAD"]), localSha);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    assert.equal(yield* fs.readFileString(path.join(cwd, "local.txt")), "local commit\n");
  }).pipe(Effect.provide(layerTest)),
);
it.effect("audit pull rejects absent upstream and detached HEAD", () =>
  Effect.gen(function* () {
    const cwd = yield* makeTmpDir();
    yield* initRepoWithCommit(cwd);
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const missing = yield* driver.pullCurrentBranch(cwd).pipe(Effect.flip);
    assert.include(missing.detail, "no upstream");
    yield* git(cwd, ["checkout", "--detach"]);
    const detached = yield* driver.pullCurrentBranch(cwd).pipe(Effect.flip);
    assert.include(detached.detail, "detached HEAD");
  }).pipe(Effect.provide(layerTest)),
);
