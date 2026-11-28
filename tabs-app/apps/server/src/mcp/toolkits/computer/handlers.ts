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
  type AttachedAppSelector,
  type ComputerRequest,
  type Parsed,
} from "../../../computerUse/commands.ts";
import * as ComputerUse from "../../../computerUse/ComputerUseService.ts";
import { runtimePlatformSupported } from "../../../computerUse/runtimeInvocation.ts";
import * as Settings from "../../../serverSettings.ts";
import { readMutationCaller, unavailable } from "../../threadAccess.ts";
import { ComputerToolkit } from "./tools.ts";

export const COMPUTER_USE_DISABLED_MESSAGE =
  "Computer use is switched off. The user can turn it on in Tabs under Settings > Labs > Computer use.";

const denied = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

const mapFailure = (error: ComputerUse.ComputerUseError) =>
  denied(
    [
      "permission_denied",
      "sensitive_field",
      "window_grant_required",
      "foreground_denied",
      "user_turn",
    ].includes(error.code)
      ? "capability_denied"
      : error.code === "unsupported_capability"
        ? "provider_unavailable"
        : "orchestration_error",
    error.message,
  );

const fromParsed = <A>(parsed: Parsed<A>) =>
  parsed.ok ? Effect.succeed(parsed.value) : Effect.fail(denied("invalid_request", parsed.message));

const guard = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
  if (!current.computerUseEnabled) {
    return yield* denied("capability_denied", COMPUTER_USE_DISABLED_MESSAGE);
  }
  const context = yield* readMutationCaller();
  if (!context.caller || context.limits.interactionMode !== "default") {
    return yield* denied(
      "capability_denied",
      "Desktop window access requires a live thread in default interaction mode.",
    );
  }
  return context.caller.id;
});

const requireAttachment = (
  app: ReturnType<typeof parseAppSelector>,
): Effect.Effect<AttachedAppSelector, OrchestratorMcpFailure> =>
  Effect.gen(function* () {
    const selector = yield* fromParsed(app);
    if (selector.kind !== "attachment") {
      return yield* denied(
        "capability_denied",
        "Use the attached window selector from computer_list_apps.",
      );
    }
    return selector;
  });

const run = (
  request: Parsed<ComputerRequest>,
  options?: {
    readonly treeDiff?: boolean;
    readonly query?: string;
    readonly observationId?: string | undefined;
  },
) =>
  Effect.gen(function* () {
    const session = yield* guard;
    const parsed = yield* fromParsed(request);
    if ("app" in parsed) yield* requireAttachment({ ok: true, value: parsed.app });
    const computer = yield* ComputerUse.ComputerUse;
    return yield* computer.execute(parsed, session, options).pipe(Effect.mapError(mapFailure));
  });

export const layer = ComputerToolkit.toLayer({
  computer_permissions: () =>
    Effect.gen(function* () {
      const settings = yield* Settings.ServerSettingsService;
      const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      const computer = yield* ComputerUse.ComputerUse;
      const status = current.computerUseEnabled ? yield* computer.permissions : undefined;
      const platformSupported =
        status?.platformSupported ?? runtimePlatformSupported(process.platform);
      const runtimeAvailable = status?.runtimeAvailable ?? false;
      return {
        enabled: current.computerUseEnabled,
        platformSupported,
        runtimeAvailable,
        accessibility: status?.accessibility ?? false,
        screenRecording: status?.screenRecording ?? "unknown",
        ...(status?.capabilities ? { capabilities: status.capabilities } : {}),
        guidance: !current.computerUseEnabled
          ? COMPUTER_USE_DISABLED_MESSAGE
          : (status?.capabilities?.details ??
            "Check Settings > Labs > Computer use for desktop availability."),
      };
    }),
  computer_list_apps: () =>
    Effect.gen(function* () {
      const thread = yield* guard;
      const computer = yield* ComputerUse.ComputerUse;
      const grant = computer.grant(thread);
      return {
        treeIsDiff: false,
        tree: grant
          ? `${grant.selector} | ${grant.window.app} | ${grant.window.title} | ${grant.mode === "user" ? "user has control" : grant.foreground ? "accessibility and physical input allowed" : "accessibility only"}`
          : "Ask the user to attach a window from Desktop window in this thread.",
      };
    }),
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
      observationId: input.observationId,
      ...(input.query === undefined ? {} : { query: input.query }),
    }),
  computer_click: (input) => run(buildClickRequest(input), { observationId: input.observationId }),
  computer_right_click: (input) =>
    run(buildClickRequest({ ...input, button: "right" }), { observationId: input.observationId }),
  computer_drag: (input) => run(buildDragRequest(input), { observationId: input.observationId }),
  computer_set_value: (input) =>
    run(buildSetValueRequest(input), { observationId: input.observationId }),
  computer_secondary_action: (input) =>
    run(buildSecondaryActionRequest(input), { observationId: input.observationId }),
  computer_wait: (input) =>
    Effect.gen(function* () {
      const thread = yield* guard;
      const app = yield* requireAttachment(parseAppSelector(input.app));
      const computer = yield* ComputerUse.ComputerUse;
      return yield* computer
        .wait(
          app,
          { text: input.text, enabled: input.enabled, windowTitle: input.windowTitle },
          input.timeoutMs,
          thread,
        )
        .pipe(Effect.mapError(mapFailure));
    }),
  computer_type: (input) => run(buildTypeRequest(input), { observationId: input.observationId }),
  computer_key: (input) =>
    run(buildKeyRequest(input, process.platform), { observationId: input.observationId }),
  computer_scroll: (input) =>
    run(buildScrollRequest(input), { observationId: input.observationId }),
  computer_screenshot: ({ app, observationId }) =>
    Effect.gen(function* () {
      const thread = yield* guard;
      const selector = yield* requireAttachment(parseAppSelector(app));
      const computer = yield* ComputerUse.ComputerUse;
      return yield* computer
        .screenshot(selector, thread, observationId)
        .pipe(Effect.mapError(mapFailure));
    }),
});
