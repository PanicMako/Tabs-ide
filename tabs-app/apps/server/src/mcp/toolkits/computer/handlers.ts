import { OrchestratorMcpFailure } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import {
  buildClickRequest,
  buildDragRequest,
  buildSecondaryActionRequest,
  buildSetValueRequest,
  buildKeyRequest,
  buildScrollRequest,
  buildSnapshotRequest,
  buildTypeRequest,
  parseAppSelector,
  type ComputerRequest,
  type Parsed,
} from "../../../computerUse/commands.ts";
import * as ComputerUse from "../../../computerUse/ComputerUseService.ts";
import * as Settings from "../../../serverSettings.ts";
import { readFullAccessCaller, unavailable } from "../../threadAccess.ts";
import { ComputerToolkit } from "./tools.ts";

export const COMPUTER_USE_DISABLED_MESSAGE =
  "Computer use is switched off. The user can turn it on in Tabs under Settings > Labs > Computer use.";

const denied = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

const mapFailure = (error: ComputerUse.ComputerUseError) =>
  denied(
    error.code === "permission_denied" || error.code === "sensitive_field"
      ? "capability_denied"
      : error.code === "unsupported_capability"
        ? "provider_unavailable"
        : "orchestration_error",
    error.message,
  );

const fromParsed = <A>(parsed: Parsed<A>) =>
  parsed.ok ? Effect.succeed(parsed.value) : Effect.fail(denied("invalid_request", parsed.message));

/**
 * Every desktop action passes through here: the Labs switch must be on, and the caller must be a
 * live full-access thread (or full-access client), because these tools bypass approval prompts.
 */
const guard = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
  if (!current.computerUseEnabled) {
    return yield* denied("capability_denied", COMPUTER_USE_DISABLED_MESSAGE);
  }
  const context = yield* readFullAccessCaller(
    "Computer use requires a live full-access/default calling thread or a full-access client.",
  );
  return {
    session: context.scope.thread?.threadId ?? context.scope.client?.sessionId ?? "default",
  };
});

const run = (request: Parsed<ComputerRequest>, options?: { readonly treeDiff?: boolean }) =>
  Effect.gen(function* () {
    const { session } = yield* guard;
    const parsed = yield* fromParsed(request);
    const computer = yield* ComputerUse.ComputerUse;
    return yield* computer.execute(parsed, session, options).pipe(Effect.mapError(mapFailure));
  });

const PERMISSION_GUIDANCE =
  "Grant Tabs access in System Settings > Privacy & Security: Accessibility (required to read and control apps) and Screen Recording (required for screenshots). macOS may ask you to restart Tabs after granting.";

export const layer = ComputerToolkit.toLayer({
  computer_permissions: () =>
    Effect.gen(function* () {
      const settings = yield* Settings.ServerSettingsService;
      const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      const computer = yield* ComputerUse.ComputerUse;
      const status = yield* computer.permissions;
      return {
        enabled: current.computerUseEnabled,
        platformSupported: status.platformSupported,
        accessibility: status.accessibility,
        screenRecording: status.screenRecording,
        guidance: !current.computerUseEnabled
          ? COMPUTER_USE_DISABLED_MESSAGE
          : !status.platformSupported
            ? "Computer use is available on macOS only in this build."
            : status.accessibility && status.screenRecording !== "denied"
              ? "Ready."
              : PERMISSION_GUIDANCE,
      };
    }),
  computer_list_apps: () => run({ ok: true, value: { op: "listApps" } }),
  computer_focus_app: ({ app }) =>
    run(
      (() => {
        const selector = parseAppSelector(app);
        return selector.ok
          ? { ok: true, value: { op: "focusApp", app: selector.value } }
          : selector;
      })(),
    ),
  computer_snapshot: (input) =>
    run(buildSnapshotRequest(input), {
      treeDiff: false,
      ...(input.query === undefined ? {} : { query: input.query }),
    }),
  computer_click: (input) => run(buildClickRequest(input)),
  computer_right_click: (input) => run(buildClickRequest({ ...input, button: "right" })),
  computer_drag: (input) => run(buildDragRequest(input)),
  computer_set_value: (input) => run(buildSetValueRequest(input)),
  computer_secondary_action: (input) => run(buildSecondaryActionRequest(input)),
  computer_wait: (input) =>
    Effect.gen(function* () {
      yield* guard;
      const app = yield* fromParsed(parseAppSelector(input.app));
      const computer = yield* ComputerUse.ComputerUse;
      return yield* computer
        .wait(
          app,
          { text: input.text, enabled: input.enabled, windowTitle: input.windowTitle },
          input.timeoutMs,
        )
        .pipe(Effect.mapError(mapFailure));
    }),
  computer_type: (input) => run(buildTypeRequest(input)),
  computer_key: (input) => run(buildKeyRequest(input, process.platform)),
  computer_scroll: (input) => run(buildScrollRequest(input)),
  computer_screenshot: ({ app }) =>
    Effect.gen(function* () {
      yield* guard;
      const selector = yield* fromParsed(parseAppSelector(app));
      const computer = yield* ComputerUse.ComputerUse;
      return yield* computer.screenshot(selector).pipe(Effect.mapError(mapFailure));
    }),
});
