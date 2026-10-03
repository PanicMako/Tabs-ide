import * as Context from "effect/Context";
import {
  Cache,
  Data,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  PlatformError,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { type GitOperationState, type GitStatusFile, type GitWorkflowRun } from "@tabs/contracts";

import { GitCommandError } from "../Errors.ts";
import {
  getCachedPushAccess,
  resolvePushAccess,
  setCachedPushAccess,
  type GitPushAccess,
} from "../Services/PushAccessCache.ts";
import {
  GitCore,
  type ExecuteGitProgress,
  type GitCommitOptions,
  type GitCoreShape,
  type ExecuteGitInput,
  type ExecuteGitResult,
} from "../Services/GitCore.ts";
import { ServerConfig } from "../../config.ts";
import { runProcess } from "../../processRunner.ts";
import { decodeJsonResult } from "@tabs/shared/schemaJson";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 20_000_000;
const STATUS_UPSTREAM_REFRESH_INTERVAL = Duration.seconds(15);
const STATUS_UPSTREAM_REFRESH_TIMEOUT = Duration.seconds(5);
const STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY = 2_048;
const DEFAULT_BASE_BRANCH_CANDIDATES = ["main", "master"] as const;
const DEFAULT_HISTORY_LIMIT = 40;
const GIT_LOG_RECORD_SEPARATOR = "\u001e";
const GIT_LOG_FIELD_SEPARATOR = "\u001f";

type TraceTailState = {
  processedChars: number;
  remainder: string;
};

class StatusUpstreamRefreshCacheKey extends Data.Class<{
  cwd: string;
  upstreamRef: string;
  remoteName: string;
  upstreamBranch: string;
}> {}

interface ExecuteGitOptions {
  timeoutMs?: number | undefined;
  allowNonZeroExit?: boolean | undefined;
  fallbackErrorMessage?: string | undefined;
  progress?: ExecuteGitProgress | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

function parseBranchAb(value: string): { ahead: number; behind: number } {
  const match = value.match(/^\+(\d+)\s+-(\d+)$/);
  if (!match) return { ahead: 0, behind: 0 };
  return {
    ahead: Number(match[1] ?? "0"),
    behind: Number(match[2] ?? "0"),
  };
}

function parseNumstatEntries(
  stdout: string,
): Array<{ path: string; insertions: number; deletions: number }> {
  const entries: Array<{ path: string; insertions: number; deletions: number }> = [];
  for (const line of stdout.split(/\r?\n/g)) {
    if (line.trim().length === 0) continue;
    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const rawPath =
      pathParts.length > 1 ? (pathParts.at(-1) ?? "").trim() : pathParts.join("\t").trim();
    if (rawPath.length === 0) continue;
    const added = Number.parseInt(addedRaw ?? "0", 10);
    const deleted = Number.parseInt(deletedRaw ?? "0", 10);
    const renameArrowIndex = rawPath.indexOf(" => ");
    const normalizedPath =
      renameArrowIndex >= 0 ? rawPath.slice(renameArrowIndex + " => ".length).trim() : rawPath;
    entries.push({
      path: normalizedPath.length > 0 ? normalizedPath : rawPath,
      insertions: Number.isFinite(added) ? added : 0,
      deletions: Number.isFinite(deleted) ? deleted : 0,
    });
  }
  return entries;
}

function buildDiffStats(stdout: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  const entries = parseNumstatEntries(stdout);
  return entries.reduce(
    (acc, entry) => ({
      filesChanged: acc.filesChanged + 1,
      insertions: acc.insertions + entry.insertions,
      deletions: acc.deletions + entry.deletions,
    }),
    { filesChanged: 0, insertions: 0, deletions: 0 },
  );
}

function extractCheckoutOverwritePaths(detail: string): string[] {
  const paths = new Set<string>();
  for (const line of detail.split(/\r?\n/g)) {
    if (!line.startsWith("\t")) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    paths.add(trimmed);
  }
  return [...paths];
}

function summarizeCheckoutBlockedDetail(branch: string, detail: string): string {
  const paths = extractCheckoutOverwritePaths(detail);
  const count = paths.length;
  if (count === 0) {
    return `Cannot switch to "${branch}" because local changes would be overwritten. Commit, stash, or discard those changes first.`;
  }
  const preview = paths.slice(0, 3).join(", ");
  const remainingCount = Math.max(0, count - 3);
  return `Cannot switch to "${branch}" because ${count} modified file${count === 1 ? "" : "s"} would be overwritten. Commit, stash, or discard those changes first. Affected: ${preview}${remainingCount > 0 ? `, and ${remainingCount} more` : ""}.`;
}

function normalizeCheckoutBranchError(
  error: GitCommandError,
  input: { cwd: string; branch: string; args: ReadonlyArray<string> },
): GitCommandError {
  if (!error.detail.toLowerCase().includes("would be overwritten by checkout")) {
    return error;
  }
  return createGitCommandError(
    "GitCore.checkoutBranch.checkout",
    input.cwd,
    input.args,
    summarizeCheckoutBlockedDetail(input.branch, error.detail),
    error,
  );
}

function parseGitHistoryEntries(stdout: string) {
  return stdout
    .split(GIT_LOG_RECORD_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [
        sha = "",
        shortSha = "",
        authorName = "",
        authoredAt = "",
        refsRaw = "",
        subject = "",
      ] = entry.split(GIT_LOG_FIELD_SEPARATOR);
      const refs = refsRaw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const normalizedSubject = subject.trim().length > 0 ? subject.trim() : "(no subject)";
      const normalizedAuthor = authorName.trim().length > 0 ? authorName.trim() : "Unknown author";
      return {
        sha: sha.trim(),
        shortSha: shortSha.trim(),
        subject: normalizedSubject,
        authorName: normalizedAuthor,
        authoredAt: authoredAt.trim(),
        refs,
        isHead: refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> ")),
      };
    })
    .filter((entry) => entry.sha.length > 0 && entry.shortSha.length > 0);
}

function parsePorcelainPath(line: string): string | null {
  if (line.startsWith("? ") || line.startsWith("! ")) {
    const simple = line.slice(2).trim();
    return simple.length > 0 ? simple : null;
  }

  if (!(line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u "))) {
    return null;
  }

  const tabIndex = line.indexOf("\t");
  if (tabIndex >= 0) {
    const fromTab = line.slice(tabIndex + 1);
    const [filePath] = fromTab.split("\t");
    return filePath?.trim().length ? filePath.trim() : null;
  }

  const parts = line.trim().split(/\s+/g);
  const filePath = parts.at(-1) ?? "";
  return filePath.length > 0 ? filePath : null;
}

function parsePorcelainFileFlags(line: string): {
  path: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
} | null {
  if (line.startsWith("? ")) {
    const path = parsePorcelainPath(line);
    if (!path) return null;
    return {
      path,
      staged: false,
      unstaged: true,
      untracked: true,
      conflicted: false,
    };
  }

  if (line.startsWith("u ")) {
    const path = parsePorcelainPath(line);
    if (!path) return null;
    return {
      path,
      staged: true,
      unstaged: true,
      untracked: false,
      conflicted: true,
    };
  }

  if (!(line.startsWith("1 ") || line.startsWith("2 "))) {
    return null;
  }

  const statusToken = line.slice(2, 4);
  const indexStatus = statusToken[0] ?? ".";
  const worktreeStatus = statusToken[1] ?? ".";
  const path = parsePorcelainPath(line);
  if (!path) return null;

  return {
    path,
    staged: indexStatus !== "." && indexStatus !== " ",
    unstaged: worktreeStatus !== "." && worktreeStatus !== " ",
    untracked: false,
    conflicted: indexStatus === "U" || worktreeStatus === "U",
  };
}

function parseStashEntries(stdout: string) {
  return stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [stashRef = "", sha = "", message = "", createdAt = ""] =
        line.split(GIT_LOG_FIELD_SEPARATOR);
      const normalizedMessage = message.trim().length > 0 ? message.trim() : "(no message)";
      return {
        stashRef: stashRef.trim(),
        sha: sha.trim(),
        shortSha: sha.trim().slice(0, 7),
        message: normalizedMessage,
        createdAt: createdAt.trim(),
      };
    })
    .filter(
      (entry) =>
        entry.stashRef.length > 0 &&
        entry.sha.length > 0 &&
        entry.shortSha.length > 0 &&
        entry.createdAt.length > 0,
    );
}

function parseBranchLine(line: string): { name: string; current: boolean } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const name = trimmed.replace(/^[*+]\s+/, "");
  // Exclude symbolic refs like: "origin/HEAD -> origin/main".
  // Exclude detached HEAD pseudo-refs like: "(HEAD detached at origin/main)".
  if (name.includes(" -> ") || name.startsWith("(")) return null;

  return {
    name,
    current: trimmed.startsWith("* "),
  };
}

function parseRemoteNames(stdout: string): ReadonlyArray<string> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .toSorted((a, b) => b.length - a.length);
}

function sanitizeRemoteName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "fork";
}

function normalizeRemoteUrl(value: string): string {
  return value
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function parseRemoteFetchUrls(stdout: string): Map<string, string> {
  const remotes = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
    if (!match) continue;
    const [, remoteName = "", remoteUrl = "", direction = ""] = match;
    if (direction !== "fetch" || remoteName.length === 0 || remoteUrl.length === 0) {
      continue;
    }
    remotes.set(remoteName, remoteUrl);
  }
  return remotes;
}

function parseRemoteRefWithRemoteNames(
  branchName: string,
  remoteNames: ReadonlyArray<string>,
): { remoteRef: string; remoteName: string; localBranch: string } | null {
  const trimmedBranchName = branchName.trim();
  if (trimmedBranchName.length === 0) return null;

  for (const remoteName of remoteNames) {
    const remotePrefix = `${remoteName}/`;
    if (!trimmedBranchName.startsWith(remotePrefix)) {
      continue;
    }
    const localBranch = trimmedBranchName.slice(remotePrefix.length).trim();
    if (localBranch.length === 0) {
      return null;
    }
    return {
      remoteRef: trimmedBranchName,
      remoteName,
      localBranch,
    };
  }

  return null;
}

function parseTrackingBranchByUpstreamRef(stdout: string, upstreamRef: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }
    const [branchNameRaw, upstreamBranchRaw = ""] = trimmedLine.split("\t");
    const branchName = branchNameRaw?.trim() ?? "";
    const upstreamBranch = upstreamBranchRaw.trim();
    if (branchName.length === 0 || upstreamBranch.length === 0) {
      continue;
    }
    if (upstreamBranch === upstreamRef) {
      return branchName;
    }
  }

  return null;
}

function deriveLocalBranchNameFromRemoteRef(branchName: string): string | null {
  const separatorIndex = branchName.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === branchName.length - 1) {
    return null;
  }
  const localBranch = branchName.slice(separatorIndex + 1).trim();
  return localBranch.length > 0 ? localBranch : null;
}

function commandLabel(args: readonly string[]): string {
  return `git ${args.join(" ")}`;
}

function parseDefaultBranchFromRemoteHeadRef(value: string, remoteName: string): string | null {
  const trimmed = value.trim();
  const prefix = `refs/remotes/${remoteName}/`;
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const branch = trimmed.slice(prefix.length).trim();
  return branch.length > 0 ? branch : null;
}

function createGitCommandError(
  operation: string,
  cwd: string,
  args: readonly string[],
  detail: string,
  cause?: unknown,
): GitCommandError {
  return new GitCommandError({
    operation,
    command: commandLabel(args),
    cwd,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function quoteGitCommand(args: ReadonlyArray<string>): string {
  return `git ${args.join(" ")}`;
}

function toGitCommandError(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  detail: string,
) {
  return (cause: unknown) =>
    Schema.is(GitCommandError)(cause)
      ? cause
      : new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${cause instanceof Error && cause.message.length > 0 ? cause.message : "Unknown error"} - ${detail}`,
          ...(cause !== undefined ? { cause } : {}),
        });
}

interface Trace2Monitor {
  readonly env: NodeJS.ProcessEnv;
  readonly flush: Effect.Effect<void, never>;
}

function trace2ChildKey(record: Record<string, unknown>): string | null {
  const childId = record.child_id;
  if (typeof childId === "number" || typeof childId === "string") {
    return String(childId);
  }
  const hookName = record.hook_name;
  return typeof hookName === "string" && hookName.trim().length > 0 ? hookName.trim() : null;
}

const Trace2Record = Schema.Record(Schema.String, Schema.Unknown);

const createTrace2Monitor = Effect.fn(function* (
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  progress: ExecuteGitProgress | undefined,
): Effect.fn.Return<
  Trace2Monitor,
  PlatformError.PlatformError,
  Scope.Scope | FileSystem.FileSystem | Path.Path
> {
  if (!progress?.onHookStarted && !progress?.onHookFinished) {
    return {
      env: {},
      flush: Effect.void,
    };
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const traceFilePath = yield* fs.makeTempFileScoped({
    prefix: `tabs-git-trace2-${process.pid}-`,
    suffix: ".json",
  });
  const hookStartByChildKey = new Map<string, { hookName: string; startedAtMs: number }>();
  const traceTailState = yield* Ref.make<TraceTailState>({
    processedChars: 0,
    remainder: "",
  });

  const handleTraceLine = (line: string) =>
    Effect.gen(function* () {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) {
        return;
      }

      const traceRecord = decodeJsonResult(Trace2Record)(trimmedLine);
      if (Result.isFailure(traceRecord)) {
        yield* Effect.logDebug(
          `GitCore.trace2: failed to parse trace line for ${quoteGitCommand(input.args)} in ${input.cwd}`,
          traceRecord.failure,
        );
        return;
      }

      if (traceRecord.success.child_class !== "hook") {
        return;
      }

      const event = traceRecord.success.event;
      const childKey = trace2ChildKey(traceRecord.success);
      if (childKey === null) {
        return;
      }
      const started = hookStartByChildKey.get(childKey);
      const hookNameFromEvent =
        typeof traceRecord.success.hook_name === "string"
          ? traceRecord.success.hook_name.trim()
          : "";
      const hookName = hookNameFromEvent.length > 0 ? hookNameFromEvent : (started?.hookName ?? "");
      if (hookName.length === 0) {
        return;
      }

      if (event === "child_start") {
        hookStartByChildKey.set(childKey, { hookName, startedAtMs: Date.now() });
        if (progress.onHookStarted) {
          yield* progress.onHookStarted(hookName);
        }
        return;
      }

      if (event === "child_exit") {
        hookStartByChildKey.delete(childKey);
        if (progress.onHookFinished) {
          const code = traceRecord.success.code;
          yield* progress.onHookFinished({
            hookName: started?.hookName ?? hookName,
            exitCode: typeof code === "number" && Number.isInteger(code) ? code : null,
            durationMs: started ? Math.max(0, Date.now() - started.startedAtMs) : null,
          });
        }
      }
    });

  const deltaMutex = yield* Semaphore.make(1);
  const readTraceDelta = deltaMutex.withPermit(
    fs.readFileString(traceFilePath).pipe(
      Effect.flatMap((contents) =>
        Effect.uninterruptible(
          Ref.modify(traceTailState, ({ processedChars, remainder }) => {
            if (contents.length <= processedChars) {
              return [[], { processedChars, remainder }];
            }

            const appended = contents.slice(processedChars);
            const combined = remainder + appended;
            const lines = combined.split("\n");
            const nextRemainder = lines.pop() ?? "";

            return [
              lines.map((line) => line.replace(/\r$/, "")),
              {
                processedChars: contents.length,
                remainder: nextRemainder,
              },
            ];
          }).pipe(
            Effect.flatMap((lines) => Effect.forEach(lines, handleTraceLine, { discard: true })),
          ),
        ),
      ),
      Effect.ignore({ log: true }),
    ),
  );
  const traceFileName = path.basename(traceFilePath);
  yield* Stream.runForEach(fs.watch(traceFilePath), (event) => {
    const eventPath = event.path;
    const isTargetTraceEvent =
      eventPath === traceFilePath ||
      eventPath === traceFileName ||
      path.basename(eventPath) === traceFileName;
    if (!isTargetTraceEvent) return Effect.void;
    return readTraceDelta;
  }).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* readTraceDelta;
      const finalLine = yield* Ref.modify(traceTailState, ({ processedChars, remainder }) => [
        remainder.trim(),
        {
          processedChars,
          remainder: "",
        },
      ]);
      if (finalLine.length > 0) {
        yield* handleTraceLine(finalLine);
      }
    }),
  );

  return {
    env: {
      GIT_TRACE2_EVENT: traceFilePath,
    },
    flush: readTraceDelta,
  };
});

const collectOutput = Effect.fn(function* <E>(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  stream: Stream.Stream<Uint8Array, E>,
  maxOutputBytes: number,
  onLine: ((line: string) => Effect.Effect<void, never>) | undefined,
): Effect.fn.Return<string, GitCommandError> {
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  let lineBuffer = "";

  const emitCompleteLines = (flush: boolean) =>
    Effect.gen(function* () {
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (line.length > 0 && onLine) {
          yield* onLine(line);
        }
        newlineIndex = lineBuffer.indexOf("\n");
      }

      if (flush) {
        const trailing = lineBuffer.replace(/\r$/, "");
        lineBuffer = "";
        if (trailing.length > 0 && onLine) {
          yield* onLine(trailing);
        }
      }
    });

  yield* Stream.runForEach(stream, (chunk) =>
    Effect.gen(function* () {
      bytes += chunk.byteLength;
      if (bytes > maxOutputBytes) {
        return yield* new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${quoteGitCommand(input.args)} output exceeded ${maxOutputBytes} bytes and was truncated.`,
        });
      }
      const decoded = decoder.decode(chunk, { stream: true });
      text += decoded;
      lineBuffer += decoded;
      yield* emitCompleteLines(false);
    }),
  ).pipe(Effect.mapError(toGitCommandError(input, "output stream failed.")));

  const remainder = decoder.decode();
  text += remainder;
  lineBuffer += remainder;
  yield* emitCompleteLines(true);
  return text;
});

export const makeGitCore = (options?: { executeOverride?: GitCoreShape["execute"] }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { worktreesDir } = yield* ServerConfig;

    let execute: GitCoreShape["execute"];

    if (options?.executeOverride) {
      execute = options.executeOverride;
    } else {
      const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      execute = Effect.fnUntraced(function* (input) {
        const commandInput = {
          ...input,
          args: [...input.args],
        } as const;
        const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

        const commandEffect = Effect.gen(function* () {
          const trace2Monitor = yield* createTrace2Monitor(commandInput, input.progress).pipe(
            Effect.provideService(Path.Path, path),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.mapError(toGitCommandError(commandInput, "failed to create trace2 monitor.")),
          );
          const child = yield* commandSpawner
            .spawn(
              ChildProcess.make("git", commandInput.args, {
                cwd: commandInput.cwd,
                env: {
                  ...process.env,
                  ...input.env,
                  ...trace2Monitor.env,
                },
              }),
            )
            .pipe(Effect.mapError(toGitCommandError(commandInput, "failed to spawn.")));

          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              collectOutput(
                commandInput,
                child.stdout,
                maxOutputBytes,
                input.progress?.onStdoutLine,
              ),
              collectOutput(
                commandInput,
                child.stderr,
                maxOutputBytes,
                input.progress?.onStderrLine,
              ),
              child.exitCode.pipe(
                Effect.map((value) => Number(value)),
                Effect.mapError(toGitCommandError(commandInput, "failed to report exit code.")),
              ),
            ],
            { concurrency: "unbounded" },
          );
          yield* trace2Monitor.flush;

          if (!input.allowNonZeroExit && exitCode !== 0) {
            const trimmedStderr = stderr.trim();
            return yield* new GitCommandError({
              operation: commandInput.operation,
              command: quoteGitCommand(commandInput.args),
              cwd: commandInput.cwd,
              detail:
                trimmedStderr.length > 0
                  ? `${quoteGitCommand(commandInput.args)} failed: ${trimmedStderr}`
                  : `${quoteGitCommand(commandInput.args)} failed with code ${exitCode}.`,
            });
          }

          return { code: exitCode, stdout, stderr } satisfies ExecuteGitResult;
        });

        return yield* commandEffect.pipe(
          Effect.scoped,
          Effect.timeoutOption(timeoutMs),
          Effect.flatMap((result) =>
            Option.match(result, {
              onNone: () =>
                Effect.fail(
                  new GitCommandError({
                    operation: commandInput.operation,
                    command: quoteGitCommand(commandInput.args),
                    cwd: commandInput.cwd,
                    detail: `${quoteGitCommand(commandInput.args)} timed out.`,
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );
      });
    }

    const executeGit = (
      operation: string,
      cwd: string,
      args: readonly string[],
      options: ExecuteGitOptions = {},
    ): Effect.Effect<{ code: number; stdout: string; stderr: string }, GitCommandError> =>
      execute({
        operation,
        cwd,
        args,
        allowNonZeroExit: true,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.progress ? { progress: options.progress } : {}),
      }).pipe(
        Effect.flatMap((result) => {
          if (options.allowNonZeroExit || result.code === 0) {
            return Effect.succeed(result);
          }
          const stderr = result.stderr.trim();
          if (stderr.length > 0) {
            return Effect.fail(createGitCommandError(operation, cwd, args, stderr));
          }
          if (options.fallbackErrorMessage) {
            return Effect.fail(
              createGitCommandError(operation, cwd, args, options.fallbackErrorMessage),
            );
          }
          return Effect.fail(
            createGitCommandError(
              operation,
              cwd,
              args,
              `${commandLabel(args)} failed: code=${result.code ?? "null"}`,
            ),
          );
        }),
      );

    const runGit = (
      operation: string,
      cwd: string,
      args: readonly string[],
      allowNonZeroExit = false,
    ): Effect.Effect<void, GitCommandError> =>
      executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(Effect.asVoid);

    const runGitStdout = (
      operation: string,
      cwd: string,
      args: readonly string[],
      allowNonZeroExit = false,
    ): Effect.Effect<string, GitCommandError> =>
      executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(
        Effect.map((result) => result.stdout),
      );

    const runGitStdoutNullable = (
      operation: string,
      cwd: string,
      args: readonly string[],
    ): Effect.Effect<string | null, GitCommandError> =>
      executeGit(operation, cwd, args, { allowNonZeroExit: true }).pipe(
        Effect.map((result) => (result.code === 0 ? result.stdout : null)),
      );

    const writePatchFileScoped = (
      patchContents: string,
    ): Effect.Effect<string, PlatformError.PlatformError, Scope.Scope> =>
      Effect.gen(function* () {
        const patchFile = yield* fileSystem.makeTempFileScoped({
          prefix: "tabs-git-hunk-",
          suffix: ".patch",
        });
        yield* fileSystem.writeFileString(patchFile, patchContents);
        return patchFile;
      });

    const pathExists = (candidatePath: string) =>
      fileSystem.stat(candidatePath).pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false)),
      );

    const runGitNoEditor = (
      operation: string,
      cwd: string,
      args: readonly string[],
      allowNonZeroExit = false,
    ): Effect.Effect<void, GitCommandError> =>
      executeGit(operation, cwd, args, {
        allowNonZeroExit,
        env: {
          GIT_EDITOR: ":",
          VISUAL: ":",
        },
      }).pipe(Effect.asVoid);

    const readGitOperationState = (
      cwd: string,
      conflictedFileCount: number,
    ): Effect.Effect<GitOperationState | null, GitCommandError> =>
      Effect.gen(function* () {
        const [mergeHeadPathRaw, rebaseMergePathRaw, rebaseApplyPathRaw] = yield* Effect.all(
          [
            runGitStdout("GitCore.operationPath.mergeHead", cwd, [
              "rev-parse",
              "--git-path",
              "MERGE_HEAD",
            ]),
            runGitStdout("GitCore.operationPath.rebaseMerge", cwd, [
              "rev-parse",
              "--git-path",
              "rebase-merge",
            ]),
            runGitStdout("GitCore.operationPath.rebaseApply", cwd, [
              "rev-parse",
              "--git-path",
              "rebase-apply",
            ]),
          ],
          { concurrency: "unbounded" },
        );

        const resolveGitPath = (raw: string) => {
          const trimmed = raw.trim();
          return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
        };

        const [hasMergeHead, hasRebaseMerge, hasRebaseApply] = yield* Effect.all(
          [
            pathExists(resolveGitPath(mergeHeadPathRaw)),
            pathExists(resolveGitPath(rebaseMergePathRaw)),
            pathExists(resolveGitPath(rebaseApplyPathRaw)),
          ],
          { concurrency: "unbounded" },
        );

        if (hasMergeHead) {
          return {
            kind: "merge",
            status: conflictedFileCount > 0 ? "conflicted" : "in_progress",
          };
        }

        if (hasRebaseMerge || hasRebaseApply) {
          return {
            kind: "rebase",
            status: conflictedFileCount > 0 ? "conflicted" : "in_progress",
          };
        }

        return null;
      });

    const branchExists = (cwd: string, branch: string): Effect.Effect<boolean, GitCommandError> =>
      executeGit(
        "GitCore.branchExists",
        cwd,
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        {
          allowNonZeroExit: true,
          timeoutMs: 5_000,
        },
      ).pipe(Effect.map((result) => result.code === 0));

    const resolveAvailableBranchName = (
      cwd: string,
      desiredBranch: string,
    ): Effect.Effect<string, GitCommandError> =>
      Effect.gen(function* () {
        const isDesiredTaken = yield* branchExists(cwd, desiredBranch);
        if (!isDesiredTaken) {
          return desiredBranch;
        }

        for (let suffix = 1; suffix <= 100; suffix += 1) {
          const candidate = `${desiredBranch}-${suffix}`;
          const isCandidateTaken = yield* branchExists(cwd, candidate);
          if (!isCandidateTaken) {
            return candidate;
          }
        }

        return yield* createGitCommandError(
          "GitCore.renameBranch",
          cwd,
          ["branch", "-m", "--", desiredBranch],
          `Could not find an available branch name for '${desiredBranch}'.`,
        );
      });

    const resolveCurrentUpstream = (
      cwd: string,
    ): Effect.Effect<
      { upstreamRef: string; remoteName: string; upstreamBranch: string } | null,
      GitCommandError
    > =>
      Effect.gen(function* () {
        const upstreamRef = yield* runGitStdout(
          "GitCore.resolveCurrentUpstream",
          cwd,
          ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
          true,
        ).pipe(Effect.map((stdout) => stdout.trim()));

        if (upstreamRef.length === 0 || upstreamRef === "@{upstream}") {
          return null;
        }

        const separatorIndex = upstreamRef.indexOf("/");
        if (separatorIndex <= 0) {
          return null;
        }
        const remoteName = upstreamRef.slice(0, separatorIndex);
        const upstreamBranch = upstreamRef.slice(separatorIndex + 1);
        if (remoteName.length === 0 || upstreamBranch.length === 0) {
          return null;
        }

        return {
          upstreamRef,
          remoteName,
          upstreamBranch,
        };
      });

    const fetchUpstreamRef = (
      cwd: string,
      upstream: { upstreamRef: string; remoteName: string; upstreamBranch: string },
    ): Effect.Effect<void, GitCommandError> => {
      const refspec = `+refs/heads/${upstream.upstreamBranch}:refs/remotes/${upstream.upstreamRef}`;
      return runGit(
        "GitCore.fetchUpstreamRef",
        cwd,
        ["fetch", "--quiet", "--no-tags", upstream.remoteName, refspec],
        true,
      );
    };

    const fetchUpstreamRefForStatus = (
      cwd: string,
      upstream: { upstreamRef: string; remoteName: string; upstreamBranch: string },
    ): Effect.Effect<void, GitCommandError> => {
      const refspec = `+refs/heads/${upstream.upstreamBranch}:refs/remotes/${upstream.upstreamRef}`;
      return executeGit(
        "GitCore.fetchUpstreamRefForStatus",
        cwd,
        ["fetch", "--quiet", "--no-tags", upstream.remoteName, refspec],
        {
          allowNonZeroExit: true,
          timeoutMs: Duration.toMillis(STATUS_UPSTREAM_REFRESH_TIMEOUT),
        },
      ).pipe(Effect.asVoid);
    };

    const statusUpstreamRefreshCache = yield* Cache.makeWith(
      (cacheKey: StatusUpstreamRefreshCacheKey) =>
        Effect.gen(function* () {
          yield* fetchUpstreamRefForStatus(cacheKey.cwd, {
            upstreamRef: cacheKey.upstreamRef,
            remoteName: cacheKey.remoteName,
            upstreamBranch: cacheKey.upstreamBranch,
          });
          return true as const;
        }),
      {
        capacity: STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY,
        // Keep successful refreshes warm; drop failures immediately so next request can retry.
        timeToLive: (exit: any) =>
          Exit.isSuccess(exit) ? STATUS_UPSTREAM_REFRESH_INTERVAL : Duration.zero,
      },
    );

    const refreshStatusUpstreamIfStale = (cwd: string): Effect.Effect<void, GitCommandError> =>
      Effect.gen(function* () {
        const upstream = yield* resolveCurrentUpstream(cwd);
        if (!upstream) return;
        yield* Cache.get(
          statusUpstreamRefreshCache,
          new StatusUpstreamRefreshCacheKey({
            cwd,
            upstreamRef: upstream.upstreamRef,
            remoteName: upstream.remoteName,
            upstreamBranch: upstream.upstreamBranch,
          }),
        );
      });

    const refreshCheckedOutBranchUpstream = (cwd: string): Effect.Effect<void, GitCommandError> =>
      Effect.gen(function* () {
        const upstream = yield* resolveCurrentUpstream(cwd);
        if (!upstream) return;
        yield* fetchUpstreamRef(cwd, upstream);
      });

    const resolveDefaultBranchName = (
      cwd: string,
      remoteName: string,
    ): Effect.Effect<string | null, GitCommandError> =>
      executeGit(
        "GitCore.resolveDefaultBranchName",
        cwd,
        ["symbolic-ref", `refs/remotes/${remoteName}/HEAD`],
        { allowNonZeroExit: true },
      ).pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          return parseDefaultBranchFromRemoteHeadRef(result.stdout, remoteName);
        }),
      );

    const remoteBranchExists = (
      cwd: string,
      remoteName: string,
      branch: string,
    ): Effect.Effect<boolean, GitCommandError> =>
      executeGit(
        "GitCore.remoteBranchExists",
        cwd,
        ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteName}/${branch}`],
        {
          allowNonZeroExit: true,
        },
      ).pipe(Effect.map((result) => result.code === 0));

    const originRemoteExists = (cwd: string): Effect.Effect<boolean, GitCommandError> =>
      executeGit("GitCore.originRemoteExists", cwd, ["remote", "get-url", "origin"], {
        allowNonZeroExit: true,
      }).pipe(Effect.map((result) => result.code === 0));

    const listRemoteNames = (cwd: string): Effect.Effect<ReadonlyArray<string>, GitCommandError> =>
      runGitStdout("GitCore.listRemoteNames", cwd, ["remote"]).pipe(
        Effect.map((stdout) => parseRemoteNames(stdout).toReversed()),
      );

    const resolvePrimaryRemoteName = (cwd: string): Effect.Effect<string, GitCommandError> =>
      Effect.gen(function* () {
        if (yield* originRemoteExists(cwd)) {
          return "origin";
        }
        const remotes = yield* listRemoteNames(cwd);
        const [firstRemote] = remotes;
        if (firstRemote) {
          return firstRemote;
        }
        return yield* createGitCommandError(
          "GitCore.resolvePrimaryRemoteName",
          cwd,
          ["remote"],
          "No git remote is configured for this repository.",
        );
      });

    const resolvePushRemoteName = (
      cwd: string,
      branch: string,
    ): Effect.Effect<string | null, GitCommandError> =>
      Effect.gen(function* () {
        const branchPushRemote = yield* runGitStdout(
          "GitCore.resolvePushRemoteName.branchPushRemote",
          cwd,
          ["config", "--get", `branch.${branch}.pushRemote`],
          true,
        ).pipe(Effect.map((stdout) => stdout.trim()));
        if (branchPushRemote.length > 0) {
          return branchPushRemote;
        }

        const pushDefaultRemote = yield* runGitStdout(
          "GitCore.resolvePushRemoteName.remotePushDefault",
          cwd,
          ["config", "--get", "remote.pushDefault"],
          true,
        ).pipe(Effect.map((stdout) => stdout.trim()));
        if (pushDefaultRemote.length > 0) {
          return pushDefaultRemote;
        }

        return yield* resolvePrimaryRemoteName(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
      });

    const ensureRemote: GitCoreShape["ensureRemote"] = (input) =>
      Effect.gen(function* () {
        const preferredName = sanitizeRemoteName(input.preferredName);
        const normalizedTargetUrl = normalizeRemoteUrl(input.url);
        const remoteFetchUrls = yield* runGitStdout(
          "GitCore.ensureRemote.listRemoteUrls",
          input.cwd,
          ["remote", "-v"],
        ).pipe(Effect.map((stdout) => parseRemoteFetchUrls(stdout)));

        for (const [remoteName, remoteUrl] of remoteFetchUrls.entries()) {
          if (normalizeRemoteUrl(remoteUrl) === normalizedTargetUrl) {
            return remoteName;
          }
        }

        let remoteName = preferredName;
        let suffix = 1;
        while (remoteFetchUrls.has(remoteName)) {
          remoteName = `${preferredName}-${suffix}`;
          suffix += 1;
        }

        yield* runGit("GitCore.ensureRemote.add", input.cwd, [
          "remote",
          "add",
          remoteName,
          input.url,
        ]);
        return remoteName;
      });

    const resolveBaseBranchForNoUpstream = (
      cwd: string,
      branch: string,
    ): Effect.Effect<string | null, GitCommandError> =>
      Effect.gen(function* () {
        const configuredBaseBranch = yield* runGitStdout(
          "GitCore.resolveBaseBranchForNoUpstream.config",
          cwd,
          ["config", "--get", `branch.${branch}.gh-merge-base`],
          true,
        ).pipe(Effect.map((stdout) => stdout.trim()));

        const primaryRemoteName = yield* resolvePrimaryRemoteName(cwd).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        const defaultBranch =
          primaryRemoteName === null
            ? null
            : yield* resolveDefaultBranchName(cwd, primaryRemoteName);
        const candidates = [
          configuredBaseBranch.length > 0 ? configuredBaseBranch : null,
          defaultBranch,
          ...DEFAULT_BASE_BRANCH_CANDIDATES,
        ];

        for (const candidate of candidates) {
          if (!candidate) {
            continue;
          }

          const remotePrefix =
            primaryRemoteName && primaryRemoteName !== "origin" ? `${primaryRemoteName}/` : null;
          const normalizedCandidate = candidate.startsWith("origin/")
            ? candidate.slice("origin/".length)
            : remotePrefix && candidate.startsWith(remotePrefix)
              ? candidate.slice(remotePrefix.length)
              : candidate;
          if (normalizedCandidate.length === 0 || normalizedCandidate === branch) {
            continue;
          }

          if (yield* branchExists(cwd, normalizedCandidate)) {
            return normalizedCandidate;
          }

          if (
            primaryRemoteName &&
            (yield* remoteBranchExists(cwd, primaryRemoteName, normalizedCandidate))
          ) {
            return `${primaryRemoteName}/${normalizedCandidate}`;
          }
        }

        return null;
      });

    const computeAheadCountAgainstBase = (
      cwd: string,
      branch: string,
    ): Effect.Effect<number, GitCommandError> =>
      Effect.gen(function* () {
        const baseBranch = yield* resolveBaseBranchForNoUpstream(cwd, branch);
        if (!baseBranch) {
          return 0;
        }

        const result = yield* executeGit(
          "GitCore.computeAheadCountAgainstBase",
          cwd,
          ["rev-list", "--count", `${baseBranch}..HEAD`],
          { allowNonZeroExit: true },
        );
        if (result.code !== 0) {
          return 0;
        }

        const parsed = Number.parseInt(result.stdout.trim(), 10);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      });

    const readBranchRecency = (cwd: string): Effect.Effect<Map<string, number>, GitCommandError> =>
      Effect.gen(function* () {
        const branchRecency = yield* executeGit(
          "GitCore.readBranchRecency",
          cwd,
          [
            "for-each-ref",
            "--format=%(refname:short)%09%(committerdate:unix)",
            "refs/heads",
            "refs/remotes",
          ],
          {
            timeoutMs: 15_000,
            allowNonZeroExit: true,
          },
        );

        const branchLastCommit = new Map<string, number>();
        if (branchRecency.code !== 0) {
          return branchLastCommit;
        }

        for (const line of branchRecency.stdout.split("\n")) {
          if (line.length === 0) {
            continue;
          }
          const [name, lastCommitRaw] = line.split("\t");
          if (!name) {
            continue;
          }
          const lastCommit = Number.parseInt(lastCommitRaw ?? "0", 10);
          branchLastCommit.set(name, Number.isFinite(lastCommit) ? lastCommit : 0);
        }

        return branchLastCommit;
      });

    const statusDetails: GitCoreShape["statusDetails"] = (cwd) =>
      Effect.gen(function* () {
        yield* refreshStatusUpstreamIfStale(cwd).pipe(Effect.ignoreCause({ log: true }));

        const [statusStdout, unstagedNumstatStdout, stagedNumstatStdout] = yield* Effect.all(
          [
            runGitStdout("GitCore.statusDetails.status", cwd, [
              "status",
              "--porcelain=2",
              "--branch",
            ]),
            runGitStdout("GitCore.statusDetails.unstagedNumstat", cwd, ["diff", "--numstat"]),
            runGitStdout("GitCore.statusDetails.stagedNumstat", cwd, [
              "diff",
              "--cached",
              "--numstat",
            ]),
          ],
          { concurrency: "unbounded" },
        );

        let branch: string | null = null;
        let upstreamRef: string | null = null;
        let aheadCount = 0;
        let behindCount = 0;
        let hasWorkingTreeChanges = false;
        const changedFilesWithoutNumstat = new Set<string>();
        const fileFlagsByPath = new Map<
          string,
          {
            staged: boolean;
            unstaged: boolean;
            untracked: boolean;
            conflicted: boolean;
          }
        >();

        for (const line of statusStdout.split(/\r?\n/g)) {
          if (line.startsWith("# branch.head ")) {
            const value = line.slice("# branch.head ".length).trim();
            branch = value.startsWith("(") ? null : value;
            continue;
          }
          if (line.startsWith("# branch.upstream ")) {
            const value = line.slice("# branch.upstream ".length).trim();
            upstreamRef = value.length > 0 ? value : null;
            continue;
          }
          if (line.startsWith("# branch.ab ")) {
            const value = line.slice("# branch.ab ".length).trim();
            const parsed = parseBranchAb(value);
            aheadCount = parsed.ahead;
            behindCount = parsed.behind;
            continue;
          }
          if (line.trim().length > 0 && !line.startsWith("#")) {
            hasWorkingTreeChanges = true;
            const pathValue = parsePorcelainPath(line);
            if (pathValue) changedFilesWithoutNumstat.add(pathValue);
            const parsedFlags = parsePorcelainFileFlags(line);
            if (parsedFlags) {
              const existing = fileFlagsByPath.get(parsedFlags.path) ?? {
                staged: false,
                unstaged: false,
                untracked: false,
                conflicted: false,
              };
              existing.staged ||= parsedFlags.staged;
              existing.unstaged ||= parsedFlags.unstaged;
              existing.untracked ||= parsedFlags.untracked;
              existing.conflicted ||= parsedFlags.conflicted;
              fileFlagsByPath.set(parsedFlags.path, existing);
            }
          }
        }

        if (!upstreamRef && branch) {
          aheadCount = yield* computeAheadCountAgainstBase(cwd, branch).pipe(
            Effect.catch(() => Effect.succeed(0)),
          );
          behindCount = 0;
        }

        const stagedEntries = parseNumstatEntries(stagedNumstatStdout);
        const unstagedEntries = parseNumstatEntries(unstagedNumstatStdout);
        const fileStatMap = new Map<string, { insertions: number; deletions: number }>();
        for (const entry of [...stagedEntries, ...unstagedEntries]) {
          const existing = fileStatMap.get(entry.path) ?? { insertions: 0, deletions: 0 };
          existing.insertions += entry.insertions;
          existing.deletions += entry.deletions;
          fileStatMap.set(entry.path, existing);
        }

        let insertions = 0;
        let deletions = 0;
        const files: GitStatusFile[] = Array.from(fileStatMap.entries())
          .map(([filePath, stat]) => {
            insertions += stat.insertions;
            deletions += stat.deletions;
            return { path: filePath, insertions: stat.insertions, deletions: stat.deletions };
          })
          .toSorted((a, b) => a.path.localeCompare(b.path));

        for (const filePath of changedFilesWithoutNumstat) {
          if (fileStatMap.has(filePath)) continue;
          files.push({ path: filePath, insertions: 0, deletions: 0 });
        }
        const normalizedFiles: GitStatusFile[] = files
          .map((file) => {
            const flags = fileFlagsByPath.get(file.path);
            if (!flags) {
              return file;
            }
            return {
              path: file.path,
              insertions: file.insertions,
              deletions: file.deletions,
              staged: flags.staged,
              unstaged: flags.unstaged,
              untracked: flags.untracked,
              conflicted: flags.conflicted,
            };
          })
          .toSorted((a, b) => a.path.localeCompare(b.path));

        const stagedFiles = normalizedFiles.filter((file) => file.staged);
        const unstagedFiles = normalizedFiles.filter((file) => file.unstaged);
        const conflictedFiles = normalizedFiles.filter((file) => file.conflicted);
        const untrackedFiles = normalizedFiles.filter((file) => file.untracked);
        const operation = yield* readGitOperationState(cwd, conflictedFiles.length);
        const summarizeFiles = (
          source: typeof normalizedFiles,
        ): { files: typeof normalizedFiles; insertions: number; deletions: number } =>
          source.reduce(
            (acc, file) => {
              acc.files.push(file);
              acc.insertions += file.insertions;
              acc.deletions += file.deletions;
              return acc;
            },
            { files: [] as typeof normalizedFiles, insertions: 0, deletions: 0 },
          );

        return {
          branch,
          upstreamRef,
          hasWorkingTreeChanges,
          workingTree: {
            files: normalizedFiles,
            insertions,
            deletions,
          },
          staged: summarizeFiles(stagedFiles),
          unstaged: summarizeFiles(unstagedFiles),
          conflicted: {
            files: conflictedFiles,
          },
          untracked: {
            files: untrackedFiles,
          },
          hasUpstream: upstreamRef !== null,
          aheadCount,
          behindCount,
          operation,
        };
      });

    const status: GitCoreShape["status"] = (input) =>
      statusDetails(input.cwd).pipe(
        Effect.map((details) => ({
          branch: details.branch,
          hasWorkingTreeChanges: details.hasWorkingTreeChanges,
          workingTree: details.workingTree,
          staged: details.staged,
          unstaged: details.unstaged,
          conflicted: details.conflicted,
          untracked: details.untracked,
          hasUpstream: details.hasUpstream,
          aheadCount: details.aheadCount,
          behindCount: details.behindCount,
          operation: details.operation,
          pr: null,
        })),
      );

    const fetchLatest: GitCoreShape["fetchLatest"] = (input) =>
      Effect.gen(function* () {
        const hasOriginRemote = yield* executeGit(
          "GitCore.fetchLatest.originExists",
          input.cwd,
          ["remote", "get-url", "origin"],
          {
            allowNonZeroExit: true,
            timeoutMs: 5_000,
          },
        ).pipe(Effect.map((result) => result.code === 0));

        yield* runGit(
          "GitCore.fetchLatest",
          input.cwd,
          hasOriginRemote ? ["fetch", "origin", "--prune"] : ["fetch", "--all", "--prune"],
        );
      });

    const history: GitCoreShape["history"] = (input) =>
      Effect.gen(function* () {
        const stdout = yield* runGitStdout("GitCore.history.log", input.cwd, [
          "log",
          "--date=iso-strict",
          "--decorate=short",
          `--max-count=${input.limit ?? DEFAULT_HISTORY_LIMIT}`,
          `--pretty=format:%H${GIT_LOG_FIELD_SEPARATOR}%h${GIT_LOG_FIELD_SEPARATOR}%an${GIT_LOG_FIELD_SEPARATOR}%aI${GIT_LOG_FIELD_SEPARATOR}%D${GIT_LOG_FIELD_SEPARATOR}%s${GIT_LOG_RECORD_SEPARATOR}`,
          "HEAD",
        ]);

        return {
          commits: parseGitHistoryEntries(stdout),
        };
      });

    const diff: GitCoreShape["diff"] = (input) =>
      Effect.gen(function* () {
        const normalizedPath = input.path?.trim() || null;

        if (input.commit) {
          const [patch, statsStdout, titleStdout] = yield* Effect.all(
            [
              runGitStdout("GitCore.diff.commitPatch", input.cwd, [
                "show",
                "--patch",
                "--minimal",
                "--format=medium",
                input.commit,
                ...(normalizedPath ? ["--", normalizedPath] : []),
              ]),
              runGitStdout("GitCore.diff.commitStats", input.cwd, [
                "show",
                "--numstat",
                "--format=",
                input.commit,
                ...(normalizedPath ? ["--", normalizedPath] : []),
              ]),
              runGitStdout("GitCore.diff.commitTitle", input.cwd, [
                "show",
                "-s",
                `--format=%h${GIT_LOG_FIELD_SEPARATOR}%s`,
                input.commit,
              ]),
            ],
            { concurrency: "unbounded" },
          );
          const [shortSha = input.commit, subject = "Commit diff"] = titleStdout
            .trim()
            .split(GIT_LOG_FIELD_SEPARATOR);
          return {
            target: "commit" as const,
            path: normalizedPath,
            commit: input.commit,
            title: `${shortSha.trim()} · ${(subject || "Commit diff").trim()}`,
            patch,
            stats: buildDiffStats(statsStdout),
          };
        }

        if (!normalizedPath) {
          return yield* createGitCommandError(
            "GitCore.diff",
            input.cwd,
            ["diff"],
            "Working tree diff needs a file path.",
          );
        }

        const untrackedStdout = yield* runGitStdout("GitCore.diff.untracked", input.cwd, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "--",
          normalizedPath,
        ]).pipe(Effect.catch(() => Effect.succeed("")));
        const isUntracked = untrackedStdout
          .split(/\r?\n/g)
          .map((line) => line.trim())
          .some((line) => line === normalizedPath);
        const absolutePath = path.join(input.cwd, normalizedPath);

        const [patch, statsStdout] = isUntracked
          ? yield* Effect.all(
              [
                runGitStdout(
                  "GitCore.diff.untrackedPatch",
                  input.cwd,
                  ["diff", "--no-index", "--patch", "--minimal", "--", "/dev/null", absolutePath],
                  true,
                ),
                runGitStdout(
                  "GitCore.diff.untrackedStats",
                  input.cwd,
                  ["diff", "--no-index", "--numstat", "--", "/dev/null", absolutePath],
                  true,
                ),
              ],
              { concurrency: "unbounded" },
            )
          : yield* Effect.all(
              [
                runGitStdout("GitCore.diff.workingTreePatch", input.cwd, [
                  "diff",
                  "--patch",
                  "--minimal",
                  "--no-ext-diff",
                  "HEAD",
                  "--",
                  normalizedPath,
                ]),
                runGitStdout("GitCore.diff.workingTreeStats", input.cwd, [
                  "diff",
                  "--numstat",
                  "HEAD",
                  "--",
                  normalizedPath,
                ]),
              ],
              { concurrency: "unbounded" },
            );

        return {
          target: "working_tree" as const,
          path: normalizedPath,
          commit: null,
          title: `${normalizedPath} · Working tree`,
          patch,
          stats: buildDiffStats(statsStdout),
        };
      });

    const stageFiles: GitCoreShape["stageFiles"] = (input) =>
      runGit("GitCore.stageFiles", input.cwd, ["add", "--", ...input.paths]);

    const unstageFiles: GitCoreShape["unstageFiles"] = (input) =>
      runGit("GitCore.unstageFiles", input.cwd, ["restore", "--staged", "--", ...input.paths]);

    const discardChanges: GitCoreShape["discardChanges"] = (input) =>
      Effect.gen(function* () {
        const discardStaged = input.discardStaged ?? true;
        const discardUnstaged = input.discardUnstaged ?? true;
        const discardUntracked = input.discardUntracked ?? false;
        const targetPaths = input.paths ?? [];
        const hasScopedPaths = targetPaths.length > 0;

        if (discardStaged && discardUnstaged) {
          yield* runGit("GitCore.discardChanges.restoreAll", input.cwd, [
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--",
            ...(hasScopedPaths ? targetPaths : ["."]),
          ]);
        } else if (discardStaged) {
          yield* runGit("GitCore.discardChanges.restoreStaged", input.cwd, [
            "restore",
            "--staged",
            "--",
            ...(hasScopedPaths ? targetPaths : ["."]),
          ]);
        } else if (discardUnstaged) {
          yield* runGit("GitCore.discardChanges.restoreWorktree", input.cwd, [
            "restore",
            "--worktree",
            "--source=HEAD",
            "--",
            ...(hasScopedPaths ? targetPaths : ["."]),
          ]);
        }

        if (discardUntracked) {
          yield* runGit("GitCore.discardChanges.cleanUntracked", input.cwd, [
            "clean",
            "-fd",
            "--",
            ...(hasScopedPaths ? targetPaths : ["."]),
          ]).pipe(Effect.catch(() => Effect.void));
        }
      });

    const saveStash: GitCoreShape["saveStash"] = (input) =>
      runGit("GitCore.saveStash", input.cwd, [
        "stash",
        "push",
        ...((input.includeUntracked ?? true) ? ["--include-untracked"] : []),
        ...(input.message ? ["--message", input.message] : []),
      ]);

    const listStashes: GitCoreShape["listStashes"] = (input) =>
      Effect.gen(function* () {
        const stdout = yield* runGitStdout("GitCore.listStashes", input.cwd, [
          "stash",
          "list",
          "--date=iso-strict",
          `--format=%gd${GIT_LOG_FIELD_SEPARATOR}%H${GIT_LOG_FIELD_SEPARATOR}%gs${GIT_LOG_FIELD_SEPARATOR}%aI`,
        ]);

        return {
          entries: parseStashEntries(stdout),
        };
      });

    const applyStash: GitCoreShape["applyStash"] = (input) =>
      runGit("GitCore.applyStash", input.cwd, [
        "stash",
        input.pop ? "pop" : "apply",
        input.stashRef,
      ]);

    const dropStash: GitCoreShape["dropStash"] = (input) =>
      runGit("GitCore.dropStash", input.cwd, ["stash", "drop", input.stashRef]);

    const resolveConflict: GitCoreShape["resolveConflict"] = (input) =>
      Effect.gen(function* () {
        yield* runGit("GitCore.resolveConflict.checkoutSide", input.cwd, [
          "checkout",
          input.side === "ours" ? "--ours" : "--theirs",
          "--",
          input.path,
        ]);
        yield* runGit("GitCore.resolveConflict.stage", input.cwd, ["add", "--", input.path]);
      });

    const readConflictSnapshot: GitCoreShape["readConflictSnapshot"] = (input) =>
      Effect.gen(function* () {
        const [baseContents, oursContents, theirsContents] = yield* Effect.all(
          [
            runGitStdoutNullable("GitCore.readConflictSnapshot.base", input.cwd, [
              "show",
              `:1:${input.path}`,
            ]),
            runGitStdoutNullable("GitCore.readConflictSnapshot.ours", input.cwd, [
              "show",
              `:2:${input.path}`,
            ]),
            runGitStdoutNullable("GitCore.readConflictSnapshot.theirs", input.cwd, [
              "show",
              `:3:${input.path}`,
            ]),
          ],
          { concurrency: "unbounded" },
        );

        return {
          path: input.path,
          baseContents,
          oursContents,
          theirsContents,
        };
      });

    const applyHunk: GitCoreShape["applyHunk"] = (input) =>
      Effect.scoped(
        Effect.gen(function* () {
          const patchFile = yield* writePatchFileScoped(input.patch).pipe(
            Effect.mapError((error) =>
              createGitCommandError(
                "GitCore.applyHunk.patchFile",
                input.cwd,
                ["apply"],
                "Could not prepare the temporary patch for this hunk.",
                error,
              ),
            ),
          );
          const args =
            input.mode === "stage"
              ? [
                  "apply",
                  "--cached",
                  "--recount",
                  "--unidiff-zero",
                  "--whitespace=nowarn",
                  patchFile,
                ]
              : input.mode === "unstage"
                ? [
                    "apply",
                    "--cached",
                    "--reverse",
                    "--recount",
                    "--unidiff-zero",
                    "--whitespace=nowarn",
                    patchFile,
                  ]
                : [
                    "apply",
                    "--reverse",
                    "--recount",
                    "--unidiff-zero",
                    "--whitespace=nowarn",
                    patchFile,
                  ];

          yield* runGit("GitCore.applyHunk", input.cwd, args);
        }),
      );

    const mergeBranch: GitCoreShape["mergeBranch"] = (input) =>
      runGitNoEditor("GitCore.mergeBranch", input.cwd, ["merge", "--no-edit", input.branch]);

    const rebaseBranch: GitCoreShape["rebaseBranch"] = (input) =>
      runGitNoEditor("GitCore.rebaseBranch", input.cwd, ["rebase", input.branch]);

    const continueOperation: GitCoreShape["continueOperation"] = (input) =>
      runGitNoEditor(
        "GitCore.continueOperation",
        input.cwd,
        input.kind === "merge" ? ["merge", "--continue"] : ["rebase", "--continue"],
      );

    const abortOperation: GitCoreShape["abortOperation"] = (input) =>
      runGitNoEditor(
        "GitCore.abortOperation",
        input.cwd,
        input.kind === "merge" ? ["merge", "--abort"] : ["rebase", "--abort"],
      );

    const skipRebase: GitCoreShape["skipRebase"] = (input) =>
      runGitNoEditor("GitCore.skipRebase", input.cwd, ["rebase", "--skip"]);

    const amendCommit: GitCoreShape["amendCommit"] = (input) =>
      runGitNoEditor(
        "GitCore.amendCommit",
        input.cwd,
        input.message
          ? ["commit", "--amend", "-m", input.message]
          : ["commit", "--amend", "--no-edit"],
      );

    const undoLastCommit: GitCoreShape["undoLastCommit"] = (input) =>
      runGit("GitCore.undoLastCommit", input.cwd, ["reset", "--soft", "HEAD~1"]);

    const revertCommit: GitCoreShape["revertCommit"] = (input) =>
      runGitNoEditor("GitCore.revertCommit", input.cwd, ["revert", "--no-edit", input.sha]);

    const cherryPick: GitCoreShape["cherryPick"] = (input) =>
      runGitNoEditor("GitCore.cherryPick", input.cwd, ["cherry-pick", input.sha]);

    const createTag: GitCoreShape["createTag"] = (input) =>
      runGit(
        "GitCore.createTag",
        input.cwd,
        input.sha ? ["tag", input.name, input.sha] : ["tag", input.name],
      );

    const listTags: GitCoreShape["listTags"] = (input) =>
      runGitStdout("GitCore.listTags", input.cwd, [
        "tag",
        "-l",
        "--format=%(refname:short)|%(objectname:short)|%(contents:subject)",
      ]).pipe(
        Effect.map((stdout) => {
          const rawLines = stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const tags = rawLines
            .map((line) => {
              const parts = line.split("|");
              return {
                name: parts[0] || "",
                sha: parts[1] || "",
                subject: parts.slice(2).join("|") || "",
              };
            })
            .filter((t) => t.name.length > 0);
          return { tags };
        }),
      );

    const prepareCommitContext: GitCoreShape["prepareCommitContext"] = (cwd, filePaths) =>
      Effect.gen(function* () {
        if (filePaths && filePaths.length > 0) {
          yield* runGit("GitCore.prepareCommitContext.reset", cwd, ["reset"]).pipe(
            Effect.catch(() => Effect.void),
          );
          yield* runGit("GitCore.prepareCommitContext.addSelected", cwd, [
            "add",
            "-A",
            "--",
            ...filePaths,
          ]);
        } else {
          yield* runGit("GitCore.prepareCommitContext.addAll", cwd, ["add", "-A"]);
        }

        const stagedSummary = yield* runGitStdout(
          "GitCore.prepareCommitContext.stagedSummary",
          cwd,
          ["diff", "--cached", "--name-status"],
        ).pipe(Effect.map((stdout) => stdout.trim()));
        if (stagedSummary.length === 0) {
          return null;
        }

        const stagedPatch = yield* runGitStdout("GitCore.prepareCommitContext.stagedPatch", cwd, [
          "diff",
          "--cached",
          "--patch",
          "--minimal",
        ]);

        return {
          stagedSummary,
          stagedPatch,
        };
      });

    const commit: GitCoreShape["commit"] = (cwd, subject, body, options?: GitCommitOptions) =>
      Effect.gen(function* () {
        const args = ["commit", "-m", subject];
        const trimmedBody = body.trim();
        if (trimmedBody.length > 0) {
          args.push("-m", trimmedBody);
        }
        const progress = options?.progress
          ? {
              ...(options.progress.onOutputLine
                ? {
                    onStdoutLine: (line: string) =>
                      options.progress?.onOutputLine?.({ stream: "stdout", text: line }) ??
                      Effect.void,
                    onStderrLine: (line: string) =>
                      options.progress?.onOutputLine?.({ stream: "stderr", text: line }) ??
                      Effect.void,
                  }
                : {}),
              ...(options.progress.onHookStarted
                ? { onHookStarted: options.progress.onHookStarted }
                : {}),
              ...(options.progress.onHookFinished
                ? { onHookFinished: options.progress.onHookFinished }
                : {}),
            }
          : null;
        yield* executeGit("GitCore.commit.commit", cwd, args, {
          ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(progress ? { progress } : {}),
        }).pipe(Effect.asVoid);
        const commitSha = yield* runGitStdout("GitCore.commit.revParseHead", cwd, [
          "rev-parse",
          "HEAD",
        ]).pipe(Effect.map((stdout) => stdout.trim()));

        return { commitSha };
      });

    const pushCurrentBranch: GitCoreShape["pushCurrentBranch"] = (cwd, fallbackBranch) =>
      Effect.gen(function* () {
        const details = yield* statusDetails(cwd);
        const branch = details.branch ?? fallbackBranch;
        if (!branch) {
          return yield* createGitCommandError(
            "GitCore.pushCurrentBranch",
            cwd,
            ["push"],
            "Cannot push from detached HEAD.",
          );
        }

        const hasNoLocalDelta = details.aheadCount === 0 && details.behindCount === 0;
        if (hasNoLocalDelta) {
          if (details.hasUpstream) {
            return {
              status: "skipped_up_to_date" as const,
              branch,
              ...(details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}),
            };
          }

          const comparableBaseBranch = yield* resolveBaseBranchForNoUpstream(cwd, branch).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );
          if (comparableBaseBranch) {
            const publishRemoteName = yield* resolvePushRemoteName(cwd, branch).pipe(
              Effect.catch(() => Effect.succeed(null)),
            );
            if (!publishRemoteName) {
              return {
                status: "skipped_up_to_date" as const,
                branch,
              };
            }

            const hasRemoteBranch = yield* remoteBranchExists(cwd, publishRemoteName, branch).pipe(
              Effect.catch(() => Effect.succeed(false)),
            );
            if (hasRemoteBranch) {
              return {
                status: "skipped_up_to_date" as const,
                branch,
              };
            }
          }
        }

        if (!details.hasUpstream) {
          const publishRemoteName = yield* resolvePushRemoteName(cwd, branch);
          if (!publishRemoteName) {
            return yield* createGitCommandError(
              "GitCore.pushCurrentBranch",
              cwd,
              ["push"],
              "Cannot push because no git remote is configured for this repository.",
            );
          }
          yield* runGit("GitCore.pushCurrentBranch.pushWithUpstream", cwd, [
            "push",
            "-u",
            publishRemoteName,
            branch,
          ]);
          return {
            status: "pushed" as const,
            branch,
            upstreamBranch: `${publishRemoteName}/${branch}`,
            setUpstream: true,
          };
        }

        const currentUpstream = yield* resolveCurrentUpstream(cwd).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        if (currentUpstream) {
          yield* runGit("GitCore.pushCurrentBranch.pushUpstream", cwd, [
            "push",
            currentUpstream.remoteName,
            `HEAD:${currentUpstream.upstreamBranch}`,
          ]);
          return {
            status: "pushed" as const,
            branch,
            upstreamBranch: currentUpstream.upstreamRef,
            setUpstream: false,
          };
        }

        yield* runGit("GitCore.pushCurrentBranch.push", cwd, ["push"]);
        return {
          status: "pushed" as const,
          branch,
          ...(details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}),
          setUpstream: false,
        };
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            const detail =
              (error as { detail?: string })?.detail ?? error?.message ?? String(error);
            const lower = detail.toLowerCase();
            if (
              lower.includes("permission to") ||
              lower.includes("403") ||
              lower.includes("write access") ||
              lower.includes("access denied")
            ) {
              setCachedPushAccess(cwd, "read_only");
            }
          }),
        ),
      );

    const pullCurrentBranch: GitCoreShape["pullCurrentBranch"] = (cwd) =>
      Effect.gen(function* () {
        const details = yield* statusDetails(cwd);
        const branch = details.branch;
        if (!branch) {
          return yield* createGitCommandError(
            "GitCore.pullCurrentBranch",
            cwd,
            ["pull", "--ff-only"],
            "Cannot pull from detached HEAD.",
          );
        }
        if (!details.hasUpstream) {
          return yield* createGitCommandError(
            "GitCore.pullCurrentBranch",
            cwd,
            ["pull", "--ff-only"],
            "Current branch has no upstream configured. Push with upstream first.",
          );
        }
        const beforeSha = yield* runGitStdout(
          "GitCore.pullCurrentBranch.beforeSha",
          cwd,
          ["rev-parse", "HEAD"],
          true,
        ).pipe(Effect.map((stdout) => stdout.trim()));
        yield* executeGit("GitCore.pullCurrentBranch.pull", cwd, ["pull", "--ff-only"], {
          timeoutMs: 30_000,
          fallbackErrorMessage: "git pull failed",
        });
        const afterSha = yield* runGitStdout(
          "GitCore.pullCurrentBranch.afterSha",
          cwd,
          ["rev-parse", "HEAD"],
          true,
        ).pipe(Effect.map((stdout) => stdout.trim()));

        const refreshed = yield* statusDetails(cwd);
        return {
          status: beforeSha.length > 0 && beforeSha === afterSha ? "skipped_up_to_date" : "pulled",
          branch,
          upstreamBranch: refreshed.upstreamRef,
        };
      });

    const readRangeContext: GitCoreShape["readRangeContext"] = (cwd, baseBranch) =>
      Effect.gen(function* () {
        const range = `${baseBranch}..HEAD`;
        const [commitSummary, diffSummary, diffPatch] = yield* Effect.all(
          [
            runGitStdout("GitCore.readRangeContext.log", cwd, ["log", "--oneline", range]),
            runGitStdout("GitCore.readRangeContext.diffStat", cwd, ["diff", "--stat", range]),
            runGitStdout("GitCore.readRangeContext.diffPatch", cwd, [
              "diff",
              "--patch",
              "--minimal",
              range,
            ]),
          ],
          { concurrency: "unbounded" },
        );

        return {
          commitSummary,
          diffSummary,
          diffPatch,
        };
      });

    const readConfigValue: GitCoreShape["readConfigValue"] = (cwd, key) =>
      runGitStdout("GitCore.readConfigValue", cwd, ["config", "--get", key], true).pipe(
        Effect.map((stdout) => stdout.trim()),
        Effect.map((trimmed) => (trimmed.length > 0 ? trimmed : null)),
      );

    const listBranches: GitCoreShape["listBranches"] = (input) =>
      Effect.gen(function* () {
        const branchRecencyPromise = readBranchRecency(input.cwd).pipe(
          Effect.catch(() => Effect.succeed(new Map<string, number>())),
        );
        const localBranchResult = yield* executeGit(
          "GitCore.listBranches.branchNoColor",
          input.cwd,
          ["branch", "--no-color"],
          {
            timeoutMs: 10_000,
            allowNonZeroExit: true,
          },
        );

        if (localBranchResult.code !== 0) {
          const stderr = localBranchResult.stderr.trim();
          if (stderr.toLowerCase().includes("not a git repository")) {
            return { branches: [], isRepo: false, hasOriginRemote: false };
          }
          return yield* createGitCommandError(
            "GitCore.listBranches",
            input.cwd,
            ["branch", "--no-color"],
            stderr || "git branch failed",
          );
        }

        const remoteBranchResultEffect = executeGit(
          "GitCore.listBranches.remoteBranches",
          input.cwd,
          ["branch", "--no-color", "--remotes"],
          {
            timeoutMs: 10_000,
            allowNonZeroExit: true,
          },
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `GitCore.listBranches: remote branch lookup failed for ${input.cwd}: ${error.message}. Falling back to an empty remote branch list.`,
            ).pipe(Effect.as({ code: 1, stdout: "", stderr: "" })),
          ),
        );

        const remoteNamesResultEffect = executeGit(
          "GitCore.listBranches.remoteNames",
          input.cwd,
          ["remote"],
          {
            timeoutMs: 5_000,
            allowNonZeroExit: true,
          },
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `GitCore.listBranches: remote name lookup failed for ${input.cwd}: ${error.message}. Falling back to an empty remote name list.`,
            ).pipe(Effect.as({ code: 1, stdout: "", stderr: "" })),
          ),
        );

        const [defaultRef, worktreeList, remoteBranchResult, remoteNamesResult, branchLastCommit] =
          yield* Effect.all(
            [
              executeGit(
                "GitCore.listBranches.defaultRef",
                input.cwd,
                ["symbolic-ref", "refs/remotes/origin/HEAD"],
                {
                  timeoutMs: 5_000,
                  allowNonZeroExit: true,
                },
              ),
              executeGit(
                "GitCore.listBranches.worktreeList",
                input.cwd,
                ["worktree", "list", "--porcelain"],
                {
                  timeoutMs: 5_000,
                  allowNonZeroExit: true,
                },
              ),
              remoteBranchResultEffect,
              remoteNamesResultEffect,
              branchRecencyPromise,
            ],
            { concurrency: "unbounded" },
          );

        const remoteNames =
          remoteNamesResult.code === 0 ? parseRemoteNames(remoteNamesResult.stdout) : [];
        if (remoteBranchResult.code !== 0 && remoteBranchResult.stderr.trim().length > 0) {
          yield* Effect.logWarning(
            `GitCore.listBranches: remote branch lookup returned code ${remoteBranchResult.code} for ${input.cwd}: ${remoteBranchResult.stderr.trim()}. Falling back to an empty remote branch list.`,
          );
        }
        if (remoteNamesResult.code !== 0 && remoteNamesResult.stderr.trim().length > 0) {
          yield* Effect.logWarning(
            `GitCore.listBranches: remote name lookup returned code ${remoteNamesResult.code} for ${input.cwd}: ${remoteNamesResult.stderr.trim()}. Falling back to an empty remote name list.`,
          );
        }

        const defaultBranch =
          defaultRef.code === 0
            ? defaultRef.stdout.trim().replace(/^refs\/remotes\/origin\//, "")
            : null;

        const worktreeMap = new Map<string, string>();
        if (worktreeList.code === 0) {
          let currentPath: string | null = null;
          for (const line of worktreeList.stdout.split("\n")) {
            if (line.startsWith("worktree ")) {
              const candidatePath = line.slice("worktree ".length);
              const exists = yield* fileSystem.stat(candidatePath).pipe(
                Effect.map(() => true),
                Effect.catch(() => Effect.succeed(false)),
              );
              currentPath = exists ? candidatePath : null;
            } else if (line.startsWith("branch refs/heads/") && currentPath) {
              worktreeMap.set(line.slice("branch refs/heads/".length), currentPath);
            } else if (line === "") {
              currentPath = null;
            }
          }
        }

        const localBranches = localBranchResult.stdout
          .split("\n")
          .map(parseBranchLine)
          .filter((branch): branch is { name: string; current: boolean } => branch !== null)
          .map((branch) => ({
            name: branch.name,
            current: branch.current,
            isRemote: false,
            isDefault: branch.name === defaultBranch,
            worktreePath: worktreeMap.get(branch.name) ?? null,
          }))
          .toSorted((a, b) => {
            const aPriority = a.current ? 0 : a.isDefault ? 1 : 2;
            const bPriority = b.current ? 0 : b.isDefault ? 1 : 2;
            if (aPriority !== bPriority) return aPriority - bPriority;

            const aLastCommit = branchLastCommit.get(a.name) ?? 0;
            const bLastCommit = branchLastCommit.get(b.name) ?? 0;
            if (aLastCommit !== bLastCommit) return bLastCommit - aLastCommit;
            return a.name.localeCompare(b.name);
          });

        const remoteBranches =
          remoteBranchResult.code === 0
            ? remoteBranchResult.stdout
                .split("\n")
                .map(parseBranchLine)
                .filter((branch): branch is { name: string; current: boolean } => branch !== null)
                .map((branch) => {
                  const parsedRemoteRef = parseRemoteRefWithRemoteNames(branch.name, remoteNames);
                  const remoteBranch: {
                    name: string;
                    current: boolean;
                    isRemote: boolean;
                    remoteName?: string;
                    isDefault: boolean;
                    worktreePath: string | null;
                  } = {
                    name: branch.name,
                    current: false,
                    isRemote: true,
                    isDefault: false,
                    worktreePath: null,
                  };
                  if (parsedRemoteRef) {
                    remoteBranch.remoteName = parsedRemoteRef.remoteName;
                  }
                  return remoteBranch;
                })
                .toSorted((a, b) => {
                  const aLastCommit = branchLastCommit.get(a.name) ?? 0;
                  const bLastCommit = branchLastCommit.get(b.name) ?? 0;
                  if (aLastCommit !== bLastCommit) return bLastCommit - aLastCommit;
                  return a.name.localeCompare(b.name);
                })
            : [];

        const branches = [...localBranches, ...remoteBranches];
        const primaryRemoteName = remoteNames.includes("origin")
          ? "origin"
          : (remoteNames[0] ?? null);
        const hasOriginRemote = remoteNames.length > 0;
        let pushAccess: GitPushAccess = getCachedPushAccess(input.cwd) ?? "unknown";

        if (hasOriginRemote && primaryRemoteName && pushAccess === "unknown") {
          const remoteUrlRes = yield* executeGit(
            "GitCore.getRemoteUrl",
            input.cwd,
            ["remote", "get-url", primaryRemoteName],
            {
              allowNonZeroExit: true,
            },
          );
          const remoteUrl = remoteUrlRes.code === 0 ? remoteUrlRes.stdout.trim() : null;
          pushAccess = yield* Effect.promise(() => resolvePushAccess(input.cwd, remoteUrl));
        }

        return {
          branches,
          isRepo: true,
          hasOriginRemote,
          pushAccess,
          remoteName: primaryRemoteName,
        };
      });

    const watchedBranchStatuses: GitCoreShape["watchedBranchStatuses"] = (input) =>
      Effect.gen(function* () {
        const branchesRes = yield* listBranches({ cwd: input.cwd });
        const currentHead = branchesRes.branches.find((b) => b.current)?.name ?? null;
        const excludedSet = new Set((input.excludedBranches ?? []).map((b) => b.toLowerCase()));

        const localBranchNames = new Set(
          branchesRes.branches.filter((b) => !b.isRemote).map((b) => b.name.toLowerCase()),
        );

        const allCandidates = branchesRes.branches.filter((b) => {
          if (b.current || b.name === currentHead) return false;
          if (excludedSet.has(b.name.toLowerCase())) return false;
          if (b.name.includes("HEAD")) return false;

          if (b.isRemote) {
            const parts = b.name.split("/");
            if (parts.length > 1) {
              const shortName = parts.slice(1).join("/").toLowerCase();
              if (localBranchNames.has(shortName)) {
                return false;
              }
            }
          }

          return true;
        });

        const isFullScanRequested =
          input.maxCandidates === 0 ||
          (input.maxCandidates !== undefined && input.maxCandidates < 0);
        const maxCandidates = isFullScanRequested
          ? allCandidates.length
          : (input.maxCandidates ?? 30);
        const defaultBranchCandidate = allCandidates.find(
          (b) =>
            b.isDefault || b.name === "main" || b.name === "master" || b.name === "origin/main",
        );

        let boundedCandidates = allCandidates.slice(0, maxCandidates);
        if (
          defaultBranchCandidate &&
          !boundedCandidates.some((b) => b.name === defaultBranchCandidate.name)
        ) {
          boundedCandidates = [defaultBranchCandidate, ...boundedCandidates];
        }

        const results = yield* Effect.forEach(
          boundedCandidates,
          (b) =>
            Effect.gen(function* () {
              const targetRef = b.name;
              const behindStdout = yield* runGitStdout(
                "GitCore.watchedBranchStatuses.behind",
                input.cwd,
                ["rev-list", "--count", `HEAD..${targetRef}`],
              ).pipe(Effect.catch(() => Effect.succeed("0")));

              const aheadStdout = yield* runGitStdout(
                "GitCore.watchedBranchStatuses.ahead",
                input.cwd,
                ["rev-list", "--count", `${targetRef}..HEAD`],
              ).pipe(Effect.catch(() => Effect.succeed("0")));

              const behindCount = parseInt(behindStdout.trim(), 10) || 0;
              const aheadCount = parseInt(aheadStdout.trim(), 10) || 0;
              const isDefault = Boolean(b.isDefault || b.name === "main" || b.name === "master");

              return {
                name: b.name,
                isRemote: Boolean(b.isRemote),
                aheadCount,
                behindCount,
                isDefault,
              };
            }),
          { concurrency: 5 },
        );

        const activeWatched = results
          .filter((b) => b.aheadCount > 0 || b.behindCount > 0)
          .sort((a, b) => {
            // 1. Default/main branch always first
            if (a.isDefault && !b.isDefault) return -1;
            if (!a.isDefault && b.isDefault) return 1;
            // 2. Smallest total divergence (quickest/most relevant to sync)
            const totalA = a.behindCount + a.aheadCount;
            const totalB = b.behindCount + b.aheadCount;
            if (totalA !== totalB) return totalA - totalB;
            return a.name.localeCompare(b.name);
          });

        return { branches: activeWatched, isFullScan: isFullScanRequested };
      });

    const createWorktree: GitCoreShape["createWorktree"] = (input) =>
      Effect.gen(function* () {
        const targetBranch = input.newBranch ?? input.branch;
        const sanitizedBranch = targetBranch.replace(/\//g, "-");
        const repoName = path.basename(input.cwd);
        const worktreePath = input.path ?? path.join(worktreesDir, repoName, sanitizedBranch);
        const args = input.newBranch
          ? ["worktree", "add", "-b", input.newBranch, worktreePath, input.branch]
          : ["worktree", "add", worktreePath, input.branch];

        yield* executeGit("GitCore.createWorktree", input.cwd, args, {
          fallbackErrorMessage: "git worktree add failed",
        });

        return {
          worktree: {
            path: worktreePath,
            branch: targetBranch,
          },
        };
      });

    const fetchPullRequestBranch: GitCoreShape["fetchPullRequestBranch"] = (input) =>
      Effect.gen(function* () {
        const remoteName = yield* resolvePrimaryRemoteName(input.cwd);
        yield* executeGit(
          "GitCore.fetchPullRequestBranch",
          input.cwd,
          [
            "fetch",
            "--quiet",
            "--no-tags",
            remoteName,
            `+refs/pull/${input.prNumber}/head:refs/heads/${input.branch}`,
          ],
          {
            fallbackErrorMessage: "git fetch pull request branch failed",
          },
        );
      }).pipe(Effect.asVoid);

    const fetchRemoteBranch: GitCoreShape["fetchRemoteBranch"] = (input) =>
      Effect.gen(function* () {
        yield* runGit("GitCore.fetchRemoteBranch.fetch", input.cwd, [
          "fetch",
          "--quiet",
          "--no-tags",
          input.remoteName,
          `+refs/heads/${input.remoteBranch}:refs/remotes/${input.remoteName}/${input.remoteBranch}`,
        ]);

        const localBranchAlreadyExists = yield* branchExists(input.cwd, input.localBranch);
        const targetRef = `${input.remoteName}/${input.remoteBranch}`;
        yield* runGit(
          "GitCore.fetchRemoteBranch.materialize",
          input.cwd,
          localBranchAlreadyExists
            ? ["branch", "--force", input.localBranch, targetRef]
            : ["branch", input.localBranch, targetRef],
        );
      }).pipe(Effect.asVoid);

    const setBranchUpstream: GitCoreShape["setBranchUpstream"] = (input) =>
      runGit("GitCore.setBranchUpstream", input.cwd, [
        "branch",
        "--set-upstream-to",
        `${input.remoteName}/${input.remoteBranch}`,
        input.branch,
      ]);

    const removeWorktree: GitCoreShape["removeWorktree"] = (input) =>
      Effect.gen(function* () {
        const args = ["worktree", "remove"];
        if (input.force) {
          args.push("--force");
        }
        args.push(input.path);
        yield* executeGit("GitCore.removeWorktree", input.cwd, args, {
          timeoutMs: 15_000,
          fallbackErrorMessage: "git worktree remove failed",
        }).pipe(
          Effect.mapError((error) =>
            createGitCommandError(
              "GitCore.removeWorktree",
              input.cwd,
              args,
              `${commandLabel(args)} failed (cwd: ${input.cwd}): ${error instanceof Error ? error.message : String(error)}`,
              error,
            ),
          ),
        );
      });

    const renameBranch: GitCoreShape["renameBranch"] = (input) =>
      Effect.gen(function* () {
        if (input.oldBranch === input.newBranch) {
          return { branch: input.newBranch };
        }
        const targetBranch = yield* resolveAvailableBranchName(input.cwd, input.newBranch);

        yield* executeGit(
          "GitCore.renameBranch",
          input.cwd,
          ["branch", "-m", "--", input.oldBranch, targetBranch],
          {
            timeoutMs: 10_000,
            fallbackErrorMessage: "git branch rename failed",
          },
        );

        return { branch: targetBranch };
      });

    const deleteBranch: GitCoreShape["deleteBranch"] = (input) =>
      executeGit(
        "GitCore.deleteBranch",
        input.cwd,
        ["branch", input.force ? "-D" : "-d", "--", input.branch],
        {
          timeoutMs: 10_000,
          fallbackErrorMessage: "git branch delete failed",
        },
      ).pipe(Effect.asVoid);

    const createBranch: GitCoreShape["createBranch"] = (input) =>
      executeGit("GitCore.createBranch", input.cwd, ["branch", input.branch], {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git branch create failed",
      }).pipe(Effect.asVoid);

    const createFork: GitCoreShape["createFork"] = (input) =>
      Effect.gen(function* () {
        const remoteName = input.remoteName ?? "fork";
        const ghResult = yield* Effect.tryPromise({
          try: () =>
            runProcess("gh", ["repo", "fork", "--remote", "--remote-name", remoteName], {
              cwd: input.cwd,
              timeoutMs: 45_000,
              allowNonZeroExit: true,
            }),
          catch: (err) =>
            new GitCommandError({
              operation: "GitCore.createFork",
              command: `gh repo fork --remote --remote-name ${remoteName}`,
              cwd: input.cwd,
              detail: String(err),
            }),
        });

        if (ghResult.code !== 0) {
          const stderr = ghResult.stderr.trim();
          return yield* new GitCommandError({
            operation: "GitCore.createFork",
            command: `gh repo fork --remote --remote-name ${remoteName}`,
            cwd: input.cwd,
            detail:
              stderr.length > 0 ? stderr : `gh repo fork failed with exit code ${ghResult.code}`,
          });
        }
      });

    const checkoutBranch: GitCoreShape["checkoutBranch"] = (input) =>
      Effect.gen(function* () {
        const [localInputExists, remoteExists] = yield* Effect.all(
          [
            executeGit(
              "GitCore.checkoutBranch.localInputExists",
              input.cwd,
              ["show-ref", "--verify", "--quiet", `refs/heads/${input.branch}`],
              {
                timeoutMs: 5_000,
                allowNonZeroExit: true,
              },
            ).pipe(Effect.map((result) => result.code === 0)),
            executeGit(
              "GitCore.checkoutBranch.remoteExists",
              input.cwd,
              ["show-ref", "--verify", "--quiet", `refs/remotes/${input.branch}`],
              {
                timeoutMs: 5_000,
                allowNonZeroExit: true,
              },
            ).pipe(Effect.map((result) => result.code === 0)),
          ],
          { concurrency: "unbounded" },
        );

        const localTrackingBranch = remoteExists
          ? yield* executeGit(
              "GitCore.checkoutBranch.localTrackingBranch",
              input.cwd,
              ["for-each-ref", "--format=%(refname:short)\t%(upstream:short)", "refs/heads"],
              {
                timeoutMs: 5_000,
                allowNonZeroExit: true,
              },
            ).pipe(
              Effect.map((result) =>
                result.code === 0
                  ? parseTrackingBranchByUpstreamRef(result.stdout, input.branch)
                  : null,
              ),
            )
          : null;

        const localTrackedBranchCandidate = deriveLocalBranchNameFromRemoteRef(input.branch);
        const localTrackedBranchTargetExists =
          remoteExists && localTrackedBranchCandidate
            ? yield* executeGit(
                "GitCore.checkoutBranch.localTrackedBranchTargetExists",
                input.cwd,
                ["show-ref", "--verify", "--quiet", `refs/heads/${localTrackedBranchCandidate}`],
                {
                  timeoutMs: 5_000,
                  allowNonZeroExit: true,
                },
              ).pipe(Effect.map((result) => result.code === 0))
            : false;

        const checkoutArgs = localInputExists
          ? ["checkout", input.branch]
          : remoteExists && !localTrackingBranch && localTrackedBranchTargetExists
            ? ["checkout", input.branch]
            : remoteExists && !localTrackingBranch
              ? ["checkout", "--track", input.branch]
              : remoteExists && localTrackingBranch
                ? ["checkout", localTrackingBranch]
                : ["checkout", input.branch];

        yield* executeGit("GitCore.checkoutBranch.checkout", input.cwd, checkoutArgs, {
          timeoutMs: 10_000,
          fallbackErrorMessage: "git checkout failed",
        }).pipe(
          Effect.mapError((error) =>
            normalizeCheckoutBranchError(error, {
              cwd: input.cwd,
              branch: input.branch,
              args: checkoutArgs,
            }),
          ),
        );

        // Refresh upstream refs in the background so checkout remains responsive.
        yield* Effect.forkScoped(
          refreshCheckedOutBranchUpstream(input.cwd).pipe(Effect.ignoreCause({ log: true })),
        );
      });

    const initRepo: GitCoreShape["initRepo"] = (input) =>
      executeGit("GitCore.initRepo", input.cwd, ["init"], {
        timeoutMs: 10_000,
        fallbackErrorMessage: "git init failed",
      }).pipe(Effect.asVoid);

    const listLocalBranchNames: GitCoreShape["listLocalBranchNames"] = (cwd) =>
      runGitStdout("GitCore.listLocalBranchNames", cwd, [
        "branch",
        "--list",
        "--format=%(refname:short)",
      ]).pipe(
        Effect.map((stdout) =>
          stdout
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        ),
      );

    const listWorkflowRuns: GitCoreShape["listWorkflowRuns"] = (input) =>
      Effect.gen(function* () {
        const hasWorkflows = yield* executeGit(
          "GitCore.listWorkflowRuns.checkWorkflows",
          input.cwd,
          ["ls-files", ".github/workflows/*.yml", ".github/workflows/*.yaml"],
          { allowNonZeroExit: true },
        ).pipe(
          Effect.map((res) => res.code === 0 && res.stdout.trim().length > 0),
          Effect.catch(() => Effect.succeed(false)),
        );

        if (!hasWorkflows) {
          return { hasWorkflows: false, runs: [] };
        }

        const limit = input.limit ?? 5;
        const ghResult = yield* Effect.tryPromise({
          try: () =>
            runProcess(
              "gh",
              [
                "run",
                "list",
                "--branch",
                input.branch,
                "--limit",
                String(limit),
                "--json",
                "status,conclusion,name,headBranch,createdAt,url,workflowName",
              ],
              {
                cwd: input.cwd,
                allowNonZeroExit: true,
                timeoutMs: 10_000,
              },
            ),
          catch: () => ({ code: 1, stdout: "[]", stderr: "", signal: null, timedOut: false }),
        }).pipe(
          Effect.catch(() =>
            Effect.succeed({ code: 1, stdout: "[]", stderr: "", signal: null, timedOut: false }),
          ),
        );

        if (ghResult.code !== 0) {
          const stderr = ghResult.stderr.trim();
          return yield* new GitCommandError({
            operation: "GitCore.listWorkflowRuns",
            command: "gh run list",
            cwd: input.cwd,
            detail:
              stderr.length > 0 ? stderr : `gh run list failed with exit code ${ghResult.code}`,
          });
        }

        if (!ghResult.stdout.trim()) {
          return { hasWorkflows: true, runs: [] };
        }

        const runs = yield* Effect.try({
          try: () => {
            const parsed = JSON.parse(ghResult.stdout.trim()) as Array<GitWorkflowRun>;
            return Array.isArray(parsed) ? parsed : [];
          },
          catch: () => [] as Array<GitWorkflowRun>,
        }).pipe(Effect.catch(() => Effect.succeed([] as Array<GitWorkflowRun>)));

        return { hasWorkflows: true, runs };
      });

    return {
      execute,
      status,
      fetchLatest,
      history,
      diff,
      stageFiles,
      unstageFiles,
      discardChanges,
      amendCommit,
      undoLastCommit,
      revertCommit,
      cherryPick,
      createTag,
      listTags,
      watchedBranchStatuses,

      saveStash,
      listStashes,
      applyStash,
      dropStash,
      resolveConflict,
      readConflictSnapshot,
      applyHunk,
      mergeBranch,
      rebaseBranch,
      continueOperation,
      abortOperation,
      skipRebase,
      statusDetails,
      prepareCommitContext,
      commit,
      pushCurrentBranch,
      pullCurrentBranch,
      readRangeContext,
      readConfigValue,
      listBranches,
      createWorktree,
      fetchPullRequestBranch,
      ensureRemote,
      fetchRemoteBranch,
      setBranchUpstream,
      removeWorktree,
      renameBranch,
      deleteBranch,
      createBranch,
      createFork,
      checkoutBranch,
      initRepo,
      listLocalBranchNames,
      listWorkflowRuns,
    } satisfies GitCoreShape;
  });

export const GitCoreLive = Layer.effect(GitCore, makeGitCore());
