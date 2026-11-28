import {
  BrowserQuickActionApprovalRequired,
  BrowserQuickActionRequestInput,
  BrowserQuickActionResult,
  ToolActivityIcon,
  PreviewAutomationActInput,
  PreviewAutomationClickInput,
  PreviewAutomationDragInput,
  PreviewAutomationError,
  PreviewAutomationEvaluateInput,
  PreviewAutomationFindText,
  PreviewAutomationHoverInput,
  PreviewAutomationNavigateInput,
  PreviewAutomationOpenInput,
  PreviewAutomationPressInput,
  PreviewAutomationRecordingArtifact,
  PreviewAutomationRecordingStatus,
  PreviewAutomationResizeInput,
  PreviewAutomationResizeResult,
  PreviewAutomationScrollInput,
  PreviewAutomationSelectInput,
  PreviewAutomationSelectResult,
  PreviewAutomationSetColorSchemeInput,
  PreviewAutomationSetColorSchemeResult,
  PreviewAutomationSnapshot,
  PreviewAutomationStatus,
  PreviewAutomationTabTargetInput,
  PreviewAutomationTypeInput,
  PreviewAutomationUploadInput,
  PreviewAutomationWaitForInput,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import * as ServerConfig from "../../../config.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  PreviewAutomationBroker.PreviewAutomationBroker,
];

const presentationFields = { toolIcon: Schema.optional(ToolActivityIcon) };

const PreviewActionResult = Schema.Struct(presentationFields).annotate({
  description: "The preview action completed successfully.",
});

/** Drives the real browser and can destroy page state. */
const browserTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.OpenWorld, true).annotate(Tool.Destructive, true) as T;

/** Same open-world browser access, but the action does not destroy page state. */
const safeBrowserTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.OpenWorld, true).annotate(Tool.Destructive, false) as T;

/** A safe browser action that only observes, so it is also repeatable. */
const readonlyBrowserTool = <T extends Tool.Any>(tool: T): T =>
  safeBrowserTool(tool).annotate(Tool.Readonly, true).annotate(Tool.Idempotent, true) as T;

const PreviewStatusTool = Tool.make("preview_status", {
  description:
    "Report whether a collaborative browser tab is automation-capable, including its URL, title, visibility, loading state, viewport mode, and measured CSS-pixel size. Pass tabId to inspect a specific tab; omit it to use this agent session's current tab.",
  parameters: PreviewAutomationTabTargetInput,
  success: PreviewAutomationStatus,
  failure: PreviewAutomationError,
  dependencies,
})
  .annotate(Tool.Title, "Get preview status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const PreviewOpenTool = browserTool(
  Tool.make("preview_open", {
    description:
      "Initialize a collaborative browser tab and open its thread-bound inline preview by default. Set open=false for background-only automation. Pass tabId to reuse a specific existing tab, set reuseExistingTab=false to create another tab, or omit both to use this agent session's current tab.",
    parameters: PreviewAutomationOpenInput,
    success: PreviewAutomationStatus,
    failure: PreviewAutomationError,
    dependencies,
  })
    .annotate(Tool.Title, "Open browser preview")
    .annotate(Tool.Destructive, false),
);

const PreviewNavigateTool = safeBrowserTool(
  Tool.make("preview_navigate", {
    description:
      "Navigate a collaborative browser tab. Pass tabId to target a specific tab, plus {url:'https://t3.chat'} for a website or {target:{kind:'environment-port',port:5173}} for a dev server. Exactly one of url or target is required.",
    parameters: PreviewAutomationNavigateInput,
    success: PreviewAutomationStatus,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Navigate browser preview"),
);

const PreviewResizeTool = safeBrowserTool(
  Tool.make("preview_resize", {
    description:
      "Resize a collaborative browser tab, optionally selected by tabId. Use {mode:'fill'}, {mode:'freeform',width:1024,height:768}, or {mode:'preset',preset:'iphone-12-pro',orientation:'portrait'}. This changes CSS layout breakpoints without changing the desktop browser user agent.",
    parameters: PreviewAutomationResizeInput,
    success: Schema.Struct({ ...PreviewAutomationResizeResult.fields, ...presentationFields }),
    failure: PreviewAutomationError,
    dependencies,
  })
    .annotate(Tool.Title, "Resize browser viewport")
    .annotate(Tool.Idempotent, true),
);

const PreviewSetAppearanceTool = safeBrowserTool(
  Tool.make("preview_set_appearance", {
    description:
      "Emulate prefers-color-scheme in a collaborative browser tab, optionally selected by tabId. Use {colorScheme:'dark'} or {colorScheme:'light'} to preview the page in that appearance, and {colorScheme:'system'} to clear the override and follow the OS appearance.",
    parameters: PreviewAutomationSetColorSchemeInput,
    success: Schema.Struct({
      ...PreviewAutomationSetColorSchemeResult.fields,
      ...presentationFields,
    }),
    failure: PreviewAutomationError,
    dependencies,
  })
    .annotate(Tool.Title, "Set preview appearance")
    .annotate(Tool.Idempotent, true),
);

export const PreviewSnapshotTool = readonlyBrowserTool(
  Tool.make("preview_snapshot", {
    description:
      'Inspect a page before interacting. Pass tabId to inspect a specific tab; omit it to use this agent session\'s current tab. Returns page state, semantic elements, diagnostics, action history, and a PNG screenshot. Pass findText to look up exact visible text. The textMatches metadata gives a CSS selector for each unique match and reports not_found, ambiguous, or unobservable when a selector is unavailable. verifiedEvidenceDraft and verifiedScreenshotDraft are reported only when Tabs fetched and hashed the displayed image (receiptKind "image"). A receiptKind "pageText" result means the page shows the digest but the image bytes were not verified; do not call it verified. When present, verifiedEvidenceDraft means both comparison receipts were hashed and the draft can be reopened from chat; verifiedScreenshotDraft gives the SHA-256 of one hashed screenshot in the saved draft after reload, reopenable from the original screenshot transfer chip. unverifiedScreenshotDraft (receiptKind "pageText") means the page shows the digest but Tabs could not hash the displayed image; do not report it as verified. The text is capped near 20 KB and lists what it omitted. To read more on a project preview tab, use preview_evaluate; preview_evaluate is refused on pages the user attached, so there use findText, or scroll and snapshot again. Set includeImage=false for text-only output with the same page metadata. Set save=true to also write the PNG to disk and get screenshotPath back; with includeImage=false, save=true returns only the url and screenshotPath. Embed that path in your reply as ![alt](screenshotPath) so the user sees it. This is the only way to show the user a screenshot; the image in the tool result is not saved anywhere.',
    parameters: Schema.Struct({
      ...PreviewAutomationTabTargetInput.fields,
      findText: Schema.optional(
        PreviewAutomationFindText.annotate({
          description:
            "Look up 1 to 4 exact visible text strings, each trimmed and 1 to 300 characters.",
        }),
      ),
      includeImage: Schema.optional(
        Schema.Boolean.annotate({
          description:
            "Include the PNG image in the tool response. Defaults to true. Set false for text-only output.",
        }),
      ),
      save: Schema.optional(
        Schema.Boolean.annotate({
          description:
            "Write the screenshot PNG to disk and return its absolute path as screenshotPath. With includeImage=false, return only the url and screenshotPath. Defaults to false.",
        }),
      ),
    }),
    success: PreviewAutomationSnapshot,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Inspect browser page"),
);

export const PreviewActTool = browserTool(
  Tool.make("preview_act", {
    description:
      "Act on the chosen tab. Target with `locator='aria-ref=<ref>'` from `preview_snapshot` or a CSS `selector` from its textMatches. `x` and `y` go together. `timeoutMs` defaults to 15000. click: `button`, `clickCount` 1 to 3. type: literal `text`, `clear=true` replaces it. hover: shows menus or tooltips. select: `values` in one native <select>, by value or label; for a custom dropdown, click it open, then click the option. drag: `source` onto `target`. upload: absolute `paths` answer the file picker `preview_status` reports, [] cancels it, or a `locator` sets an <input type=file>. press: one `key`, such as 'Enter', with `modifiers`, to the focused element; click a field first to focus it. scroll: the tab, or one container with a locator; positive `deltaY` scrolls down, positive `deltaX` right.",
    parameters: PreviewAutomationActInput,
    success: Schema.Union([
      Schema.Struct({ ...PreviewAutomationSelectResult.fields, ...presentationFields }),
      PreviewActionResult,
    ]),
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Act in preview page"),
);

export const PreviewClickTool = browserTool(
  Tool.make("preview_click", {
    description:
      "Click exactly one target in the tab selected by tabId, or this agent session's current tab when omitted. Prefer a Playwright locator; selector accepts legacy CSS; x and y must be supplied together.",
    parameters: PreviewAutomationClickInput,
    success: PreviewActionResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Click preview page"),
);

export const PreviewTypeTool = browserTool(
  Tool.make("preview_type", {
    description:
      "Insert literal text into one input in the tab selected by tabId, or this agent session's current tab when omitted. Prefer a Playwright locator; set clear=true to replace existing text.",
    parameters: PreviewAutomationTypeInput,
    success: PreviewActionResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Type into preview page"),
);

export const PreviewHoverTool = safeBrowserTool(
  Tool.make("preview_hover", {
    description: "Hover one target to show menus or tooltips.",
    parameters: PreviewAutomationHoverInput,
    success: PreviewActionResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Hover preview page"),
);

export const PreviewSelectTool = browserTool(
  Tool.make("preview_select", {
    description:
      "Pick options in one native <select>, by value or label. For a custom dropdown, click it open, then click the option.",
    parameters: PreviewAutomationSelectInput,
    success: Schema.Struct({
      ...PreviewAutomationSelectResult.fields,
      ...presentationFields,
    }),
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Select preview option"),
);

export const PreviewDragTool = browserTool(
  Tool.make("preview_drag", {
    description: "Drag one element onto another.",
    parameters: PreviewAutomationDragInput,
    success: PreviewActionResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Drag in preview page"),
);

export const PreviewUploadTool = browserTool(
  Tool.make("preview_upload", {
    description:
      "Give files from this environment to the page. After a click opens a file picker, `preview_status` reports it. Pass absolute paths to answer it, or an empty list to cancel. Or pass a locator for an <input type=file>.",
    parameters: PreviewAutomationUploadInput,
    success: PreviewActionResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Upload files to preview page"),
);

export const PreviewPressTool = browserTool(
  Tool.make("preview_press", {
    description:
      "Press one keyboard key in the tab selected by tabId, or this agent session's current tab when omitted. Examples: {key:'Enter'}, {key:'Escape'}, or {key:'a',modifiers:['Meta']}.",
    parameters: PreviewAutomationPressInput,
    success: PreviewActionResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Press key in preview page"),
);

export const PreviewScrollTool = safeBrowserTool(
  Tool.make("preview_scroll", {
    description:
      "Scroll the tab selected by tabId, or this agent session's current tab when omitted. Positive deltaY scrolls down and positive deltaX scrolls right; a locator/selector targets a container.",
    parameters: PreviewAutomationScrollInput,
    success: PreviewActionResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Scroll preview page"),
);

/**
 * MCP `structuredContent` must be a JSON object, and Claude Code rejects the
 * whole result when it is not. Wrapping keeps arrays, strings, numbers, and
 * null valid instead of failing only for non-object expressions.
 */
export const PreviewEvaluateResult = Schema.Struct({
  ...presentationFields,
  value: Schema.Unknown.annotate({
    description: "The JSON-serializable value the expression produced, or null.",
  }),
}).annotate({ description: "The evaluated expression result." });

export const PreviewEvaluateTool = browserTool(
  Tool.make("preview_evaluate", {
    description:
      "Evaluate JavaScript in a project preview tab selected by tabId, or this agent session's current preview tab when omitted. Refused on pages the user attached; use preview_snapshot findText or scroll there. Returns {value} with a serializable result up to 64 KB; the expression may mutate page state.",
    parameters: PreviewAutomationEvaluateInput,
    success: PreviewEvaluateResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Evaluate JavaScript in preview"),
);

export const PreviewWaitForTool = readonlyBrowserTool(
  Tool.make("preview_wait_for", {
    description:
      "Wait in the tab selected by tabId, or this agent session's current tab when omitted, until all supplied locator, selector, text, and URL conditions match.",
    parameters: PreviewAutomationWaitForInput,
    success: PreviewActionResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Wait for preview page condition"),
);

export const PreviewRecordingStartTool = safeBrowserTool(
  Tool.make("preview_recording_start", {
    description:
      "Start recording the collaborative browser tab selected by tabId, or this agent session's current tab when omitted.",
    parameters: PreviewAutomationTabTargetInput,
    success: Schema.Struct({ ...PreviewAutomationRecordingStatus.fields, ...presentationFields }),
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Start browser recording"),
);

export const PreviewRecordingStopTool = safeBrowserTool(
  Tool.make("preview_recording_stop", {
    description:
      "Stop recording the collaborative browser tab selected by tabId, or this agent session's current tab when omitted, and transfer the compressed recording once (up to 50 MiB) to an evidence file readable in this agent's environment. Returns its environment-local path after transfer succeeds.",
    parameters: PreviewAutomationTabTargetInput,
    success: Schema.Struct({ ...PreviewAutomationRecordingArtifact.fields, ...presentationFields }),
    failure: PreviewAutomationError,
    dependencies: [...dependencies, FileSystem.FileSystem, ServerConfig.ServerConfig],
  }).annotate(Tool.Title, "Stop browser recording"),
);

const ApprovedQuickActionInput = Schema.Struct({
  tabId: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(128),
  ).annotate({
    description: "Exact tab ID from the user's approval.",
  }),
  actionId: Schema.String.check(Schema.isUUID()).annotate({
    description: "Saved project action ID from the user's approval.",
  }),
  approvalId: Schema.String.check(Schema.isUUID()).annotate({
    description: "One-use approval ID issued to the user for this thread and tab.",
  }),
});
type QuickActionInput =
  | typeof BrowserQuickActionRequestInput.Type
  | typeof ApprovedQuickActionInput.Type;

// MCP requires an object schema at the root, so express the two shapes as a refinement.
const QuickActionParameters = Schema.Struct({
  actionName: Schema.optionalKey(BrowserQuickActionRequestInput.fields.actionName),
  tabId: Schema.optionalKey(ApprovedQuickActionInput.fields.tabId),
  actionId: Schema.optionalKey(ApprovedQuickActionInput.fields.actionId),
  approvalId: Schema.optionalKey(ApprovedQuickActionInput.fields.approvalId),
}).pipe(
  Schema.refine(
    (input): input is QuickActionInput =>
      "actionName" in input
        ? !("tabId" in input || "actionId" in input || "approvalId" in input)
        : "tabId" in input && "actionId" in input && "approvalId" in input,
    {
      expected: "actionName alone or all three approval IDs (tabId, actionId, approvalId)",
      parseOptions: { onExcessProperty: "error" },
      toJsonSchema: () => ({
        oneOf: [
          { required: ["actionName"], maxProperties: 1 },
          { required: ["tabId", "actionId", "approvalId"], maxProperties: 3 },
        ],
      }),
    },
  ),
);

const QuickActionToolResult = Schema.Struct({
  status: Schema.Union([
    BrowserQuickActionResult.fields.status,
    BrowserQuickActionApprovalRequired.fields.status,
  ]),
  completedSteps: Schema.optionalKey(BrowserQuickActionResult.fields.completedSteps),
  message: Schema.optionalKey(BrowserQuickActionResult.fields.message),
  fileReceipt: BrowserQuickActionResult.fields.fileReceipt,
  fileResult: BrowserQuickActionResult.fields.fileResult,
  resumeRequest: BrowserQuickActionResult.fields.resumeRequest,
  actionId: Schema.optionalKey(BrowserQuickActionApprovalRequired.fields.actionId),
}).pipe(
  Schema.refine(
    (result): result is BrowserQuickActionResult | BrowserQuickActionApprovalRequired =>
      result.status === "approval_required"
        ? "actionId" in result &&
          !(
            "completedSteps" in result ||
            "message" in result ||
            "fileReceipt" in result ||
            "fileResult" in result ||
            "resumeRequest" in result
          )
        : "completedSteps" in result &&
          "message" in result &&
          !("actionId" in result) &&
          (result.status === "paused" || !("resumeRequest" in result)) &&
          (result.status === "pass" || !("fileReceipt" in result || "fileResult" in result)) &&
          (!result.fileResult || result.fileReceipt?.filename === result.fileResult.filename),
    {
      expected: "a Quick Action approval request or a replay completion receipt",
      toJsonSchema: () => ({
        oneOf: [
          {
            required: ["actionId"],
            properties: { status: { const: "approval_required" } },
            maxProperties: 2,
          },
          {
            required: ["completedSteps", "message"],
            properties: { status: { const: "pass" } },
            maxProperties: 5,
          },
          {
            required: ["completedSteps", "message"],
            properties: { status: { const: "paused" } },
            maxProperties: 4,
          },
          {
            required: ["completedSteps", "message"],
            properties: { status: { enum: ["interrupted", "fail"] } },
            maxProperties: 3,
          },
        ],
      }),
    },
  ),
);

const PreviewRunQuickActionTool = browserTool(
  Tool.make("preview_run_quick_action", {
    description:
      "Pass actionName alone to request approval for a saved Browser Quick Action in this thread's project. The user chooses the tab, profile and inputs. To run the action, pass only tabId, actionId and approvalId from the user's one-use approval. On a pause, ask the user to choose Repair Quick Action in this thread.",
    parameters: QuickActionParameters,
    success: QuickActionToolResult,
    failure: PreviewAutomationError,
    dependencies,
  }).annotate(Tool.Title, "Run approved browser Quick Action"),
);

export const PreviewToolkit = Toolkit.make(
  PreviewStatusTool,
  PreviewOpenTool,
  PreviewNavigateTool,
  PreviewResizeTool,
  PreviewSetAppearanceTool,
  PreviewSnapshotTool,
  PreviewActTool,
  PreviewEvaluateTool,
  PreviewWaitForTool,
  PreviewRecordingStartTool,
  PreviewRecordingStopTool,
  PreviewRunQuickActionTool,
);

export const PreviewStandardToolkit = Toolkit.make(
  PreviewStatusTool,
  PreviewOpenTool,
  PreviewNavigateTool,
  PreviewResizeTool,
  PreviewSetAppearanceTool,
  PreviewActTool,
  PreviewEvaluateTool,
  PreviewWaitForTool,
  PreviewRecordingStartTool,
  PreviewRecordingStopTool,
  PreviewRunQuickActionTool,
);

export const PreviewSnapshotToolkit = Toolkit.make(PreviewSnapshotTool);
