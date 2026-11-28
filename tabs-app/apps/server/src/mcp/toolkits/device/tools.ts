import {
  PreviewTabId,
  DeviceComparisonFrame,
  TrimmedNonEmptyString,
  DeviceId,
  DeviceHostId,
  DeviceToolCloseInput,
  DeviceToolError,
  DeviceToolListResult,
  DeviceToolOpenInput,
  DeviceToolOpenResult,
  DeviceToolScreenshotResult,
  DeviceToolTargetInput,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { PreviewAutomationBroker } from "../../PreviewAutomationBroker.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as DeviceService from "../../../device/DeviceService.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, DeviceService.DeviceService];

/**
 * Deliberately a small surface: lifecycle, visibility for the user, and one
 * image-returning verb. Driving the device (taps, typing, install, logs)
 * happens through the preconfigured `agent-device` CLI, which has the
 * semantic snapshot model agents need. The Tabs launcher binds its supported
 * commands to live device ownership.
 */
const DeviceListTool = Tool.make("device_list", {
  description:
    "List iOS Simulators and Android Emulators on this environment's device hosts, which platforms each host can run, and which devices are already open in this thread's Device panel. Call this before device_open when you do not know a device id.",
  // An empty struct serializes as `anyOf [object, array]`, which some
  // providers reject and then drop every tool on the server with it.
  parameters: Schema.Struct({
    hostId: Schema.optional(
      Schema.String.annotate({ description: "Limit to one device host. Defaults to all hosts." }),
    ),
  }),
  success: DeviceToolListResult,
  failure: DeviceToolError,
  dependencies,
})
  .annotate(Tool.Title, "List devices")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DeviceOpenTool = Tool.make("device_open", {
  description:
    "Request access to an exact appId on a running device attached to this thread. Ask the user to review the request in the Device panel. Repeat with the same device, appId and approved approvalId to get the launcher. Omit appId to reacquire an existing approved launcher after handoff.",
  parameters: DeviceToolOpenInput,
  success: DeviceToolOpenResult,
  failure: DeviceToolError,
  dependencies,
})
  .annotate(Tool.Title, "Open device")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const DeviceScreenshotTool = Tool.make("device_screenshot", {
  description:
    "Capture the current app screen as a PNG after device_open and opening the app through its Tabs launcher. Private screens require user takeover. For taps and text use the Tabs launcher.",
  parameters: DeviceToolTargetInput,
  success: DeviceToolScreenshotResult,
  failure: DeviceToolError,
  dependencies,
})
  .annotate(Tool.Title, "Screenshot device")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const DeviceAttachScreenshotTool = Tool.make("device_attach_screenshot", {
  description:
    "Attach an approved PNG to one empty file input on the exact destination page. Pass a CSS selector and the tabId and grantId from the user's screenshot handoff or from approvedEvidence in device_comparison_status. For approvedEvidence, use the source and target grants on separate inputs. Each grant permits one attachment. After a lost reply retry with the same arguments to check the existing selection. A successful result verifies file selection. Inspect the page separately for a saved draft or submission.",
  parameters: Schema.Struct({
    tabId: PreviewTabId,
    grantId: Schema.String.check(Schema.isUUID()),
    selector: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  }),
  success: Schema.Struct({
    tabId: PreviewTabId,
    hostId: DeviceHostId,
    deviceId: DeviceId,
    fileName: Schema.String,
    sha256: Schema.String,
    sizeBytes: Schema.Int,
    status: Schema.Literal("file_selected"),
    frame: Schema.optional(DeviceComparisonFrame),
  }),
  failure: DeviceToolError,
  dependencies: [...dependencies, PreviewAutomationBroker],
})
  .annotate(Tool.Title, "Attach device screenshot")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const DeviceCloseTool = Tool.make("device_close", {
  description:
    "Remove a device from this thread's Device panel. Power-off is available to the user in the Device panel.",
  parameters: DeviceToolCloseInput,
  success: Schema.Record(Schema.String, Schema.Never).annotate({
    description: "The device was closed.",
  }),
  failure: DeviceToolError,
  dependencies,
})
  .annotate(Tool.Title, "Close device")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const DeviceStandardToolkit = Toolkit.make(
  DeviceListTool,
  DeviceOpenTool,
  DeviceCloseTool,
  DeviceAttachScreenshotTool,
);

export const DeviceScreenshotToolkit = Toolkit.make(DeviceScreenshotTool);

export const DeviceToolkit = Toolkit.make(
  DeviceListTool,
  DeviceOpenTool,
  DeviceScreenshotTool,
  DeviceAttachScreenshotTool,
  DeviceCloseTool,
);
