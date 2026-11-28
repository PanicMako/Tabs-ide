import { NativeComputerCapabilities, OrchestratorMcpFailure } from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as ComputerUse from "../../../computerUse/ComputerUseService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Settings.ServerSettingsService,
    ComputerUse.ComputerUse,
  ],
};

const app = Schema.String.annotate({
  description: "Exact window selector returned by computer_list_apps for this thread.",
});
const elementIndex = Schema.Number.annotate({
  description: "Element index from the latest computer_snapshot or action result.",
});
const x = Schema.Number.annotate({
  description: "Window-local x in the units of the latest snapshot (use with y).",
});
const y = Schema.Number.annotate({
  description: "Window-local y in the units of the latest snapshot (use with x).",
});
const foreground = Schema.Boolean.annotate({
  description:
    "Use the real pointer or keyboard in the already-frontmost attached window. Requires the user’s physical-input grant. Accessibility actions are preferred.",
});

const observationId = Schema.String.annotate({
  description: "Observation ID from the latest snapshot, wait, or action for this window.",
});

/** What every observing or acting tool returns: what happened, then the (possibly diffed) tree. */
const ComputerResult = Schema.Struct({
  action: Schema.optionalKey(Schema.String),
  delivery: Schema.optionalKey(Schema.Literals(["background", "foreground"])),
  verification: Schema.optionalKey(Schema.String),
  tree: Schema.optionalKey(Schema.String),
  observationId: Schema.optionalKey(Schema.String),
  handoff: Schema.optionalKey(Schema.String),
  userDemonstration: Schema.optionalKey(
    Schema.String.annotate({ description: "The user’s description of the last handoff step." }),
  ),
  treeIsDiff: Schema.Boolean,
  elementCount: Schema.optionalKey(Schema.Number),
  focusedElementIndex: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

const PermissionsTool = Tool.make("computer_permissions", {
  ...shared,
  description:
    "Report whether desktop control is switched on in Tabs (Settings > Labs > Computer use), and the native capabilities available in the current desktop session. Call this first if any computer_* tool fails.",
  success: Schema.Struct({
    enabled: Schema.Boolean,
    platformSupported: Schema.Boolean,
    runtimeAvailable: Schema.Boolean,
    accessibility: Schema.Boolean,
    screenRecording: Schema.Literals(["granted", "denied", "unknown"]),
    guidance: Schema.String,
    capabilities: Schema.optionalKey(NativeComputerCapabilities),
  }),
})
  .annotate(Tool.Title, "Check computer-use permissions")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const ListAppsTool = Tool.make("computer_list_apps", {
  ...shared,
  description:
    "List the native window attached by the user in this thread and its control state. Pass its window selector as `app` to the other computer_* tools.",
  success: ComputerResult,
})
  .annotate(Tool.Title, "List desktop apps")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const FocusAppTool = Tool.make("computer_focus_app", {
  ...shared,
  description:
    "Check the focus policy for the attached window. The user brings the window to the front when physical input is needed.",
  parameters: Schema.Struct({ app }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Focus desktop app")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const SnapshotTool = Tool.make("computer_snapshot", {
  ...shared,
  description:
    'Read an app window as an accessibility tree. Lines are `<index> <Role> "label" value=... (disabled|focused|selected|secure)`, indented by depth; indexes drive the other tools. Password fields show (secure) and never their value. Large windows are capped: pass rootElementIndex to read one subtree, or maxNodes to raise the cap. Use the returned observationId for actions and subtree reads.',
  parameters: Schema.Struct({
    app,
    observationId: Schema.optionalKey(observationId),
    rootElementIndex: Schema.optionalKey(elementIndex),
    query: Schema.optionalKey(
      Schema.String.annotate({
        description:
          "Return only elements whose line contains this text (case-insensitive), with their ancestors. Indexes match the full tree. A cheap way to find one control in a large window.",
      }),
    ),
    maxNodes: Schema.optionalKey(
      Schema.Number.annotate({ description: "Cap on elements read (20-1500, default 400)." }),
    ),
  }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Snapshot desktop app")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const ClickTool = Tool.make("computer_click", {
  ...shared,
  description:
    "Click an element by elementIndex (preferred: uses the accessibility press action, in the background) or at window-local x,y with granted physical input in the frontmost window. Returns what was done and the changed tree.",
  parameters: Schema.Struct({
    app,
    observationId,
    elementIndex: Schema.optionalKey(elementIndex),
    x: Schema.optionalKey(x),
    y: Schema.optionalKey(y),
    doubleClick: Schema.optionalKey(Schema.Boolean),
    foreground: Schema.optionalKey(foreground),
  }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Click in desktop app")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const TypeTool = Tool.make("computer_type", {
  ...shared,
  description:
    "Insert text into a text field: the one given by elementIndex, or the field that currently has focus. Refuses password and other secret fields; the user must enter those. Check the returned tree to confirm the text landed.",
  parameters: Schema.Struct({
    app,
    observationId,
    text: Schema.String,
    elementIndex: Schema.optionalKey(elementIndex),
  }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Type in desktop app")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const KeyTool = Tool.make("computer_key", {
  ...shared,
  description:
    "Press one key or chord in an app, such as Return, Escape, Tab, Down, or Cmd+Shift+P. Requires granted physical input and the attached window already in front. Quit, log out, lock, force quit and empty-Trash chords are refused, as are text-producing keys while a password field has focus.",
  parameters: Schema.Struct({
    app,
    observationId,
    key: Schema.String,
    foreground: Schema.optionalKey(foreground),
  }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Press key in desktop app")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const ScrollTool = Tool.make("computer_scroll", {
  ...shared,
  description:
    "Scroll at an element's center (elementIndex) or at window-local x,y. Physical scrolling requires the window in front and a physical-input grant. amount is lines, 1-50, default 5.",
  parameters: Schema.Struct({
    app,
    observationId,
    direction: Schema.Literals(["up", "down", "left", "right"]),
    amount: Schema.optionalKey(Schema.Number),
    elementIndex: Schema.optionalKey(elementIndex),
    x: Schema.optionalKey(x),
    y: Schema.optionalKey(y),
    foreground: Schema.optionalKey(foreground),
  }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Scroll in desktop app")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const RightClickTool = Tool.make("computer_right_click", {
  ...shared,
  description:
    "Open an element's context menu: requires granted physical input and the attached window in front. Select the element or pass window-local x,y, then observe the menu.",
  parameters: Schema.Struct({
    app,
    observationId,
    elementIndex: Schema.optionalKey(elementIndex),
    x: Schema.optionalKey(x),
    y: Schema.optionalKey(y),
    foreground: Schema.optionalKey(foreground),
  }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Right-click in desktop app")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const DragTool = Tool.make("computer_drag", {
  ...shared,
  description:
    "Drag from one element or window-local point to another with synthetic mouse events. Requires the attached window in front and a physical-input grant.",
  parameters: Schema.Struct({
    app,
    observationId,
    fromElementIndex: Schema.optionalKey(elementIndex),
    fromX: Schema.optionalKey(x),
    fromY: Schema.optionalKey(y),
    toElementIndex: Schema.optionalKey(elementIndex),
    toX: Schema.optionalKey(x),
    toY: Schema.optionalKey(y),
    foreground: Schema.optionalKey(foreground),
  }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Drag in desktop app")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const SetValueTool = Tool.make("computer_set_value", {
  ...shared,
  description:
    "Replace a field's whole value through accessibility, without raising the app, then read it back. Prefer this to computer_type for editable fields. Refuses password and other secret fields. The result says whether the new value was verified.",
  parameters: Schema.Struct({ app, observationId, elementIndex, value: Schema.String }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Set value in desktop app")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const SecondaryActionTool = Tool.make("computer_secondary_action", {
  ...shared,
  description:
    "Perform a named accessibility action on an element, such as AXShowMenu, AXIncrement or AXRaise on macOS, or invoke, toggle, expand, collapse, select on Windows. If the element lacks the action, the error lists the actions it has.",
  parameters: Schema.Struct({ app, observationId, elementIndex, action: Schema.String }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Run accessibility action")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const WaitTool = Tool.make("computer_wait", {
  ...shared,
  description:
    "Wait until an app shows something instead of sleeping: an element line containing `text`, an element containing `enabled` that is not disabled, or a window title containing `windowTitle`. Returns the matching elements with fresh indexes, or fails with wait_timeout. Read-only; the app may not exist yet.",
  parameters: Schema.Struct({
    app,
    text: Schema.optionalKey(Schema.String),
    enabled: Schema.optionalKey(Schema.String),
    windowTitle: Schema.optionalKey(Schema.String),
    timeoutMs: Schema.optionalKey(
      Schema.Number.annotate({ description: "Up to 20000, default 8000." }),
    ),
  }),
  success: ComputerResult,
})
  .annotate(Tool.Title, "Wait for desktop app")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const ScreenshotTool = Tool.make("computer_screenshot", {
  ...shared,
  description:
    "Capture an app window to a PNG file and return its path (read the file to see it). Uses the platform’s window-capture capability. Prefer computer_snapshot for structure. Protected fields require the user to finish the step first.",
  parameters: Schema.Struct({ app, observationId }),
  success: Schema.Struct({
    path: Schema.String,
    width: Schema.NullOr(Schema.Number),
    height: Schema.NullOr(Schema.Number),
    note: Schema.String,
  }),
})
  .annotate(Tool.Title, "Screenshot desktop app")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

export const ComputerToolkit = Toolkit.make(
  PermissionsTool,
  ListAppsTool,
  FocusAppTool,
  SnapshotTool,
  ClickTool,
  RightClickTool,
  DragTool,
  SetValueTool,
  SecondaryActionTool,
  WaitTool,
  TypeTool,
  KeyTool,
  ScrollTool,
  ScreenshotTool,
);
