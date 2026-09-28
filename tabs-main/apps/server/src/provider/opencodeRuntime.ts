import { spawn as spawnNodeProcess } from "node:child_process";
import { pathToFileURL } from "node:url";

import type { ChatAttachment, ProviderApprovalDecision, RuntimeMode } from "@tabs/contracts";
import {
  createOpencodeClient,
  type Agent,
  type FilePartInput,
  type OpencodeClient,
  type PermissionRuleset,
  type ProviderListResponse,
  type QuestionAnswer,
  type QuestionRequest,
} from "@opencode-ai/sdk/v2";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { isWindowsCommandNotFound } from "../processRunner";
import { collectStreamAsString } from "./providerSnapshot";
import { buildProviderChildEnvironment } from "../providerChildEnvironment.ts";
import {
  teardownEffectProcessTree,
  teardownProviderProcessTree,
} from "./supervisedProcessTeardown.ts";
import * as NetService from "@tabs/shared/Net";
const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.UnknownFromJsonString);
const OPENCODE_EMPTY_CONFIG_CONTENT = "{}";

const OPENCODE_SERVER_READY_PREFIX = "opencode server listening";
const DEFAULT_OPENCODE_SERVER_TIMEOUT_MS = 5_000;
const DEFAULT_HOSTNAME = "127.0.0.1";
const OPENCODE_STARTUP_OUTPUT_MAX_CHARS = 4_000;
const REDACTED_STARTUP_SECRET = "[redacted]";
const STARTUP_OUTPUT_AUTHORIZATION_PATTERN =
  /(["']?)(authorization)\1(\s*[:=]\s*)(["']?)(bearer\s+)?[^"'\s,;}]+\4/giu;
const STARTUP_OUTPUT_SECRET_ASSIGNMENT_PATTERN =
  /(["']?)([A-Za-z0-9_-]*(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|bearer[_-]?token|token|secret|password)[A-Za-z0-9_-]*)\1(\s*[:=]\s*)(["']?)[^"'\s,;}]+\4/giu;
export const KILO_CREDENTIAL_STARTUP_RETRY_DELAYS_MS = [500, 1_500] as const;
export interface OpenCodeServerProcess {
  readonly url: string;
  readonly isRunning: Effect.Effect<boolean, never>;
  readonly exitCode: Effect.Effect<number, never>;
}

export interface OpenCodeServerConnection {
  readonly url: string;
  readonly exitCode: Effect.Effect<number, never> | null;
  readonly external: boolean;
}

interface PooledOpenCodeServer {
  readonly key: string;
  readonly server: OpenCodeServerProcess;
  readonly scope: Scope.Closeable;
  readonly closeOnRelease: boolean;
  refCount: number;
  idleCloseFiber: Fiber.Fiber<void, never> | null;
}

export interface OpenCodeCliModelDescriptor {
  readonly slug: string;
  readonly providerID: string;
  readonly modelID: string;
  readonly name: string;
  readonly variants: ReadonlyArray<string>;
  readonly supportedReasoningEfforts: ReadonlyArray<{
    readonly value: string;
    readonly label?: string;
    readonly description?: string;
  }>;
  readonly defaultReasoningEffort?: string;
  readonly contextWindowOptions?: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly isDefault?: true;
  }>;
  readonly defaultContextWindow?: string;
  readonly isFree?: boolean;
}

const OPENCODE_RUNTIME_ERROR_TAG = "OpenCodeRuntimeError";
export class OpenCodeRuntimeError extends Data.TaggedError(OPENCODE_RUNTIME_ERROR_TAG)<{
  readonly operation: string;
  readonly cause?: unknown;
  readonly detail: string;
}> {
  static readonly is = (u: unknown): u is OpenCodeRuntimeError =>
    P.isTagged(u, OPENCODE_RUNTIME_ERROR_TAG);
}

function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

export function openCodeRuntimeErrorDetail(cause: unknown): string {
  if (OpenCodeRuntimeError.is(cause)) return cause.detail;
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message.trim();
  if (cause && typeof cause === "object") {
    // SDK v2 throws { response, request, error? } shapes — extract what's useful
    const anyCause = cause as Record<string, unknown>;
    const status = (anyCause.response as { status?: number } | undefined)?.status;
    const body = anyCause.error ?? anyCause.data ?? anyCause.body;
    const encodedBody = encodeJsonStringForDiagnostics(body ?? cause);
    if (encodedBody) {
      return `status=${status ?? "?"} body=${encodedBody}`;
    }
  }
  return String(cause);
}

function isRetryableKiloCredentialStartupFailure(cause: unknown): boolean {
  const detail = openCodeRuntimeErrorDetail(cause).toLowerCase();
  return (
    detail.includes('failed query: update "credential" set') ||
    detail.includes("failed query: update 'credential' set") ||
    detail.includes("failed query: update `credential` set") ||
    detail.includes("sqlite_busy") ||
    detail.includes("database is busy") ||
    detail.includes("database is locked")
  );
}

export const runOpenCodeSdk = <A>(
  operation: string,
  fn: () => Promise<A>,
): Effect.Effect<A, OpenCodeRuntimeError> =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) =>
      new OpenCodeRuntimeError({
        operation,
        detail: openCodeRuntimeErrorDetail(cause),
        cause,
      }),
  }).pipe(Effect.withSpan(`opencode.${operation}`));

export interface OpenCodeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface OpenCodeSkill {
  readonly name: string;
  readonly description?: string;
  readonly location: string;
}

export interface OpenCodeInventory {
  readonly providerList: ProviderListResponse;
  readonly agents: ReadonlyArray<Agent>;
  readonly skills?: ReadonlyArray<OpenCodeSkill>;
}

export interface ParsedOpenCodeModelSlug {
  readonly providerID: string;
  readonly modelID: string;
}

export interface OpenCodeRuntimeShape {
  /**
   * Spawns a local OpenCode server process. Its lifetime is bound to the caller's
   * `Scope.Scope` — the child is killed automatically when that scope closes.
   * Consumers that want a long-lived server must create and hold a scope explicitly
   * (see {@link Scope.make}) and close it when done.
   */
  readonly startOpenCodeServerProcess: (input: {
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
  }) => Effect.Effect<OpenCodeServerProcess, OpenCodeRuntimeError, Scope.Scope>;
  /**
   * Returns a handle to either an externally-managed OpenCode server (when
   * `serverUrl` is provided — no lifetime is attached to the caller's scope) or a
   * freshly spawned local server whose lifetime is bound to the caller's scope.
   */
  readonly connectToOpenCodeServer: (input: {
    readonly binaryPath: string;
    readonly serverUrl?: string | null;
    readonly environment?: NodeJS.ProcessEnv;
    readonly port?: number;
    readonly hostname?: string;
    readonly timeoutMs?: number;
    readonly retryKiloCredentialStartup?: boolean;
    readonly cwd?: string;
    readonly poolIsolationKey?: string;
  }) => Effect.Effect<OpenCodeServerConnection, OpenCodeRuntimeError, Scope.Scope>;
  readonly runOpenCodeCommand: (input: {
    readonly binaryPath: string;
    readonly args: ReadonlyArray<string>;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<OpenCodeCommandResult, OpenCodeRuntimeError>;
  readonly createOpenCodeSdkClient: (input: {
    readonly baseUrl: string;
    readonly directory: string;
    readonly serverPassword?: string;
  }) => OpencodeClient;
  readonly loadOpenCodeInventory: (
    client: OpencodeClient,
  ) => Effect.Effect<OpenCodeInventory, OpenCodeRuntimeError>;
  readonly loadOpenCodeSkills: (
    client: OpencodeClient,
  ) => Effect.Effect<ReadonlyArray<OpenCodeSkill>, OpenCodeRuntimeError>;
}

function parseServerUrlFromOutput(output: string): string | null {
  for (const line of output.split("\n")) {
    if (!line.includes("server listening")) {
      continue;
    }
    const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
    return match?.[1] ?? null;
  }
  return null;
}

function formatCommandPart(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/u.test(value) ? value : JSON.stringify(value);
}

function redactStartupOutput(value: string): string {
  return value
    .replace(
      STARTUP_OUTPUT_AUTHORIZATION_PATTERN,
      (_match, keyQuote, key, separator, valueQuote, scheme = "") =>
        `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${scheme}${REDACTED_STARTUP_SECRET}${valueQuote}`,
    )
    .replace(
      STARTUP_OUTPUT_SECRET_ASSIGNMENT_PATTERN,
      (_match, keyQuote, key, separator, valueQuote) =>
        `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${REDACTED_STARTUP_SECRET}${valueQuote}`,
    );
}

function truncateStartupOutput(value: string): string | null {
  const trimmed = redactStartupOutput(value).trim();
  if (!trimmed) return null;
  if (trimmed.length <= OPENCODE_STARTUP_OUTPUT_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, OPENCODE_STARTUP_OUTPUT_MAX_CHARS)}\n\n[truncated ${trimmed.length - OPENCODE_STARTUP_OUTPUT_MAX_CHARS} chars]`;
}

export function resolveOpenCodeConfigContent(
  inputEnvironment: Readonly<Record<string, string | undefined>> | undefined,
  inheritedEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (
    inputEnvironment?.OPENCODE_CONFIG_CONTENT ??
    inheritedEnvironment.OPENCODE_CONFIG_CONTENT ??
    OPENCODE_EMPTY_CONFIG_CONTENT
  );
}

function formatOpenCodeServerStartupDetail(input: {
  readonly summary: string;
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly stdout: string;
  readonly stderr: string;
}): string {
  const stdout = truncateStartupOutput(input.stdout);
  const stderr = truncateStartupOutput(input.stderr);
  return [
    input.summary,
    `command: ${[input.binaryPath, ...input.args].map(formatCommandPart).join(" ")}`,
    `OpenCode ready prefix: ${JSON.stringify(OPENCODE_SERVER_READY_PREFIX)}`,
    stdout ? `stdout:\n${stdout}` : "stdout: <empty>",
    stderr ? `stderr:\n${stderr}` : "stderr: <empty>",
  ].join("\n\n");
}

function pooledOpenCodeServerKey(input: {
  readonly binaryPath: string;
  readonly cwd?: string;
  readonly port?: number;
  readonly hostname?: string;
  readonly poolIsolationKey?: string;
}): string {
  return JSON.stringify({
    binaryPath: input.binaryPath,
    cwd: input.cwd ?? null,
    hostname: input.hostname ?? DEFAULT_HOSTNAME,
    port: input.port ?? null,
    poolIsolationKey: input.poolIsolationKey ?? null,
  });
}

export function toOpenCodePermissionReply(
  decision: ProviderApprovalDecision,
): "once" | "always" | "reject" {
  switch (decision) {
    case "accept":
      return "once";
    case "acceptForSession":
      return "always";
    case "decline":
    case "cancel":
    default:
      return "reject";
  }
}

export function openCodeQuestionId(
  index: number,
  question: QuestionRequest["questions"][number],
): string {
  const header = question.header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  return header.length > 0 ? `question-${index}-${header}` : `question-${index}`;
}

export function toOpenCodeQuestionAnswers(
  request: QuestionRequest,
  answers: Record<string, unknown>,
): Array<QuestionAnswer> {
  return request.questions.map((question, index) => {
    const raw =
      answers[openCodeQuestionId(index, question)] ??
      answers[question.header] ??
      answers[question.question];
    if (Array.isArray(raw)) {
      return raw.filter((value): value is string => typeof value === "string");
    }
    if (typeof raw === "string") {
      return raw.trim().length > 0 ? [raw] : [];
    }
    return [];
  });
}

function ensureRuntimeError(
  operation: OpenCodeRuntimeError["operation"],
  detail: string,
  cause: unknown,
): OpenCodeRuntimeError {
  return OpenCodeRuntimeError.is(cause)
    ? cause
    : new OpenCodeRuntimeError({ operation, detail, cause });
}

export interface OpenCodeRuntimeLiveOptions {
  readonly teardownProcessTree?: typeof teardownProviderProcessTree;
  readonly netService?: NetService.NetServiceShape;
}

const OPEN_CODE_PROCESS_GROUP_GRACE_MS = 1_000;
const OPEN_CODE_PROCESS_GROUP_POLL_MS = 50;

// A detached provider can outlive the backend after SIGKILL or a crash, when
// Effect finalizers cannot run. This small independent shell watches the owner
// and terminates the entire provider group if the owner disappears.
export function watchDetachedOpenCodeProcessGroup(pid: number, ownerPid = process.pid): void {
  if (process.platform === "win32" || pid <= 1) return;
  const script = `
while kill -0 "$1" 2>/dev/null && kill -0 "-$2" 2>/dev/null; do
  sleep 2
done
if ! kill -0 "$1" 2>/dev/null; then
  kill -TERM "-$2" 2>/dev/null
  sleep 1
  kill -KILL "-$2" 2>/dev/null
fi
`;
  const watchdog = spawnNodeProcess(
    "/bin/sh",
    ["-c", script, "tabs-provider-watchdog", String(ownerPid), String(pid)],
    { detached: true, stdio: "ignore" },
  );
  watchdog.on("error", (cause) => {
    console.warn("Failed to start provider process watchdog", { pid, cause });
  });
  watchdog.unref();
}

async function stopDetachedOpenCodeProcessGroup(pid: number): Promise<void> {
  const signalGroup = (signal: NodeJS.Signals): boolean => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw cause;
    }
  };

  if (!signalGroup("SIGTERM")) return;
  const deadline = Date.now() + OPEN_CODE_PROCESS_GROUP_GRACE_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ESRCH") return;
      throw cause;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, OPEN_CODE_PROCESS_GROUP_POLL_MS));
  }
  signalGroup("SIGKILL");
}

const makeOpenCodeRuntime = (options?: OpenCodeRuntimeLiveOptions) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const platformNetService = yield* NetService.NetService;
    const netService = options?.netService ?? platformNetService;
    const pooledServerScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    const pooledServerMutex = yield* Semaphore.make(1);
    const pooledServers = new Map<string, PooledOpenCodeServer>();

    const runOpenCodeCommand: OpenCodeRuntimeShape["runOpenCodeCommand"] = (input) =>
      Effect.gen(function* () {
        const binary = input.binaryPath?.trim() || "opencode";
        const child = yield* spawner.spawn(
          ChildProcess.make(binary, [...input.args], {
            shell: process.platform === "win32",
            env: input.environment ?? process.env,
          }),
        );
        const [stdout, stderr, code] = yield* Effect.all(
          [
            collectStreamAsString(child.stdout),
            collectStreamAsString(child.stderr),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        const exitCode = Number(code);
        if (isWindowsCommandNotFound(exitCode, stderr)) {
          return yield* new OpenCodeRuntimeError({
            operation: "runOpenCodeCommand",
            detail: `spawn ${input.binaryPath} ENOENT`,
          });
        }
        return {
          stdout,
          stderr,
          code: exitCode,
        } satisfies OpenCodeCommandResult;
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause) =>
          ensureRuntimeError(
            "runOpenCodeCommand",
            `Failed to execute '${input.binaryPath} ${input.args.join(" ")}': ${openCodeRuntimeErrorDetail(cause)}`,
            cause,
          ),
        ),
      );

    const startOpenCodeServerProcess: OpenCodeRuntimeShape["startOpenCodeServerProcess"] = (
      input,
    ) =>
      Effect.gen(function* () {
        // Bind this server's lifetime to the caller's scope. When the caller's
        // scope closes, the spawned child is killed and all associated fibers
        // are interrupted automatically — no `close()` method needed.
        const runtimeScope = yield* Scope.Scope;

        const hostname = input.hostname ?? DEFAULT_HOSTNAME;
        const port =
          input.port ??
          (yield* netService.findAvailablePort(0).pipe(
            Effect.mapError(
              (cause) =>
                new OpenCodeRuntimeError({
                  operation: "startOpenCodeServerProcess",
                  detail: `Failed to find available port: ${openCodeRuntimeErrorDetail(cause)}`,
                  cause,
                }),
            ),
          ));
        const timeoutMs = input.timeoutMs ?? DEFAULT_OPENCODE_SERVER_TIMEOUT_MS;
        const args = ["serve", "--hostname", hostname, "--port", String(port)];
        const binary = input.binaryPath?.trim() || "opencode";

        const child = yield* spawner
          .spawn(
            ChildProcess.make(binary, args, {
              detached: process.platform !== "win32",
              shell: process.platform === "win32",
              ...(input.cwd ? { cwd: input.cwd } : {}),
              env: {
                ...(input.environment ?? process.env),
                OPENCODE_CONFIG_CONTENT: resolveOpenCodeConfigContent(input.environment),
              },
            }),
          )
          .pipe(
            Effect.provideService(Scope.Scope, runtimeScope),
            Effect.mapError(
              (cause) =>
                new OpenCodeRuntimeError({
                  operation: "startOpenCodeServerProcess",
                  detail: `Failed to spawn OpenCode server process: ${openCodeRuntimeErrorDetail(cause)}`,
                  cause,
                }),
            ),
          );

        watchDetachedOpenCodeProcessGroup(Number(child.pid));

        // PR-008: Signal detached process group on POSIX before fallback process-tree teardown.
        yield* Scope.addFinalizer(
          runtimeScope,
          Effect.promise(async () => {
            try {
              if (process.platform !== "win32" && !options?.teardownProcessTree) {
                await stopDetachedOpenCodeProcessGroup(Number(child.pid));
                return;
              }
              await teardownEffectProcessTree(
                child,
                options?.teardownProcessTree ?? teardownProviderProcessTree,
              );
            } catch (cause) {
              // Teardown is best-effort during scope exit, but a failure must
              // remain diagnosable because it can otherwise become an orphan.
              console.warn("Failed to stop OpenCode process group", {
                pid: Number(child.pid),
                cause: openCodeRuntimeErrorDetail(cause),
              });
            }
          }),
        );

        const stdoutRef = yield* Ref.make<string | null>("");
        const stderrRef = yield* Ref.make<string | null>("");
        const readyDeferred = yield* Deferred.make<string, OpenCodeRuntimeError>();

        const setReadyFromStdoutChunk = (chunk: string) =>
          Ref.modify(stdoutRef, (stdout) => {
            if (stdout === null) return [null, null] as const;
            const nextStdout = `${stdout}${chunk}`;
            return [parseServerUrlFromOutput(nextStdout), nextStdout] as const;
          }).pipe(
            Effect.flatMap((parsed) => {
              return parsed
                ? Deferred.succeed(readyDeferred, parsed).pipe(Effect.ignore)
                : Effect.void;
            }),
          );

        const stdoutFiber = yield* child.stdout.pipe(
          Stream.decodeText(),
          Stream.runForEach(setReadyFromStdoutChunk),
          Effect.ignore,
          Effect.forkIn(runtimeScope),
        );
        const stderrFiber = yield* child.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Ref.update(stderrRef, (stderr) => (stderr === null ? null : `${stderr}${chunk}`)),
          ),
          Effect.ignore,
          Effect.forkIn(runtimeScope),
        );

        const exitFiber = yield* child.exitCode.pipe(
          Effect.flatMap((code) =>
            Effect.gen(function* () {
              const stdout = (yield* Ref.get(stdoutRef)) ?? "";
              const stderr = (yield* Ref.get(stderrRef)) ?? "";
              const exitCode = Number(code);
              yield* Deferred.fail(
                readyDeferred,
                new OpenCodeRuntimeError({
                  operation: "startOpenCodeServerProcess",
                  detail: [
                    `OpenCode server exited before startup completed (code: ${String(exitCode)}).`,
                    stdout.trim() ? `stdout:\n${stdout.trim()}` : null,
                    stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                  cause: { exitCode, stdout, stderr },
                }),
              ).pipe(Effect.ignore);
            }),
          ),
          Effect.ignore,
          Effect.forkIn(runtimeScope),
        );

        const readyExit = yield* Effect.exit(
          Deferred.await(readyDeferred).pipe(Effect.timeoutOption(timeoutMs)),
        );

        if (Exit.isFailure(readyExit)) {
          yield* Fiber.interruptAll([stdoutFiber, stderrFiber, exitFiber]).pipe(Effect.ignore);
          const squashed = Cause.squash(readyExit.cause);
          return yield* ensureRuntimeError(
            "startOpenCodeServerProcess",
            `Failed while waiting for OpenCode server startup: ${openCodeRuntimeErrorDetail(squashed)}`,
            squashed,
          );
        }

        const readyOption = readyExit.value;
        if (Option.isNone(readyOption)) {
          yield* Fiber.interruptAll([stdoutFiber, stderrFiber, exitFiber]).pipe(Effect.ignore);
          const stdout = (yield* Ref.get(stdoutRef)) ?? "";
          const stderr = (yield* Ref.get(stderrRef)) ?? "";
          const redactedStdout = redactStartupOutput(stdout);
          const redactedStderr = redactStartupOutput(stderr);
          return yield* new OpenCodeRuntimeError({
            operation: "startOpenCodeServerProcess",
            detail: formatOpenCodeServerStartupDetail({
              summary: `Timed out waiting for OpenCode server start after ${timeoutMs}ms.`,
              binaryPath: binary,
              args,
              stdout: redactedStdout,
              stderr: redactedStderr,
            }),
            cause: {
              timeoutMs,
              stdout: redactedStdout,
              stderr: redactedStderr,
              binaryPath: binary,
              args,
              readyPrefix: OPENCODE_SERVER_READY_PREFIX,
            },
          });
        }

        // Keep draining both pipes for the process lifetime. Stopping the readers
        // can block or terminate OpenCode once its output buffers fill. Discard
        // post-startup output instead of retaining an unbounded log in memory.
        yield* Ref.set(stdoutRef, null);
        yield* Ref.set(stderrRef, null);

        return {
          url: readyOption.value,
          isRunning: child.isRunning.pipe(Effect.orElseSucceed(() => false)),
          exitCode: child.exitCode.pipe(
            Effect.map(Number),
            Effect.orElseSucceed(() => 0),
          ),
        } satisfies OpenCodeServerProcess;
      });

    const cancelIdleClose = Effect.fn("cancelOpenCodeIdleClose")(function* (
      pooled: PooledOpenCodeServer,
    ) {
      const fiber = pooled.idleCloseFiber;
      pooled.idleCloseFiber = null;
      if (fiber) yield* Fiber.interrupt(fiber).pipe(Effect.ignore);
    });

    const closePooledServer = Effect.fn("closePooledOpenCodeServer")(function* (
      pooled: PooledOpenCodeServer,
    ) {
      yield* cancelIdleClose(pooled);
      yield* Scope.close(pooled.scope, Exit.void);
      if (pooledServers.get(pooled.key) === pooled) pooledServers.delete(pooled.key);
      pooled.refCount = 0;
    });

    const scheduleIdleClose = Effect.fn("scheduleOpenCodeIdleClose")(function* (
      pooled: PooledOpenCodeServer,
    ) {
      yield* cancelIdleClose(pooled);
      pooled.idleCloseFiber = yield* Effect.sleep(OPENCODE_LOCAL_SERVER_IDLE_TTL_MS).pipe(
        Effect.andThen(
          pooledServerMutex.withPermit(
            Effect.gen(function* () {
              if (pooledServers.get(pooled.key) === pooled && pooled.refCount === 0) {
                pooled.idleCloseFiber = null;
                yield* closePooledServer(pooled);
              }
            }),
          ),
        ),
        Effect.forkIn(pooledServerScope),
      );
    });

    const acquirePooledServer = (
      input: Parameters<OpenCodeRuntimeShape["connectToOpenCodeServer"]>[0],
    ) =>
      pooledServerMutex.withPermit(
        Effect.gen(function* () {
          const key = pooledOpenCodeServerKey(input);
          const existing = pooledServers.get(key);
          if (existing) {
            yield* cancelIdleClose(existing);
            if (yield* existing.server.isRunning) {
              existing.refCount += 1;
              return existing;
            }
            yield* closePooledServer(existing);
          }

          const startInput = {
            binaryPath: input.binaryPath,
            ...(input.environment !== undefined ? { environment: input.environment } : {}),
            ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
            ...(input.port !== undefined ? { port: input.port } : {}),
            ...(input.hostname !== undefined ? { hostname: input.hostname } : {}),
            ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
          };
          let retryIndex = 0;
          let started:
            | { readonly server: OpenCodeServerProcess; readonly scope: Scope.Closeable }
            | undefined;
          while (!started) {
            const serverScope = yield* Scope.make();
            const attempt = yield* Effect.exit(
              startOpenCodeServerProcess(startInput).pipe(
                Effect.provideService(Scope.Scope, serverScope),
              ),
            );
            if (Exit.isSuccess(attempt)) {
              started = { server: attempt.value, scope: serverScope };
              break;
            }
            yield* Scope.close(serverScope, Exit.void).pipe(Effect.ignore);
            const retryDelayMs = input.retryKiloCredentialStartup
              ? KILO_CREDENTIAL_STARTUP_RETRY_DELAYS_MS[retryIndex]
              : undefined;
            const failure = Cause.squash(attempt.cause);
            if (retryDelayMs === undefined || !isRetryableKiloCredentialStartupFailure(failure)) {
              return yield* Effect.failCause(attempt.cause);
            }
            retryIndex += 1;
            yield* Effect.logWarning(
              "Kilo credential reconciliation failed during startup; retrying",
              { attempt: retryIndex + 1, delayMs: retryDelayMs },
            );
            yield* Effect.sleep(retryDelayMs);
          }
          const pooled: PooledOpenCodeServer = {
            key,
            server: started.server,
            scope: started.scope,
            closeOnRelease: input.poolIsolationKey !== undefined,
            refCount: 1,
            idleCloseFiber: null,
          };
          pooledServers.set(key, pooled);
          return pooled;
        }),
      );

    const releasePooledServer = (pooled: PooledOpenCodeServer) =>
      pooledServerMutex.withPermit(
        Effect.gen(function* () {
          if (pooledServers.get(pooled.key) !== pooled) return;
          pooled.refCount = Math.max(0, pooled.refCount - 1);
          if (pooled.refCount === 0) {
            if (pooled.closeOnRelease) yield* closePooledServer(pooled);
            else yield* scheduleIdleClose(pooled);
          }
        }),
      );

    yield* Effect.addFinalizer(() =>
      Effect.forEach(Array.from(pooledServers.values()), closePooledServer, {
        discard: true,
      }),
    );

    const connectToOpenCodeServer: OpenCodeRuntimeShape["connectToOpenCodeServer"] = (input) => {
      const serverUrl = input.serverUrl?.trim();
      if (serverUrl) {
        // We don't own externally-configured servers — no scope interaction.
        return Effect.succeed({
          url: serverUrl,
          exitCode: null,
          external: true,
        });
      }

      return Effect.gen(function* () {
        const callerScope = yield* Scope.Scope;
        const pooled = yield* acquirePooledServer(input);
        yield* Scope.addFinalizer(callerScope, releasePooledServer(pooled));
        return {
          url: pooled.server.url,
          exitCode: pooled.server.exitCode,
          external: false,
        };
      });
    };

    const createOpenCodeSdkClient: OpenCodeRuntimeShape["createOpenCodeSdkClient"] = (input) =>
      createOpencodeClient({
        baseUrl: input.baseUrl,
        directory: input.directory,
        ...(input.serverPassword
          ? {
              headers: {
                Authorization: `Basic ${Buffer.from(`opencode:${input.serverPassword}`, "utf8").toString("base64")}`,
              },
            }
          : {}),
        throwOnError: true,
      });

    const loadProviders = (client: OpencodeClient) =>
      runOpenCodeSdk("provider.list", () => client.provider.list()).pipe(
        Effect.filterMapOrFail(
          (list) =>
            list.data
              ? Result.succeed(list.data)
              : Result.fail(
                  new OpenCodeRuntimeError({
                    operation: "provider.list",
                    detail: "OpenCode provider list was empty.",
                  }),
                ),
          (result) => result,
        ),
      );

    const loadAgents = (client: OpencodeClient) =>
      runOpenCodeSdk("app.agents", () => client.app.agents()).pipe(
        Effect.map((result) => result.data ?? []),
      );

    const loadOpenCodeSkills: OpenCodeRuntimeShape["loadOpenCodeSkills"] = (client) =>
      runOpenCodeSdk("app.skills", () => (client.app as any).skills()).pipe(
        Effect.map((result: any) =>
          (result.data ?? []).map((skill: any) => ({
            name: skill.name,
            ...(skill.description === undefined ? {} : { description: skill.description }),
            location: skill.location,
          })),
        ),
      );

    const loadSkills = (client: OpencodeClient) =>
      loadOpenCodeSkills(client).pipe(Effect.orElseSucceed((): ReadonlyArray<OpenCodeSkill> => []));

    const loadOpenCodeInventory: OpenCodeRuntimeShape["loadOpenCodeInventory"] = (client) =>
      Effect.all([loadProviders(client), loadAgents(client), loadSkills(client)], {
        concurrency: "unbounded",
      }).pipe(Effect.map(([providerList, agents, skills]) => ({ providerList, agents, skills })));

    return {
      startOpenCodeServerProcess,
      connectToOpenCodeServer,
      runOpenCodeCommand,
      createOpenCodeSdkClient,
      loadOpenCodeInventory,
      loadOpenCodeSkills,
    } satisfies OpenCodeRuntimeShape;
  });

export const OPENCODE_LOCAL_SERVER_IDLE_TTL_MS = 30_000;

export function buildOpenCodeServerProcessEnv(input: {
  readonly cliSpec?: { readonly dataDirectoryName: string };
  readonly experimentalWebSockets?: boolean;
  readonly baseEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  return buildProviderChildEnvironment({
    provider: input.cliSpec?.dataDirectoryName === "kilo" ? "kilo" : "opencode",
    baseEnv: input.baseEnv ?? process.env,
    overrides: input.experimentalWebSockets ? { OPENCODE_EXPERIMENTAL_WEBSOCKETS: "true" } : {},
  });
}

export function parseOpenCodeCredentialProviderIDs(content: string): ReadonlyArray<string> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed as Record<string, unknown>)
      .flatMap(([providerID, value]) =>
        value && typeof value === "object" && !Array.isArray(value) ? [providerID.trim()] : [],
      )
      .filter((providerID) => providerID.length > 0)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export interface ParsedOpenCodeModelSlug {
  readonly providerID: string;
  readonly modelID: string;
}

export function parseOpenCodeModelSlug(
  slug: string | null | undefined,
): ParsedOpenCodeModelSlug | null {
  if (typeof slug !== "string") {
    return null;
  }
  const trimmed = slug.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }
  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  };
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fallbackOpenCodeModelName(slug: string, parsedSlug: ParsedOpenCodeModelSlug): string {
  return trimToNull(parsedSlug.modelID) ?? slug;
}

function readOpenCodeVariantEffort(
  variantKey: string,
  variantObject: Record<string, unknown>,
): string | null {
  const direct =
    trimToNull(variantObject.reasoningEffort) ??
    trimToNull(variantObject.reasoning_effort) ??
    trimToNull(variantObject.effort);
  if (direct) return direct;

  const thinking =
    variantObject.thinkingConfig && typeof variantObject.thinkingConfig === "object"
      ? (variantObject.thinkingConfig as Record<string, unknown>)
      : variantObject.thinking_config && typeof variantObject.thinking_config === "object"
        ? (variantObject.thinking_config as Record<string, unknown>)
        : null;
  const thinkingLevel = trimToNull(thinking?.thinkingLevel) ?? trimToNull(thinking?.thinking_level);
  if (thinkingLevel) return thinkingLevel;

  const reasoning =
    variantObject.reasoning && typeof variantObject.reasoning === "object"
      ? (variantObject.reasoning as Record<string, unknown>)
      : null;
  const reasoningConfig =
    variantObject.reasoningConfig && typeof variantObject.reasoningConfig === "object"
      ? (variantObject.reasoningConfig as Record<string, unknown>)
      : variantObject.reasoning_config && typeof variantObject.reasoning_config === "object"
        ? (variantObject.reasoning_config as Record<string, unknown>)
        : null;
  const nested =
    trimToNull(reasoning?.effort) ??
    trimToNull(reasoningConfig?.maxReasoningEffort) ??
    trimToNull(reasoningConfig?.max_reasoning_effort);
  if (nested) return nested;

  return "thinking" in variantObject ||
    "thinkingConfig" in variantObject ||
    "thinking_config" in variantObject ||
    "reasoning" in variantObject ||
    "reasoningConfig" in variantObject ||
    "reasoning_config" in variantObject ||
    Object.keys(variantObject).length === 0
    ? trimToNull(variantKey)
    : null;
}

function readJsonObjectBlock(
  source: string,
  startIndex: number,
): { readonly json: string; readonly nextIndex: number } | null {
  if (source[startIndex] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (!char) break;

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          json: source.slice(startIndex, index + 1),
          nextIndex: index + 1,
        };
      }
    }
  }
  return null;
}

function parseOpenCodeCliModelJson(
  value: unknown,
  slug: string,
  parsedSlug: ParsedOpenCodeModelSlug,
): OpenCodeCliModelDescriptor {
  const object = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const providerID = trimToNull(object.providerID) ?? parsedSlug.providerID;
  const modelID = trimToNull(object.id) ?? parsedSlug.modelID;
  const name = trimToNull(object.name) ?? fallbackOpenCodeModelName(slug, parsedSlug);
  const variantsObject =
    object.variants && typeof object.variants === "object" && !Array.isArray(object.variants)
      ? (object.variants as Record<string, unknown>)
      : {};
  const variants = Object.keys(variantsObject)
    .map((variant) => variant.trim())
    .filter((variant) => variant.length > 0)
    .toSorted((left, right) => left.localeCompare(right));
  const supportedReasoningEfforts = Array.from(
    new Map(
      Object.entries(variantsObject).flatMap(([variantKey, variant]) => {
        if (!variant || typeof variant !== "object" || Array.isArray(variant)) return [];
        const variantObject = variant as Record<string, unknown>;
        const value = readOpenCodeVariantEffort(variantKey, variantObject);
        if (!value) return [];
        const label = trimToNull(variantObject.label);
        const description = trimToNull(variantObject.description);
        return [
          [
            value,
            { value, ...(label ? { label } : {}), ...(description ? { description } : {}) },
          ] as const,
        ];
      }),
    ).values(),
  );
  const defaultReasoningEffort =
    trimToNull(object.defaultReasoningEffort) ??
    trimToNull(object.default_reasoning_effort) ??
    (object.options && typeof object.options === "object" && !Array.isArray(object.options)
      ? (trimToNull((object.options as Record<string, unknown>).reasoningEffort) ??
        trimToNull((object.options as Record<string, unknown>).reasoning_effort) ??
        trimToNull((object.options as Record<string, unknown>).effort))
      : null);

  return {
    slug,
    providerID,
    modelID,
    name,
    variants,
    supportedReasoningEfforts,
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    ...(typeof object.isFree === "boolean" ? { isFree: object.isFree } : {}),
  };
}

export function parseOpenCodeCliModelsOutput(
  output: string,
): ReadonlyArray<OpenCodeCliModelDescriptor> {
  const models = new Map<string, OpenCodeCliModelDescriptor>();
  let index = 0;

  while (index < output.length) {
    while (index < output.length && /\s/u.test(output[index]!)) {
      index += 1;
    }
    if (index >= output.length) break;

    const lineEnd = output.indexOf("\n", index);
    const nextLineIndex = lineEnd === -1 ? output.length : lineEnd + 1;
    const candidate = output.slice(index, lineEnd === -1 ? output.length : lineEnd).trim();
    index = nextLineIndex;

    const parsedSlug = parseOpenCodeModelSlug(candidate);
    if (!parsedSlug) continue;

    let descriptor: OpenCodeCliModelDescriptor = {
      slug: candidate,
      providerID: parsedSlug.providerID,
      modelID: parsedSlug.modelID,
      name: fallbackOpenCodeModelName(candidate, parsedSlug),
      variants: [],
      supportedReasoningEfforts: [],
    };

    while (index < output.length && /\s/u.test(output[index]!)) {
      index += 1;
    }

    if (output[index] === "{") {
      const block = readJsonObjectBlock(output, index);
      if (block) {
        try {
          descriptor = parseOpenCodeCliModelJson(JSON.parse(block.json), candidate, parsedSlug);
        } catch {
          // Fallback
        }
        index = block.nextIndex;
      }
    }

    models.set(descriptor.slug, descriptor);
  }

  return [...models.values()].toSorted(
    (left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug),
  );
}

export function toOpenCodeFileParts(input: {
  readonly attachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly resolveAttachmentPath: (attachment: ChatAttachment) => string | null;
}): Array<FilePartInput> {
  const parts: Array<FilePartInput> = [];
  for (const attachment of input.attachments ?? []) {
    if (attachment.type !== "image") continue;
    const attachmentPath = input.resolveAttachmentPath(attachment);
    if (!attachmentPath) continue;
    parts.push({
      type: "file",
      mime: attachment.mimeType,
      filename: attachment.name,
      url: pathToFileURL(attachmentPath).href,
    });
  }
  return parts;
}

export function buildOpenCodePermissionRules(
  runtimeMode: RuntimeMode,
  interactionMode: string = "default",
): PermissionRuleset {
  if (interactionMode === "plan") {
    return [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "glob", pattern: "*", action: "allow" },
      { permission: "grep", pattern: "*", action: "allow" },
      { permission: "list", pattern: "*", action: "allow" },
      { permission: "lsp", pattern: "*", action: "allow" },
      { permission: "webfetch", pattern: "*", action: "allow" },
      { permission: "websearch", pattern: "*", action: "allow" },
      { permission: "codesearch", pattern: "*", action: "allow" },
      { permission: "todoread", pattern: "*", action: "allow" },
      { permission: "todowrite", pattern: "*", action: "allow" },
      { permission: "question", pattern: "*", action: "allow" },
    ];
  }

  return runtimeMode === "full-access"
    ? [{ permission: "*", pattern: "*", action: "allow" }]
    : [
        { permission: "*", pattern: "*", action: "ask" },
        { permission: "bash", pattern: "*", action: "ask" },
        { permission: "edit", pattern: "*", action: "ask" },
        { permission: "webfetch", pattern: "*", action: "ask" },
        { permission: "websearch", pattern: "*", action: "ask" },
        { permission: "codesearch", pattern: "*", action: "ask" },
        { permission: "external_directory", pattern: "*", action: "ask" },
        { permission: "doom_loop", pattern: "*", action: "ask" },
        { permission: "question", pattern: "*", action: "allow" },
      ];
}

export class OpenCodeRuntime extends Context.Service<OpenCodeRuntime, OpenCodeRuntimeShape>()(
  "tabs/provider/opencodeRuntime",
) {}

export const makeOpenCodeRuntimeLive = (options?: OpenCodeRuntimeLiveOptions) =>
  Layer.effect(OpenCodeRuntime, makeOpenCodeRuntime(options)).pipe(Layer.provide(NetService.layer));

export const OpenCodeRuntimeLive = makeOpenCodeRuntimeLive();
