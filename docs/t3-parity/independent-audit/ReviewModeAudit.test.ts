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

it.layer(layerTest)("mode audit", (it) => {
  it.effect("preserves renames, unusual paths, modes, and binary statistics", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTmpDir();
      const { initialBranch } = yield* initRepoWithCommit(cwd);
      const driver = yield* GitVcsDriver.GitVcsDriver;
      yield* writeTextFile(cwd, "mode-only.sh", "echo unchanged\n");
      yield* git(cwd, ["add", "mode-only.sh"]);
      yield* git(cwd, ["commit", "-m", "add executable candidate"]);
      yield* git(cwd, ["checkout", "-b", "feature/paths"]);
      yield* git(cwd, ["mv", "README.md", "renamed.md"]);
      yield* writeTextFile(cwd, "[literal].txt", "literal\n");
      yield* writeTextFile(cwd, " leading.txt", "whitespace path\n");
      yield* writeTextFile(cwd, "l.txt", "other\n");
      yield* writeTextFile(cwd, "binary.dat", "binary\0data");
      if ((yield* HostProcessPlatform) !== "win32") {
        yield* writeTextFile(cwd, "tab\tand\nnewline.txt", "unusual path\n");
      }
      yield* git(cwd, ["add", "."]);
      yield* git(cwd, ["update-index", "--chmod=+x", "mode-only.sh"]);
      yield* git(cwd, ["commit", "-m", "rename and add files"]);
      yield* (yield* FileSystem.FileSystem).chmod(`${cwd}/mode-only.sh`, 0o755);
      const preview = yield* driver.getReviewDiffPreview({
        cwd,
        baseRef: initialBranch,
      });
      const branch = preview.sources.find((source) => source.kind === "branch-range")!;
      for (const path of ["renamed.md", "[literal].txt", " leading.txt", "mode-only.sh"]) {
        const stat = branch.files!.find((file) => file.path === path);
        assert.isDefined(stat, `missing mode/path fixture entry: ${path}`);
        const request = yield* Schema.decodeEffect(ReviewDiffPreviewInput)({
          cwd,
          baseRef: initialBranch,
          file: { path, previousPath: stat.previousPath, sourceKind: "branch-range" },
        });
        const result = yield* driver.getReviewDiffPreview(request);
        const scoped = result.sources.find((source) => source.kind === "branch-range")!;
        assert.deepStrictEqual(scoped.files, [stat]);
        assert.notInclude(scoped.diff, "b/l.txt");
        if (path === "renamed.md") assert.include(scoped.diff, "rename from README.md");
        if (path === "mode-only.sh") {
          assert.include(scoped.diff, "old mode 100644");
          assert.include(scoped.diff, "new mode 100755");
        }
      }
      assert.include(branch.diff, "rename from README.md");
      assert.include(branch.diff, "rename to renamed.md");
      assert.deepInclude(branch.files ?? [], {
        path: "renamed.md",
        previousPath: "README.md",
        additions: 0,
        deletions: 0,
      });
      assert.deepInclude(branch.files ?? [], {
        path: "binary.dat",
        previousPath: null,
        additions: 0,
        deletions: 0,
      });
      if ((yield* HostProcessPlatform) !== "win32") {
        assert.deepInclude(branch.files ?? [], {
          path: "tab\tand\nnewline.txt",
          previousPath: null,
          additions: 1,
          deletions: 0,
        });
      }
    }),
  );
});
