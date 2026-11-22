import { OrchestratorMcpFailure } from "@tabs/contracts";
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
  description: "Bundle id or app name from computer_list_apps, or pid:<number>.",
});
const elementIndex = Schema.Number.annotate({
  description: "Element index from the latest computer_snapshot or action result.",
});
const x = Schema.Number.annotate({ description: "Window-local x in points (use with y)." });
const y = Schema.Number.annotate({ description: "Window-local y in points (use with x)." });
const foreground = Schema.Boolean.annotate({
  description:
    "Raise the app and use the real pointer or keyboard. Default is background delivery, which leaves the user's screen alone. Only set it when a background attempt had no effect and the user agrees.",
});

/** What every observing or acting tool returns: what happened, then the (possibly diffed) tree. */
const ComputerResult = Schema.Struct({
  action: Schema.optionalKey(Schema.String),
  delivery: Schema.optionalKey(Schema.Literals(["background", "foreground"])),
  verification: Schema.optionalKey(Schema.String),
  tree: Schema.optionalKey(Schema.String),
  treeIsDiff: Schema.Boolean,
  elementCount: Schema.optionalKey(Schema.Number),
  focusedElementIndex: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

const PermissionsTool = Tool.make("computer_permissions", {
  ...shared,
  description:
    "Report whether desktop control is switched on in Tabs (Settings > Labs > Computer use) and whether macOS Accessibility and Screen Recording are granted to Tabs. Call this first if any computer_* tool fails.",
  success: Schema.Struct({
    enabled: Schema.Boolean,
    platformSupported: Schema.Boolean,
    accessibility: Schema.Boolean,
    screenRecording: Schema.Literals(["granted", "denied", "unknown"]),
    guidance: Schema.String,
  }),
})
  .annotate(Tool.Title, "Check computer-use permissions")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const ListAppsTool = Tool.make("computer_list_apps", {
  ...shared,
  description:
    "List running desktop apps (name | bundle id | pid). Pass a bundle id as `app` to the other computer_* tools.",
  success: ComputerResult,
})
  .annotate(Tool.Title, "List desktop apps")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const FocusAppTool = Tool.make("computer_focus_app", {
  ...shared,
  description:
    "Bring a running app to the front. Only needed before keyboard or pointer actions; element clicks and field text work without it. This takes over the user's screen, so use it only when the task needs it.",
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
    'Read an app window as an accessibility tree. Lines are `<index> <Role> "label" value=... (disabled|focused|selected|secure)`, indented by depth; indexes drive the other tools. Password fields show (secure) and never their value. Large windows are capped: pass rootElementIndex to read one subtree, or maxNodes to raise the cap. Action tools return a diff against the previous snapshot (~ changed, - removed) to keep context small; call this again for a full tree.',
  parameters: Schema.Struct({
    app,
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
    "Click an element by elementIndex (preferred: uses the accessibility press action, in the background) or at window-local x,y (moves the real pointer and brings the app forward). Returns what was done and the changed tree.",
  parameters: Schema.Struct({
    app,
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
    "Press one key or chord in an app, such as Return, Escape, Tab, Down, or Cmd+Shift+P. Brings the app forward. Quit, log out, lock, force quit and empty-Trash chords are refused, as are text-producing keys while a password field has focus.",
  parameters: Schema.Struct({
    app,
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
    "Scroll at an element's center (elementIndex) or at window-local x,y. Moves the real pointer. amount is lines, 1-50, default 5.",
  parameters: Schema.Struct({
    app,
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
    "Open an element's context menu: uses the accessibility show-menu action when the element has one, else a synthetic right click at its center or at window-local x,y. Take a snapshot afterwards to read the menu.",
  parameters: Schema.Struct({
    app,
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
    "Drag from one element or window-local point to another with synthetic mouse events. Some apps (Chromium, Electron, games) ignore background drags; retry with foreground only if the user agrees.",
  parameters: Schema.Struct({
    app,
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
  parameters: Schema.Struct({ app, elementIndex, value: Schema.String }),
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
  parameters: Schema.Struct({ app, elementIndex, action: Schema.String }),
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
    "Capture an app window to a PNG file and return its path (read the file to see it). Needs Screen Recording permission. Prefer computer_snapshot for structure; use this for visual confirmation.",
  parameters: Schema.Struct({ app }),
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
