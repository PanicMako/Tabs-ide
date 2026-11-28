import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";
import { PreviewAutomationBroker } from "../../PreviewAutomationBroker.ts";
import {
  type DeviceError,
  DeviceComparisonError,
  DeviceComparisonFirstDifference,
  DeviceComparisonFrame,
  DeviceHostId,
  DeviceId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
  type DevicePlatform,
  type DeviceSummary,
  DeviceToolUnavailableError,
  LOCAL_DEVICE_HOST_ID,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { HostProcessPlatform } from "@tabs/shared/hostProcess";

import * as DeviceService from "../../../device/DeviceService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DeviceScreenshotToolkit, DeviceStandardToolkit, DeviceToolkit } from "./tools.ts";

/** The flags that pin every agent-device command to one device. */
export function agentDeviceTargetArgs(device: DeviceSummary): ReadonlyArray<string> {
  return device.platform === "ios"
    ? ["--platform", "ios", "--udid", device.id]
    : ["--platform", "android", "--serial", device.id];
}

/**
 * Just-in-time guidance returned from `device_open`. This is the one place
 * the agent learns how to drive the device, so it lives with the tool result
 * rather than in the always-on prompt block; threads that never open a device
 * never pay for it.
 */
export function agentDeviceQuickStart(
  device: DeviceSummary,
  targetArgs = agentDeviceTargetArgs(device),
  command = "agent-device",
  windows = false,
  resumedApp?: string,
  approvedApp?: string,
): string {
  const quote = (arg: string) =>
    /^[a-zA-Z0-9_./:-]+$/.test(arg)
      ? arg
      : "'" + arg.replaceAll("'", windows ? "''" : "'\"'\"'") + "'";
  const executable = windows ? `& ${quote(command)}` : quote(command);
  const target = targetArgs.map(quote).join(" ");
  const platformNotes =
    device.platform === "ios"
      ? "First use builds an XCTest runner and can take a couple of minutes; later commands are fast."
      : "The Android snapshot helper installs itself on first use.";
  return [
    `The user is watching ${device.name} (${device.version}) in the Device panel.`,
    `Drive it with ${executable}. Use this exact executable path; login shells may reset PATH. Always pass ${target}.`,
    "Typical loop:",
    ...(resumedApp
      ? [
          `The user returned control of ${resumedApp}. Start with a fresh snapshot in the retained session.`,
        ]
      : [
          approvedApp
            ? `  ${executable} open ${quote(approvedApp)} ${target}     # open once, then snapshot`
            : `  ${executable} open <bundle-or-package-id> ${target}     # or: open <app> <deep-link-url>`,
        ]),
    `  ${executable} snapshot -i ${target}                     # accessibility tree with @eN refs`,
    `  ${executable} click @e3 ${target}`,
    `  ${executable} fill @e5 "text" ${target}`,
    `  ${executable} screenshot /tmp/shot.png ${target}        # or call device_screenshot`,
    ...(resumedApp || approvedApp
      ? []
      : [`  ${executable} install <path-to-.app-or-.apk> ${target}`]),
    `Prefer snapshot refs over coordinates. Run ${executable} help for workflow guides and ${executable} <command> --help for flags.`,
    "Keep the returned --config and --session flags on every command. Tabs reserves this device for this agent until the user stops or takes over control.",
    "Ask the user to take over for sign-in or private input. After the user returns control, call device_open and follow its instructions for a fresh snapshot.",
    "These controls apply to this Tabs launcher. Separately launched agent-device, adb and simctl use the shell's own device access.",
    ...(resumedApp || approvedApp
      ? []
      : [
          "For remote hosts, use the returned invocation for app installation. Arrange builds and any Metro reverse forwarding yourself.",
        ]),
    platformNotes,
  ].join("\n");
}

const requireDeviceAccess = McpInvocationContext.requireThreadMcpCapability("device").pipe(
  Effect.mapError(
    () =>
      new DeviceToolUnavailableError({
        reason: "Agent device access is turned off for this environment.",
      }),
  ),
);

const toolError = (error: DeviceError | DeviceToolUnavailableError) => error;

const threadDevice = Effect.fn("DeviceToolkit.threadDevice")(function* (
  threadId: ThreadId,
  input: {
    hostId?: string | undefined;
    deviceId?: string | undefined;
    platform?: DevicePlatform | undefined;
  },
) {
  const devices = yield* DeviceService.DeviceService;
  const state = yield* devices.state;
  if (!state.agentAccessEnabled)
    return yield* new DeviceToolUnavailableError({ reason: "Agent device access is disabled." });
  const hostId = input.hostId ?? (input.deviceId === undefined ? undefined : LOCAL_DEVICE_HOST_ID);
  const sessions = state.sessions.filter(
    (s) =>
      s.threadId === threadId &&
      (hostId === undefined || s.hostId === hostId) &&
      (input.platform === undefined || s.platform === input.platform) &&
      (input.deviceId === undefined || s.deviceId === input.deviceId),
  );
  if (sessions.length !== 1)
    return yield* new DeviceToolUnavailableError({
      reason: sessions.length
        ? "Several devices are open. Specify hostId and deviceId."
        : "Open the selected device in this thread’s Device panel and enable agent access first.",
    });
  return sessions[0]!;
});

const handlers = {
  device_list: (input) =>
    Effect.gen(function* () {
      const scope = yield* requireDeviceAccess;
      const devices = yield* DeviceService.DeviceService;
      const state = yield* devices.list;
      if (state.hostStatus === "disabled") {
        return yield* new DeviceToolUnavailableError({
          reason:
            "Device support is off. Ask the user to enable it in the Device panel before installing or starting device tools.",
        });
      }
      const hostId = input?.hostId;
      const open = state.sessions
        .filter((session) => session.threadId === scope.thread.threadId)
        .map((session) => ({ hostId: session.hostId, deviceId: session.deviceId }));
      return {
        hostStatuses: Object.fromEntries(
          Object.entries(state.hostStatuses).filter(([id]) => !hostId || id === hostId),
        ),
        hosts: hostId ? state.hosts.filter((host) => host.id === hostId) : state.hosts,
        devices: hostId
          ? state.devices.filter((device) => device.hostId === hostId)
          : state.devices,
        open,
      };
    }).pipe(Effect.mapError(toolError)),
  device_open: (input) =>
    Effect.gen(function* () {
      const scope = yield* requireDeviceAccess;
      const devices = yield* DeviceService.DeviceService;
      const session = yield* threadDevice(scope.thread.threadId, input);
      const device = (yield* devices.state).devices.find(
        (candidate) => candidate.hostId === session.hostId && candidate.id === session.deviceId,
      );
      if (!device?.booted)
        return yield* new DeviceToolUnavailableError({
          reason: "The selected device is no longer running. Reopen it in the Device panel.",
        });
      const { appId: requestedApp, approvalId } = input;
      if (requestedApp && !approvalId) {
        const { pendingAppApproval } = yield* devices
          .comparison(
            {
              action: "requestDeviceApp",
              threadId: scope.thread.threadId,
              device: { hostId: session.hostId, deviceId: session.deviceId },
              appId: requestedApp,
            },
            undefined,
            scope.thread,
          )
          .pipe(
            Effect.mapError(
              (error: DeviceComparisonError) =>
                new DeviceToolUnavailableError({ reason: error.reason }),
            ),
          );
        if (!pendingAppApproval)
          return yield* new DeviceToolUnavailableError({
            reason: "The device app request could not be prepared.",
          });
        return { status: "approval_required" as const, device, approval: pendingAppApproval };
      }
      const platform = yield* HostProcessPlatform;
      const {
        command,
        configPath,
        session: cliSession,
        appId,
        approvedAppId,
      } = yield* devices.agentTarget(session, scope.thread, yield* devices.agentCli, {
        ...(requestedApp && { appId: requestedApp }),
        ...(approvalId && { approvalId }),
      });
      const targetArgs = [
        ...agentDeviceTargetArgs(device),
        "--config",
        configPath,
        "--session",
        cliSession,
      ];
      return {
        device,
        agentDevice: { command, targetArgs },
        quickStart: agentDeviceQuickStart(
          device,
          targetArgs,
          command,
          platform === "win32",
          appId,
          approvedAppId,
        ),
      };
    }).pipe(Effect.mapError(toolError)),
  device_screenshot: (input) =>
    Effect.gen(function* () {
      const scope = yield* requireDeviceAccess;
      const devices = yield* DeviceService.DeviceService;
      const target = yield* threadDevice(scope.thread.threadId, input);
      const shot = yield* devices.agentScreenshot(target, scope.thread);
      const current = yield* threadDevice(scope.thread.threadId, target);
      if (
        current.openedAt !== target.openedAt ||
        shot.device.hostId !== target.hostId ||
        shot.device.id !== target.deviceId
      )
        return yield* new DeviceToolUnavailableError({
          reason: "The device changed during capture. Select it again.",
        });
      return {
        device: shot.device,
        screenshot: {
          mimeType: "image/png" as const,
          data: Buffer.from(shot.png).toString("base64"),
          ...pngDimensions(shot.png),
        },
      };
    }).pipe(Effect.mapError(toolError)),
  device_attach_screenshot: ({ tabId, grantId, selector }) =>
    Effect.gen(function* () {
      const scope = yield* requireDeviceAccess;
      yield* McpInvocationContext.requireThreadMcpCapability("preview").pipe(
        Effect.mapError(
          () => new DeviceToolUnavailableError({ reason: "Browser access is disabled." }),
        ),
      );
      const devices = yield* DeviceService.DeviceService;
      const broker = yield* PreviewAutomationBroker;
      const authorizationError = (error: DeviceComparisonError) =>
        new DeviceToolUnavailableError({ reason: error.reason });
      const authorize = (source?: Parameters<typeof devices.authorizeScreenshotTransfer>[1]) =>
        devices
          .authorizeScreenshotTransfer(scope.thread, source)
          .pipe(Effect.mapError(authorizationError));
      const deviceAccessIsCurrent = yield* authorize();
      const accessChanged = () =>
        new DeviceToolUnavailableError({
          reason: "Device access changed. Approve a new transfer.",
        });
      let connectionId: string | undefined;
      const transfer = (
        input: object,
        authorizeDeviceScreenshot?: Parameters<
          typeof broker.invoke
        >[0]["authorizeDeviceScreenshot"],
      ) =>
        broker
          .invoke<unknown>({
            scope,
            tabId,
            operation: "deviceScreenshotUpload",
            input: { grantId, ...input },
            ...(authorizeDeviceScreenshot === undefined ? {} : { authorizeDeviceScreenshot }),
            ...(connectionId === undefined ? {} : { requireConnectionId: connectionId }),
            onConnection: (id) => {
              connectionId = id;
            },
          })
          .pipe(
            Effect.mapError(
              () =>
                new DeviceToolUnavailableError({
                  reason:
                    "Check the destination tab, its screenshot approval and the file input. Inspect the draft before retrying.",
                }),
            ),
          );
      const source = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          hostId: DeviceHostId,
          deviceId: DeviceId,
          frame: Schema.optional(DeviceComparisonFrame),
          firstDifference: Schema.optional(DeviceComparisonFirstDifference),
          selection: Schema.optional(
            Schema.Struct({
              frame: Schema.optional(DeviceComparisonFrame),
              sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
              sizeBytes: Schema.Int.check(
                Schema.isBetween({ minimum: 1, maximum: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES }),
              ),
            }),
          ),
        }),
      )(yield* transfer({ phase: "inspect", selector })).pipe(
        Effect.mapError(
          () =>
            new DeviceToolUnavailableError({
              reason: "The desktop did not identify an approved device.",
            }),
        ),
      );
      const { hostId, deviceId, frame, firstDifference, selection } = source;
      const fileSelection = (sha256: string, sizeBytes: number, frame?: DeviceComparisonFrame) => ({
        hostId,
        deviceId,
        ...(frame && { frame }),
        tabId,
        status: "file_selected" as const,
        fileName: `device-${grantId}.png`,
        sha256,
        sizeBytes,
      });
      const unavailableFrame = () =>
        new DeviceToolUnavailableError({
          reason:
            "The approved comparison frame is unavailable. Open the first difference and select its evidence again.",
        });
      if (frame && firstDifference) return yield* unavailableFrame();
      const readFrozen = Effect.fn("DeviceToolkit.readFrozenScreenshot")(function* (
        reference: DeviceComparisonFrame | DeviceComparisonFirstDifference,
        requiresApproval: boolean,
      ) {
        const { runId, side } = reference;
        const { run, evidence, approvedEvidence } = yield* devices
          .comparison(
            { threadId: scope.thread.threadId, action: "evidence", runId },
            undefined,
            requiresApproval ? scope.thread : undefined,
          )
          .pipe(
            Effect.mapError((error) => new DeviceToolUnavailableError({ reason: error.reason })),
          );
        const target = run?.[side];
        const step = run?.firstDifference?.step;
        const image = side === "source" ? evidence?.sourcePng : evidence?.targetPng;
        if (
          !image ||
          run?.runId !== runId ||
          step === undefined ||
          !Number.isSafeInteger(step) ||
          step < 1 ||
          ("step" in reference && reference.step !== step) ||
          target?.hostId !== hostId ||
          target.deviceId !== deviceId ||
          (requiresApproval &&
            (run.phase === "stopped" ||
              run.savedAt !== undefined ||
              !evidence?.sourcePng ||
              !evidence.targetPng ||
              approvedEvidence?.tabId !== tabId ||
              approvedEvidence.grantIds[side === "source" ? 0 : 1] !== grantId))
        )
          return yield* unavailableFrame();
        return { frame: { runId, side, step }, image, savedAt: run.savedAt };
      });
      const checkSource = (kind: "live" | "comparison") =>
        Effect.gen(function* () {
          const attachment = yield* threadDevice(scope.thread.threadId, { hostId, deviceId });
          return yield* authorize({ kind, attachment });
        });
      const authorizeFirstDifference = (frame: DeviceComparisonFrame) =>
        authorize({ kind: "firstDifference", frame, hostId, deviceId, tabId, grantId });
      if (selection) {
        // A lost reply can report a previously selected file, but can never select it again.
        if (frame || (firstDifference && !selection.frame)) return yield* unavailableFrame();
        const reference = firstDifference ?? selection.frame;
        let sourceIsCurrent: (() => boolean) | undefined;
        if (reference) {
          const frozen = yield* readFrozen(reference, firstDifference !== undefined);
          const selected = selection.frame;
          const png = screenshotPng(Buffer.from(frozen.image, "base64"));
          if (
            !selected ||
            selected.runId !== frozen.frame.runId ||
            selected.side !== frozen.frame.side ||
            selected.step !== frozen.frame.step ||
            !png ||
            png.length !== selection.sizeBytes ||
            createHash("sha256").update(png).digest("hex") !== selection.sha256
          )
            return yield* unavailableFrame();
          if (firstDifference) sourceIsCurrent = yield* authorizeFirstDifference(frozen.frame);
          else if (!frozen.savedAt) sourceIsCurrent = yield* checkSource("comparison");
        } else {
          sourceIsCurrent = yield* checkSource("live");
        }
        if (!deviceAccessIsCurrent() || sourceIsCurrent?.() === false)
          return yield* accessChanged();
        return fileSelection(selection.sha256, selection.sizeBytes, selection.frame);
      }

      const reference = firstDifference ?? frame;
      const sourceImage = yield* Effect.gen(function* () {
        if (reference) {
          const { frame, image, savedAt } = yield* readFrozen(
            reference,
            firstDifference !== undefined,
          );
          return {
            bytes: Buffer.from(image, "base64"),
            frame,
            savedAt,
            sourceIsCurrent: firstDifference
              ? yield* authorizeFirstDifference(frame)
              : savedAt
                ? undefined
                : yield* checkSource("comparison"),
          };
        }
        const attachment = yield* threadDevice(scope.thread.threadId, { hostId, deviceId });
        const sourceIsCurrent = yield* authorize({ kind: "live", attachment });
        const shot = yield* devices.agentScreenshot(attachment, scope.thread);
        if (shot.device.hostId !== hostId || shot.device.id !== deviceId)
          return yield* new DeviceToolUnavailableError({
            reason: "The capture came from a different device.",
          });
        return {
          bytes: Buffer.from(shot.png),
          frame: undefined,
          savedAt: undefined,
          sourceIsCurrent,
        };
      });
      const png = screenshotPng(sourceImage.bytes);
      if (!png)
        return yield* new DeviceToolUnavailableError({
          reason:
            "The approved device did not return a complete PNG within the attachment size limit.",
        });
      const digest = createHash("sha256").update(png).digest("hex");
      const { frame: approvedFrame, savedAt, sourceIsCurrent } = sourceImage;
      const isCurrent = () => deviceAccessIsCurrent() && (sourceIsCurrent?.() ?? true);
      const checkTransfer = Effect.gen(function* () {
        if (approvedFrame) {
          const latest = yield* readFrozen(approvedFrame, firstDifference !== undefined);
          const latestPng = screenshotPng(Buffer.from(latest.image, "base64"));
          if (
            latest.savedAt !== savedAt ||
            !latestPng ||
            createHash("sha256").update(latestPng).digest("hex") !== digest
          )
            return yield* unavailableFrame();
        }
      });
      yield* checkTransfer;
      if (!isCurrent()) return yield* accessChanged();
      const result = yield* transfer(
        {
          phase: "attach",
          hostId,
          deviceId,
          ...(approvedFrame && { frame: approvedFrame }),
          selector,
          png: png.toString("base64"),
        },
        {
          check: checkTransfer.pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
          isCurrent,
        },
      );
      if (!Schema.is(Schema.Struct({ attached: Schema.Literal(true) }))(result))
        return yield* new DeviceToolUnavailableError({
          reason: "The desktop did not confirm file selection. Inspect the destination.",
        });
      return fileSelection(digest, png.length, approvedFrame);
    }),
  device_close: (input) =>
    Effect.gen(function* () {
      const scope = yield* requireDeviceAccess;
      const devices = yield* DeviceService.DeviceService;
      if (input.shutdown)
        return yield* new DeviceToolUnavailableError({
          reason:
            "Power off the device from its Device panel. Closing a thread attachment leaves it running.",
        });
      yield* devices.close({
        threadId: scope.thread.threadId,
        ...(input.hostId === undefined ? {} : { hostId: input.hostId }),
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      });
      return {};
    }).pipe(Effect.mapError(toolError)),
} satisfies Parameters<typeof DeviceToolkit.toLayer>[0];

function screenshotPng(bytes: Buffer): Buffer | undefined {
  const offset = bytes.indexOf(Buffer.from("89504e470d0a1a0a", "hex"));
  if (offset < 0) return;
  const png = bytes.subarray(offset);
  if (
    png.length <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES &&
    pngDimensions(png).width &&
    png.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
  )
    return png;
}

/** Width and height from the IHDR chunk; a PNG that lacks one reports 0×0. */
export function pngDimensions(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24) return { width: 0, height: 0 };
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const isPng =
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    view.getUint32(12) === 0x49484452;
  return isPng
    ? { width: view.getUint32(16), height: view.getUint32(20) }
    : { width: 0, height: 0 };
}

const { device_screenshot, ...standardHandlers } = handlers;

export const layerStandard = DeviceStandardToolkit.toLayer(standardHandlers);

export const layerScreenshot = DeviceScreenshotToolkit.toLayer({
  device_screenshot,
});
