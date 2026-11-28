import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  NativeComputerCommand,
  NativeComputerCapabilities,
  NativeComputerState,
  NativeWindowGrant,
} from "@tabs/contracts";
import { unlinkSync } from "node:fs";
import * as Semaphore from "effect/Semaphore";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { runProcess } from "../processRunner.ts";
import type { AppSelector, ComputerRequest } from "./commands.ts";
import { pngDimensions } from "./commands.ts";
import {
  buildRuntimeInvocation,
  RUNTIME_TIMEOUT_MS,
  runtimePlatformSupported,
} from "./runtimeInvocation.ts";
import { ensureWindowsRuntime } from "./windowsRuntime.ts";
import {
  failureAdvice,
  parseRuntimeResponse,
  toDiffable,
  type RuntimeAppInfo,
  type RuntimeSuccess,
} from "./runtimeResponse.ts";
import { ComputerTreeBaselines } from "./treeDiff.ts";
import {
  evaluateWaitCondition,
  filterTreeByQuery,
  hasWaitCondition,
  treeUnchanged,
  type WaitCondition,
} from "./treeQuery.ts";
import { describeVerification } from "./verification.ts";

import { ComputerUseError } from "./ComputerUseError.ts";
import { NativeWindows } from "./nativeWindows.ts";

export { ComputerUseError };

export interface ComputerPermissionStatus {
  readonly platformSupported: boolean;
  readonly runtimeAvailable: boolean;
  readonly accessibility: boolean;
  readonly capabilities?: NativeComputerCapabilities;
  readonly screenRecording: "granted" | "denied" | "unknown";
  readonly maturity?: "stable" | "preview";
  readonly maturityNote?: string;
}

export const WINDOWS_PREVIEW_NOTE = "Preview on Windows: not yet verified on a live desktop.";
export const WAYLAND_PREVIEW_NOTE =
  "Preview on Wayland: window capture and physical input are unavailable.";

/** Marks platforms whose native control is simulated or limited, without changing availability. */
export function withMaturity(
  platform: NodeJS.Platform,
  status: ComputerPermissionStatus,
): ComputerPermissionStatus {
  const note =
    platform === "win32"
      ? WINDOWS_PREVIEW_NOTE
      : status.capabilities?.session === "wayland"
        ? WAYLAND_PREVIEW_NOTE
        : undefined;
  if (!note) return { ...status, maturity: "stable" };
  return {
    ...status,
    maturity: "preview",
    maturityNote: note,
    ...(status.capabilities
      ? {
          capabilities: {
            ...status.capabilities,
            details: `${note} ${status.capabilities.details}`,
          },
        }
      : {}),
  };
}

export interface ComputerOutcome {
  readonly action?: string;
  readonly observationId?: string;
  readonly handoff?: string;
  readonly userDemonstration?: string;
  readonly delivery?: "background" | "foreground";
  /** Whether the action's effect was confirmed; see verification.ts. */
  readonly verification?: string;
  readonly tree?: string;
  readonly treeIsDiff: boolean;
  readonly elementCount?: number;
  readonly focusedElementIndex?: number | null;
  readonly app?: RuntimeAppInfo;
}

/** Runs the platform script runtime with one JSON request; swapped out in tests. */
export type RuntimeInvoker = (
  request: ComputerRequest,
  platform: NodeJS.Platform,
  signal?: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>;

class WindowsRuntimeUnavailableError extends Error {}

const processInvoker: RuntimeInvoker = async (request, platform, signal) => {
  let windowsRuntime: string | undefined;
  if (platform === "win32") {
    try {
      windowsRuntime = await NodeFSP.readFile(await ensureWindowsRuntime(), "utf8");
    } catch (cause) {
      throw new WindowsRuntimeUnavailableError(
        cause instanceof Error
          ? `Could not install the Windows computer-use runtime: ${cause.message}`
          : "Could not install the Windows computer-use runtime.",
      );
    }
  }
  const dir =
    signal &&
    request.native &&
    (await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tabs-native-input-")));
  const controlFile = dir && NodePath.join(dir, "active");
  const cancel = () => {
    if (controlFile) {
      try {
        unlinkSync(controlFile);
      } catch {
        // The invocation may already have removed its private directory.
      }
    }
  };
  try {
    if (controlFile) await NodeFSP.writeFile(controlFile, "", { mode: 0o600 });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) throw new Error("Native window access was withdrawn.");
    const invocation = buildRuntimeInvocation(
      platform,
      controlFile ? { ...request, controlFile } : request,
      windowsRuntime,
    );
    const result = await runProcess(invocation.command, invocation.args, {
      stdin: invocation.stdin,
      env: { ...process.env, ...invocation.env },
      timeoutMs: RUNTIME_TIMEOUT_MS,
      allowNonZeroExit: true,
      // Mutation runtimes release input themselves when the control file disappears.
      ...(!request.native || request.op === "snapshot" || request.op === "screenshot"
        ? { signal }
        : {}),
    });
    if (result.timedOut) throw new Error("The desktop runtime timed out.");
    return { stdout: result.stdout, stderr: result.stderr };
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (dir) await NodeFSP.rm(dir, { force: true, recursive: true });
  }
};

const unsupported = () =>
  new ComputerUseError({
    code: "unsupported_capability",
    message: "Computer use is available on macOS, Windows and Linux only.",
  });

export const DEFAULT_WAIT_TIMEOUT_MS = 8_000;
export const MAX_WAIT_TIMEOUT_MS = 20_000;
const WAIT_POLL_MS = 450;

export class ComputerUse extends Context.Service<
  ComputerUse,
  {
    /** Runs an app-bound operation and folds the resulting tree into a diff against the last one. */
    readonly control: (
      input: NativeComputerCommand,
    ) => Effect.Effect<NativeComputerState, ComputerUseError>;
    readonly revokeAll: Effect.Effect<void>;
    readonly revokeThread: (threadId: string) => Effect.Effect<void>;
    readonly grant: (threadId: string) => NativeWindowGrant | undefined;
    readonly execute: (
      request: ComputerRequest,
      session: string,
      options?: {
        readonly treeDiff?: boolean;
        readonly query?: string;
        readonly observationId?: string | undefined;
      },
    ) => Effect.Effect<ComputerOutcome, ComputerUseError>;
    /** Polls the app's tree until the condition holds, or fails with `wait_timeout`. */
    readonly wait: (
      app: AppSelector,
      condition: WaitCondition,
      timeoutMs?: number,
      session?: string,
    ) => Effect.Effect<ComputerOutcome, ComputerUseError>;
    readonly permissions: Effect.Effect<ComputerPermissionStatus>;
    readonly screenshot: (
      app: AppSelector,
      session?: string,
      observationId?: string,
    ) => Effect.Effect<
      {
        readonly path: string;
        readonly width: number | null;
        readonly height: number | null;
        readonly note: string;
      },
      ComputerUseError
    >;
  }
>()("t3/computerUse/ComputerUse") {}

export const make = Effect.fn("ComputerUse.make")(function* (
  invoke: RuntimeInvoker = processInvoker,
  platform: NodeJS.Platform = process.platform,
) {
  // The runtime drives the one real keyboard and pointer, so operations never overlap.
  const gate = yield* Semaphore.make(1);
  const baselines = new ComputerTreeBaselines();
  const supported = runtimePlatformSupported(platform);

  const invokeRuntime = (request: ComputerRequest, access?: AbortSignal) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const cancellation = new AbortController();
        const signal = access
          ? AbortSignal.any([access, cancellation.signal])
          : cancellation.signal;
        const result = Promise.resolve().then(() => invoke(request, platform, signal));
        return { cancellation, result };
      }),
      ({ result }) =>
        Effect.tryPromise({
          try: () => result,
          catch: (cause) =>
            new ComputerUseError({
              code:
                cause instanceof WindowsRuntimeUnavailableError
                  ? "runtime_unavailable"
                  : "accessibility_error",
              message: cause instanceof Error ? cause.message : "The desktop runtime failed.",
            }),
        }),
      ({ cancellation, result }) =>
        Effect.promise(async () => {
          cancellation.abort();
          // Hold the desktop gate until the runtime has released its input and exited.
          await result.catch(() => undefined);
        }),
    ).pipe(
      Effect.map(({ stdout, stderr }) => parseRuntimeResponse(stdout, stderr)),
      Effect.flatMap((response) =>
        response.ok
          ? Effect.succeed<RuntimeSuccess>(response)
          : Effect.fail(
              new ComputerUseError({
                code: response.code,
                message: [response.message, failureAdvice(response.code)].filter(Boolean).join(" "),
              }),
            ),
      ),
    );

  const native = new NativeWindows(invokeRuntime, gate);
  const call = (
    request: ComputerRequest,
    session?: string,
    observationId?: string,
    reportHandoff = false,
  ) =>
    "app" in request && request.app.kind === "attachment"
      ? native.run({ ...request, app: request.app }, session ?? "", observationId, reportHandoff)
      : gate.withPermits(1)(invokeRuntime(request));

  const execute: ComputerUse["Service"]["execute"] = (request, session, options) =>
    !supported
      ? Effect.fail(unsupported())
      : call(request, session, options?.observationId, true).pipe(
          Effect.map((response): ComputerOutcome => {
            const snapshot = response.snapshot;
            const attached = "app" in request && request.app.kind === "attachment";
            const applied =
              attached ||
              snapshot === undefined ||
              // A subtree is not a whole window, so it must not become the baseline for diffs.
              (request.op === "snapshot" && request.rootElementIndex !== undefined)
                ? undefined
                : baselines.apply(
                    toDiffable(session, snapshot),
                    options?.treeDiff ?? request.op !== "snapshot",
                  );
            const unchanged = applied?.diff !== undefined && treeUnchanged(applied.treeText);
            const base = {
              ...(response.action === undefined
                ? {}
                : {
                    action: response.action.fallbackReason
                      ? `${response.action.detail} (${response.action.fallbackReason})`
                      : response.action.detail,
                    ...(response.action.delivery === undefined
                      ? {}
                      : { delivery: response.action.delivery }),
                    verification: describeVerification(response.action, unchanged),
                  }),
              ...(response.app === undefined ? {} : { app: response.app }),
            };
            if (response.apps !== undefined) {
              return {
                ...base,
                tree: response.apps
                  .map(
                    (app) =>
                      `${app.name} | ${app.bundleId ?? "no bundle id"} | pid ${app.pid}${app.active ? " | frontmost" : ""}`,
                  )
                  .join("\n"),
                treeIsDiff: false,
              };
            }
            if (snapshot === undefined) return { ...base, treeIsDiff: false };
            let tree = applied?.treeText ?? snapshot.treeText;
            if (options?.query !== undefined && options.query.trim() !== "") {
              const filtered = filterTreeByQuery(snapshot.treeText, options.query);
              tree =
                filtered?.text ??
                `${snapshot.treeText.split("\n\n")[0] ?? ""}\n\nNo element contains "${options.query.trim()}". Try a shorter query or take a full snapshot.`;
            }
            return {
              ...base,
              tree,
              treeIsDiff: applied?.diff !== undefined && options?.query === undefined,
              ...(attached ? { observationId: snapshot.id } : {}),
              ...(response.handoff ? { handoff: response.handoff } : {}),
              ...(response.userDemonstration
                ? { userDemonstration: response.userDemonstration }
                : {}),
              elementCount: snapshot.elementCount,
              focusedElementIndex: snapshot.focusedElementIndex,
              app: snapshot.app,
            };
          }),
        );

  const wait: ComputerUse["Service"]["wait"] = (app, condition, timeoutMs, session) =>
    Effect.gen(function* () {
      if (!supported) return yield* unsupported();
      if (!hasWaitCondition(condition)) {
        return yield* new ComputerUseError({
          code: "invalid_argument",
          message: "Pass text, enabled or windowTitle to wait for.",
        });
      }
      const limit = Math.min(
        Math.max(timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS, 500),
        MAX_WAIT_TIMEOUT_MS,
      );
      const signal = app.kind === "attachment" && session ? native.signal(session) : undefined;
      let waited = 0;
      while (true) {
        if (signal?.aborted)
          return yield* new ComputerUseError({
            code: "user_turn",
            message: "Window control changed. Start a new observation after the user returns it.",
          });
        // The app or window may not exist yet; keep polling until the deadline.
        const read = yield* call({ op: "snapshot", app, maxNodes: 600 }, session).pipe(
          Effect.map((response) => response.snapshot),
          Effect.catch((error) =>
            ["app_not_found", "window_not_found"].includes(error.code)
              ? Effect.succeed(undefined)
              : Effect.fail(error),
          ),
        );
        const matched = read === undefined ? null : evaluateWaitCondition(read.treeText, condition);
        if (read !== undefined && matched !== null) {
          const head = read.treeText.split("\n\n")[0] ?? "";
          return {
            tree: [head, "", ...matched.matches].join("\n"),
            treeIsDiff: false,
            ...(app.kind === "attachment" ? { observationId: read.id } : {}),
            elementCount: read.elementCount,
            focusedElementIndex: read.focusedElementIndex,
            app: read.app,
          } satisfies ComputerOutcome;
        }
        if (waited >= limit) {
          return yield* new ComputerUseError({
            code: "wait_timeout",
            message: `The condition did not hold within ${limit} ms. Take a snapshot to see what the app shows, and wait again only if it is still working.`,
          });
        }
        yield* Effect.sleep(`${WAIT_POLL_MS} millis`);
        waited += WAIT_POLL_MS;
      }
    });

  const permissions: ComputerUse["Service"]["permissions"] = !supported
    ? Effect.succeed({
        platformSupported: false,
        runtimeAvailable: false,
        accessibility: false,
        screenRecording: "unknown" as const,
      })
    : call({ op: "permissions" }).pipe(
        Effect.map((response) =>
          withMaturity(platform, {
            platformSupported: true,
            runtimeAvailable: true,
            ...(response.permissions?.capabilities
              ? { capabilities: response.permissions.capabilities }
              : {}),
            accessibility: response.permissions?.accessibility ?? false,
            screenRecording: response.permissions?.screenRecording ?? ("unknown" as const),
          }),
        ),
        Effect.catch((error) =>
          Effect.succeed(
            withMaturity(platform, {
              platformSupported: true,
              runtimeAvailable: error.code !== "runtime_unavailable",
              accessibility: false,
              screenRecording: "unknown" as const,
            }),
          ),
        ),
      );

  const screenshot: ComputerUse["Service"]["screenshot"] = (app, session, observationId) =>
    !supported
      ? Effect.fail(unsupported())
      : Effect.gen(function* () {
          const dir = yield* Effect.tryPromise({
            try: () => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tabs-computer-use-")),
            catch: () =>
              new ComputerUseError({
                code: "screenshot_failed",
                message: "Could not create a temp folder.",
              }),
          });
          return yield* Effect.gen(function* () {
            const path = NodePath.join(dir, "window.png");
            if (platform === "darwin" && app.kind !== "attachment") {
              // macOS captures from the server so the Screen Recording grant belongs to Tabs.
              const framed = yield* call({ op: "windowFrame", app });
              const frame = framed.frame;
              if (frame === undefined) {
                return yield* new ComputerUseError({
                  code: "window_not_found",
                  message: "The app has no window to capture.",
                });
              }
              const region = [frame.x, frame.y, frame.width, frame.height]
                .map((value) => Math.round(value))
                .join(",");
              const captured = yield* Effect.tryPromise({
                try: () =>
                  runProcess("screencapture", ["-x", "-t", "png", "-R", region, path], {
                    timeoutMs: 10_000,
                    allowNonZeroExit: true,
                  }),
                catch: () =>
                  new ComputerUseError({
                    code: "screenshot_failed",
                    message: "screencapture could not run.",
                  }),
              });
              if (captured.code !== 0) {
                return yield* new ComputerUseError({
                  code: "screenshot_failed",
                  message: `Screen capture failed${captured.stderr ? `: ${captured.stderr.trim()}` : ""}. Screen Recording permission may be missing; call computer_permissions.`,
                });
              }
            } else {
              yield* call({ op: "screenshot", app, path }, session, observationId);
            }
            const bytes = yield* Effect.tryPromise({
              try: () => NodeFSP.readFile(path),
              catch: () =>
                new ComputerUseError({
                  code: "screenshot_failed",
                  message: "No screenshot file was produced. Check computer_permissions.",
                }),
            });
            const size = pngDimensions(bytes);
            if (!size || size.width <= 0 || size.height <= 0)
              return yield* new ComputerUseError({
                code: "screenshot_failed",
                message: "The runtime returned invalid PNG data.",
              });
            return {
              path,
              width: size.width,
              height: size.height,
              note: "Coordinates use the units of the last snapshot. Scale PNG pixels proportionally to the snapshot window width and height.",
            };
          }).pipe(
            Effect.onError(() =>
              Effect.promise(() =>
                NodeFSP.rm(dir, { force: true, recursive: true }).catch(() => undefined),
              ),
            ),
          );
        });

  return ComputerUse.of({
    execute,
    wait,
    permissions,
    screenshot,
    revokeAll: native.revokeAll(),
    revokeThread: (threadId) => native.revokeThread(threadId),
    grant: (threadId) => native.get(threadId),
    control: (input) => (supported ? native.control(input) : Effect.fail(unsupported())),
  });
});

export const layer = Layer.effect(ComputerUse, make());

export const readPermissions = ComputerUse.use((computer) => computer.permissions);
