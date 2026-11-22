import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
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

export class ComputerUseError extends Schema.TaggedError<ComputerUseError>()("ComputerUseError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export interface ComputerPermissionStatus {
  readonly platformSupported: boolean;
  readonly accessibility: boolean;
  readonly screenRecording: "granted" | "denied" | "unknown";
}

export interface ComputerOutcome {
  readonly action?: string;
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
) => Promise<{ stdout: string; stderr: string }>;

const processInvoker: RuntimeInvoker = async (request, platform) => {
  const invocation = buildRuntimeInvocation(platform, request);
  const result = await runProcess(invocation.command, invocation.args, {
    stdin: invocation.stdin,
    env: { ...process.env, ...invocation.env },
    timeoutMs: RUNTIME_TIMEOUT_MS,
    allowNonZeroExit: true,
  });
  if (result.timedOut) throw new Error("The desktop runtime timed out.");
  return { stdout: result.stdout, stderr: result.stderr };
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
    readonly execute: (
      request: ComputerRequest,
      session: string,
      options?: { readonly treeDiff?: boolean; readonly query?: string },
    ) => Effect.Effect<ComputerOutcome, ComputerUseError>;
    /** Polls the app's tree until the condition holds, or fails with `wait_timeout`. */
    readonly wait: (
      app: AppSelector,
      condition: WaitCondition,
      timeoutMs?: number,
    ) => Effect.Effect<ComputerOutcome, ComputerUseError>;
    readonly permissions: Effect.Effect<ComputerPermissionStatus>;
    readonly screenshot: (app: AppSelector) => Effect.Effect<
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

  const call = (request: ComputerRequest) =>
    Effect.tryPromise({
      try: () => invoke(request, platform),
      catch: (cause) =>
        new ComputerUseError({
          code: "accessibility_error",
          message: cause instanceof Error ? cause.message : "The desktop runtime failed.",
        }),
    }).pipe(
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
      gate.withPermits(1),
    );

  const execute: ComputerUse["Service"]["execute"] = (request, session, options) =>
    !supported
      ? Effect.fail(unsupported())
      : call(request).pipe(
          Effect.map((response): ComputerOutcome => {
            const snapshot = response.snapshot;
            const applied =
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
              elementCount: snapshot.elementCount,
              focusedElementIndex: snapshot.focusedElementIndex,
              app: snapshot.app,
            };
          }),
        );

  const wait: ComputerUse["Service"]["wait"] = (app, condition, timeoutMs) =>
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
      let waited = 0;
      while (true) {
        // The app or window may not exist yet; keep polling until the deadline.
        const read = yield* call({ op: "snapshot", app, maxNodes: 600 }).pipe(
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
        accessibility: false,
        screenRecording: "unknown" as const,
      })
    : call({ op: "permissions" }).pipe(
        Effect.map((response) => ({
          platformSupported: true,
          accessibility: response.permissions?.accessibility ?? false,
          screenRecording: response.permissions?.screenRecording ?? ("unknown" as const),
        })),
        Effect.orElseSucceed(() => ({
          platformSupported: true,
          accessibility: false,
          screenRecording: "unknown" as const,
        })),
      );

  const screenshot: ComputerUse["Service"]["screenshot"] = (app) =>
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
          const path = NodePath.join(dir, "window.png");
          if (platform === "darwin") {
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
            yield* call({ op: "screenshot", app, path });
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
          return {
            path,
            width: size?.width ?? null,
            height: size?.height ?? null,
            note: "Pixels can be larger than the window's points on high-DPI displays; divide pixel coordinates by that scale before passing x and y to computer_click.",
          };
        });

  return ComputerUse.of({ execute, wait, permissions, screenshot });
});

export const layer = Layer.effect(ComputerUse, make());

/** One-shot permission read for the settings screen; no baselines or queue are kept. */
export const readPermissions = ComputerUse.use((computer) => computer.permissions).pipe(
  Effect.map(({ platformSupported, accessibility, screenRecording }) => ({
    platformSupported,
    accessibility,
    screenRecording,
  })),
  Effect.provide(layer),
);
