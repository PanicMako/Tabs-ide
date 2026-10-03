/**
 * Shared logic for the native Code-tab chrome (activity rail / header / status
 * bar) that surrounds the embedded Code-OSS BrowserView, plus the loopback
 * control-channel protocol used to drive the embedded workbench.
 *
 * This module is the single source of truth consumed by:
 *  - the web UI (`apps/web/.../components/code/*`) — renders the chrome,
 *  - the Electron main process (`apps/desktop/.../codeControlChannel.ts`) — the
 *    broker that validates and forwards command requests, and
 *  - (by reference) the bundled integration extension
 *    (`apps/desktop/resources/code-oss-extensions/tabs-workbench-integration/
 *    extension.js`), which keeps a hardcoded mirror of the allowlist because it
 *    ships as plain JS with no bundler. Keep that mirror in sync with
 *    `CODE_CHROME_COMMAND_ALLOWLIST` below.
 *
 * Kept free of React/DOM/node so it is trivially unit-testable and importable
 * from every layer.
 */

import type {
  CodeActivityViewId,
  CodeChromeState,
  CodeCursorPosition,
  CodeTestItem,
  CustomActivityBarItem,
} from "@tabs/contracts";

export type {
  CodeActivityViewId,
  CodeChromeState,
  CodeCursorPosition,
  CodeTestItem,
  CustomActivityBarItem,
};

/** lucide-react icon names (resolved to components in the web layer). */
export type CodeActivityIcon = "files" | "search" | "git-branch" | "bug" | "puzzle";

/** A single activity-rail entry, mirroring VS Code's default activity bar order. */
export interface CodeActivityItem {
  readonly id: CodeActivityViewId;
  readonly label: string;
  /** VS Code command that reveals this view. */
  readonly commandId: string;
  readonly icon: CodeActivityIcon;
}

export const CODE_ACTIVITY_ITEMS: readonly CodeActivityItem[] = [
  { id: "explorer", label: "Explorer", commandId: "workbench.view.explorer", icon: "files" },
  { id: "search", label: "Search", commandId: "workbench.view.search", icon: "search" },
  { id: "scm", label: "Source Control", commandId: "workbench.view.scm", icon: "git-branch" },
  { id: "debug", label: "Run and Debug", commandId: "workbench.view.debug", icon: "bug" },
  {
    id: "extensions",
    label: "Extensions",
    commandId: "workbench.view.extensions",
    icon: "puzzle",
  },
] as const;

/** Command ids used by the header / status bar / panel toggles. */
export const CODE_CHROME_COMMANDS = {
  commandPalette: "workbench.action.showCommands",
  toggleSidebar: "workbench.action.toggleSidebarVisibility",
  togglePanel: "workbench.action.togglePanel",
  toggleTerminal: "workbench.action.terminal.toggleTerminal",
  /** Toggle the secondary (right) side bar — the third layout-control icon. */
  toggleAuxiliaryBar: "workbench.action.toggleAuxiliaryBar",
  /** Close the secondary side bar. */
  closeAuxiliaryBar: "workbench.action.closeAuxiliaryBar",
  /** Maximise the bottom panel to fill the editor area (and restore). */
  toggleMaximizedPanel: "workbench.action.toggleMaximizedPanel",
  /** Customize layout menu / quick pick. */
  customizeLayout: "workbench.action.customizeLayout",
  quickOpen: "workbench.action.quickOpen",
  settings: "workbench.action.openSettings",
  runTask: "workbench.action.tasks.runTask",
} as const;

/**
 * Commands driven by the native status bar's clickable items (language /
 * indentation / end-of-line pickers). Kept separate from CODE_CHROME_COMMANDS so
 * the header/rail surface stays focused, but folded into the allowlist below.
 */
export const CODE_STATUS_BAR_COMMANDS = {
  changeLanguageMode: "workbench.action.editor.changeLanguageMode",
  changeIndentation: "editor.action.indentationToSpaces",
  changeEol: "workbench.action.editor.changeEOL",
  changeEncoding: "workbench.action.editor.changeEncoding",
} as const;

// ----------------------------------------------------------------------------
// Application menu bar (the native ≡ menu in the activity rail). VS Code's own
// menu bar used to live atop its activity bar, which the Tabs embed hides — so
// the rail hosts a native menu that runs these workbench commands through the
// control channel. This is the single source of truth: the allowlist below is
// derived from it, and the extension mirrors the derived ids (see extension.js).
// ----------------------------------------------------------------------------

/** A single command entry in a menu. `shortcut` is a macOS display hint only. */
export interface CodeMenuItem {
  readonly label: string;
  readonly commandId: string;
  readonly shortcut?: string;
}

/** A run of items rendered together; groups are visually separated. */
export interface CodeMenuGroup {
  readonly items: readonly CodeMenuItem[];
}

/** A top-level menu (File, Edit, …) and its grouped items. */
export interface CodeMenu {
  readonly id: string;
  readonly label: string;
  readonly groups: readonly CodeMenuGroup[];
}

export const CODE_MENU_BAR: readonly CodeMenu[] = [
  {
    id: "file",
    label: "File",
    groups: [
      {
        items: [
          {
            label: "New Text File",
            commandId: "workbench.action.files.newUntitledFile",
            shortcut: "⌘N",
          },
          { label: "New File…", commandId: "welcome.showNewFileEntries", shortcut: "⌃⌥⌘N" },
          { label: "New Window", commandId: "workbench.action.newWindow", shortcut: "⇧⌘N" },
        ],
      },
      {
        items: [
          {
            label: "Open File…",
            commandId: "workbench.action.files.openFileFolder",
            shortcut: "⌘O",
          },
          { label: "Open Folder…", commandId: "workbench.action.files.openFolder" },
          { label: "Open Workspace from File…", commandId: "workbench.action.openWorkspace" },
          { label: "Open Recent", commandId: "workbench.action.openRecent" },
        ],
      },
      {
        items: [
          { label: "Add Folder to Workspace…", commandId: "workbench.action.addRootFolder" },
          { label: "Save Workspace As…", commandId: "workbench.action.saveWorkspaceAs" },
          {
            label: "Duplicate Workspace",
            commandId: "workbench.action.duplicateWorkspaceInNewWindow",
          },
        ],
      },
      {
        items: [
          { label: "Save", commandId: "workbench.action.files.save", shortcut: "⌘S" },
          { label: "Save As…", commandId: "workbench.action.files.saveAs", shortcut: "⇧⌘S" },
          { label: "Save All", commandId: "workbench.action.files.saveAll", shortcut: "⌥⌘S" },
        ],
      },
      {
        items: [
          // Rendered as a checkbox bound to chromeState.autoSaveEnabled (see rail).
          { label: "Auto Save", commandId: "workbench.action.toggleAutoSave" },
          { label: "Preferences: Settings", commandId: "workbench.action.openSettings" },
        ],
      },
      {
        items: [
          { label: "Revert File", commandId: "workbench.action.files.revert" },
          {
            label: "Close Editor",
            commandId: "workbench.action.closeActiveEditor",
            shortcut: "⌘W",
          },
          { label: "Close Folder", commandId: "workbench.action.closeFolder", shortcut: "⌘K F" },
        ],
      },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    groups: [
      {
        items: [
          { label: "Undo", commandId: "undo", shortcut: "⌘Z" },
          { label: "Redo", commandId: "redo", shortcut: "⇧⌘Z" },
        ],
      },
      {
        items: [
          { label: "Cut", commandId: "editor.action.clipboardCutAction", shortcut: "⌘X" },
          { label: "Copy", commandId: "editor.action.clipboardCopyAction", shortcut: "⌘C" },
          { label: "Paste", commandId: "editor.action.clipboardPasteAction", shortcut: "⌘V" },
        ],
      },
      {
        items: [
          { label: "Find", commandId: "actions.find", shortcut: "⌘F" },
          { label: "Replace", commandId: "editor.action.startFindReplaceAction", shortcut: "⌥⌘F" },
        ],
      },
      {
        items: [
          { label: "Toggle Line Comment", commandId: "editor.action.commentLine", shortcut: "⌘/" },
          {
            label: "Toggle Block Comment",
            commandId: "editor.action.blockComment",
            shortcut: "⇧⌥A",
          },
        ],
      },
    ],
  },
  {
    id: "selection",
    label: "Selection",
    groups: [
      {
        items: [
          { label: "Select All", commandId: "editor.action.selectAll", shortcut: "⌘A" },
          {
            label: "Expand Selection",
            commandId: "editor.action.smartSelect.expand",
            shortcut: "⌃⇧⌘→",
          },
          {
            label: "Shrink Selection",
            commandId: "editor.action.smartSelect.shrink",
            shortcut: "⌃⇧⌘←",
          },
        ],
      },
      {
        items: [
          { label: "Copy Line Up", commandId: "editor.action.copyLinesUpAction", shortcut: "⇧⌥↑" },
          {
            label: "Copy Line Down",
            commandId: "editor.action.copyLinesDownAction",
            shortcut: "⇧⌥↓",
          },
          { label: "Move Line Up", commandId: "editor.action.moveLinesUpAction", shortcut: "⌥↑" },
          {
            label: "Move Line Down",
            commandId: "editor.action.moveLinesDownAction",
            shortcut: "⌥↓",
          },
        ],
      },
      {
        items: [
          {
            label: "Add Cursor Above",
            commandId: "editor.action.insertCursorAbove",
            shortcut: "⌥⌘↑",
          },
          {
            label: "Add Cursor Below",
            commandId: "editor.action.insertCursorBelow",
            shortcut: "⌥⌘↓",
          },
        ],
      },
    ],
  },
  {
    id: "view",
    label: "View",
    groups: [
      {
        items: [
          {
            label: "Command Palette…",
            commandId: "workbench.action.showCommands",
            shortcut: "⇧⌘P",
          },
          { label: "Open View…", commandId: "workbench.action.openView" },
        ],
      },
      {
        items: [
          { label: "Explorer", commandId: "workbench.view.explorer" },
          { label: "Search", commandId: "workbench.view.search" },
          { label: "Source Control", commandId: "workbench.view.scm" },
          { label: "Run", commandId: "workbench.view.debug" },
          { label: "Extensions", commandId: "workbench.view.extensions" },
        ],
      },
      {
        items: [
          { label: "Problems", commandId: "workbench.actions.view.problems", shortcut: "⇧⌘M" },
          { label: "Output", commandId: "workbench.action.output.toggleOutput", shortcut: "⇧⌘U" },
          {
            label: "Terminal",
            commandId: "workbench.action.terminal.toggleTerminal",
            shortcut: "⌃`",
          },
        ],
      },
      {
        items: [
          { label: "Toggle Word Wrap", commandId: "editor.action.toggleWordWrap", shortcut: "⌥Z" },
        ],
      },
    ],
  },
  {
    id: "go",
    label: "Go",
    groups: [
      {
        items: [
          { label: "Back", commandId: "workbench.action.navigateBack", shortcut: "⌃-" },
          { label: "Forward", commandId: "workbench.action.navigateForward", shortcut: "⌃⇧-" },
        ],
      },
      {
        items: [
          { label: "Go to File…", commandId: "workbench.action.quickOpen", shortcut: "⌘P" },
          {
            label: "Go to Symbol in Workspace…",
            commandId: "workbench.action.showAllSymbols",
            shortcut: "⌘T",
          },
          {
            label: "Go to Symbol in Editor…",
            commandId: "workbench.action.gotoSymbol",
            shortcut: "⇧⌘O",
          },
          {
            label: "Go to Definition",
            commandId: "editor.action.revealDefinition",
            shortcut: "F12",
          },
          { label: "Go to Line/Column…", commandId: "workbench.action.gotoLine", shortcut: "⌃G" },
        ],
      },
    ],
  },
  {
    id: "run",
    label: "Run",
    groups: [
      {
        items: [
          { label: "Start Debugging", commandId: "workbench.action.debug.start", shortcut: "F5" },
          {
            label: "Run Without Debugging",
            commandId: "workbench.action.debug.run",
            shortcut: "⌃F5",
          },
          { label: "Stop Debugging", commandId: "workbench.action.debug.stop", shortcut: "⇧F5" },
          {
            label: "Restart Debugging",
            commandId: "workbench.action.debug.restart",
            shortcut: "⇧⌘F5",
          },
        ],
      },
      {
        items: [
          { label: "Open Configurations", commandId: "workbench.action.debug.configure" },
          { label: "Add Configuration…", commandId: "debug.addConfiguration" },
          {
            label: "Toggle Breakpoint",
            commandId: "editor.debug.action.toggleBreakpoint",
            shortcut: "F9",
          },
        ],
      },
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    groups: [
      {
        items: [
          { label: "New Terminal", commandId: "workbench.action.terminal.new", shortcut: "⌃⇧`" },
          {
            label: "Split Terminal",
            commandId: "workbench.action.terminal.split",
            shortcut: "⌘\\",
          },
        ],
      },
      {
        items: [
          { label: "Run Task…", commandId: "workbench.action.tasks.runTask" },
          { label: "Run Build Task…", commandId: "workbench.action.tasks.build", shortcut: "⇧⌘B" },
          { label: "Configure Tasks…", commandId: "workbench.action.tasks.configureTaskRunner" },
        ],
      },
    ],
  },
  {
    id: "help",
    label: "Help",
    groups: [
      {
        items: [
          { label: "Welcome", commandId: "workbench.action.openWalkthrough" },
          { label: "Show All Commands", commandId: "workbench.action.showCommands" },
          { label: "Documentation", commandId: "workbench.action.openDocumentationUrl" },
        ],
      },
      {
        items: [
          {
            label: "Toggle Developer Tools",
            commandId: "workbench.action.toggleDevTools",
            shortcut: "⌥⌘I",
          },
          { label: "Open Process Explorer", commandId: "workbench.action.openProcessExplorer" },
        ],
      },
      { items: [{ label: "About", commandId: "workbench.action.showAboutDialog" }] },
    ],
  },
] as const;

/** Flattened, de-duplicated list of every command id the menu bar can run. */
export const CODE_MENU_COMMAND_IDS: readonly string[] = [
  ...new Set(
    CODE_MENU_BAR.flatMap((menu) =>
      menu.groups.flatMap((group) => group.items.map((item) => item.commandId)),
    ),
  ),
];

/**
 * Every command id the chrome is allowed to request. Both the broker (Electron
 * main) and the extension validate against this before executing, so a
 * compromised renderer can only trigger this fixed, side-effect-light set of
 * navigation/layout/editor commands — never arbitrary VS Code commands.
 */
export const CODE_CHROME_COMMAND_ALLOWLIST: readonly string[] = [
  ...new Set([
    ...CODE_ACTIVITY_ITEMS.map((item) => item.commandId),
    ...Object.values(CODE_CHROME_COMMANDS),
    ...Object.values(CODE_STATUS_BAR_COMMANDS),
    ...CODE_MENU_COMMAND_IDS,
  ]),
];

export function isAllowedChromeCommand(commandId: string): boolean {
  return CODE_CHROME_COMMAND_ALLOWLIST.includes(commandId);
}

export const DEFAULT_CODE_CHROME_STATE: CodeChromeState = {
  activeViewId: "explorer",
  panelOpen: false,
  panelMaximized: false,
  dirtyCount: 0,
  branch: null,
  languageId: null,
  cursor: null,
};

// ----------------------------------------------------------------------------
// Control-channel protocol (loopback WebSocket between Electron main and the
// integration extension running in the Code-OSS extension host).
// ----------------------------------------------------------------------------

/** Messages sent from the broker (Electron main) → extension. */
export type CodeControlServerMessage =
  | { type: "runCommand"; commandId: string }
  | {
      type: "openFile";
      filePath: string;
      preview?: boolean | undefined;
      pinned?: boolean | undefined;
      preserveFocus?: boolean | undefined;
      viewColumn?: number | undefined;
      lineNumber?: number | undefined;
    }
  | { type: "setTheme"; theme: string };

/**
 * Messages sent from the extension → broker (Electron main). Both carry the
 * `projectId` (from the TABS_PROJECT_ID env the desktop sets per session) so
 * the broker can route commands/state to the right editor when several projects
 * share the one control channel. `projectId` may be empty if the env was unset.
 * `hello` additionally carries the per-launch auth `token`: the channel is a
 * raw loopback TCP socket (newline-delimited JSON), so authentication happens
 * in-band as the first message rather than in a URL.
 */
export type CodeControlClientMessage =
  | { type: "hello"; projectId: string; token: string }
  | { type: "chromeState"; projectId: string; state: CodeChromeState }
  | { type: "openTabsProjectTab"; projectId: string };

/**
 * Parse/validate an inbound control message from a JSON string. Returns null on
 * any malformed or unknown payload so callers can safely ignore junk without
 * throwing. Used on both ends of the loopback channel.
 */
export function parseCodeControlClientMessage(raw: string): CodeControlClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const projectId = typeof record.projectId === "string" ? record.projectId : "";
  if (record.type === "hello") {
    const token = typeof record.token === "string" ? record.token : "";
    return { type: "hello", projectId, token };
  }
  if (record.type === "chromeState") {
    return { type: "chromeState", projectId, state: coerceChromeState(record.state) };
  }
  if (record.type === "openTabsProjectTab") {
    return { type: "openTabsProjectTab", projectId };
  }
  return null;
}

export function parseCodeControlServerMessage(raw: string): CodeControlServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type === "runCommand" && typeof record.commandId === "string") {
    return { type: "runCommand", commandId: record.commandId };
  }
  if (record.type === "openFile" && typeof record.filePath === "string") {
    const msg: CodeControlServerMessage & { type: "openFile" } = {
      type: "openFile",
      filePath: record.filePath,
    };
    if (typeof record.preview === "boolean") msg.preview = record.preview;
    if (typeof record.pinned === "boolean") msg.pinned = record.pinned;
    if (typeof record.preserveFocus === "boolean") msg.preserveFocus = record.preserveFocus;
    if (typeof record.viewColumn === "number") msg.viewColumn = record.viewColumn;
    if (typeof record.lineNumber === "number") msg.lineNumber = record.lineNumber;
    return msg;
  }
  if (record.type === "setTheme" && typeof record.theme === "string") {
    return { type: "setTheme", theme: record.theme };
  }
  return null;
}

/** Coerce an untrusted value into a CodeChromeState, filling defaults. */
export const BUILTIN_ACTIVITY_CONTAINERS = new Set<string>([
  "workbench.view.explorer",
  "workbench.view.search",
  "workbench.view.scm",
  "workbench.view.debug",
  "workbench.view.extensions",
  "workbench.panel.chat",
  "workbench.panel.chat.view.copilot",
  "explorer",
  "search",
  "scm",
  "debug",
  "extensions",
]);

export function coerceChromeState(value: unknown): CodeChromeState {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_CODE_CHROME_STATE };
  const record = value as Record<string, unknown>;

  const activityBarItems: CustomActivityBarItem[] = [];
  if (Array.isArray(record.activityBarItems)) {
    for (const item of record.activityBarItems) {
      if (item && typeof item === "object") {
        const itemRecord = item as Record<string, unknown>;
        if (
          typeof itemRecord.id === "string" &&
          !BUILTIN_ACTIVITY_CONTAINERS.has(itemRecord.id) &&
          typeof itemRecord.label === "string" &&
          typeof itemRecord.commandId === "string"
        ) {
          const iconRecord = itemRecord.icon as Record<string, unknown> | undefined;
          let icon: CustomActivityBarItem["icon"] | undefined;
          if (iconRecord && typeof iconRecord === "object") {
            const type = iconRecord.type;
            if (type === "themeIcon" || type === "uri" || type === "themeUri") {
              icon = { type };
              if (typeof iconRecord.value === "string") icon.value = iconRecord.value;
              if (typeof iconRecord.light === "string") icon.light = iconRecord.light;
              if (typeof iconRecord.dark === "string") icon.dark = iconRecord.dark;
            }
          }
          if (icon) {
            const entry: CustomActivityBarItem = {
              id: itemRecord.id,
              label: itemRecord.label,
              commandId: itemRecord.commandId,
              icon,
            };
            if (itemRecord.location === "sidebar" || itemRecord.location === "auxiliaryBar") {
              entry.location = itemRecord.location;
            }
            if (typeof itemRecord.order === "number") entry.order = itemRecord.order;
            activityBarItems.push(entry);
          }
        }
      }
    }
  }

  let activeViewId =
    typeof record.activeViewId === "string" && record.activeViewId.length > 0
      ? record.activeViewId
      : null;

  // Some AI extensions contribute both a primary view and a sessions-list
  // container with the same visible provider name. Tabs presents providers as
  // one activity entry, preferring whichever of those containers is active.
  const activityItemsByLabel = new Map<string, CustomActivityBarItem>();
  for (const item of activityBarItems) {
    const labelKey = item.label.trim().toLocaleLowerCase();
    const current = activityItemsByLabel.get(labelKey);
    if (!current || item.id === activeViewId) {
      activityItemsByLabel.set(labelKey, item);
    }
  }
  activityBarItems.splice(0, activityBarItems.length, ...activityItemsByLabel.values());

  if (activeViewId !== null) {
    const isBuiltIn = CODE_ACTIVITY_ITEMS.some((item) => item.id === activeViewId);
    const isCustom = activityBarItems.some((item) => item.id === activeViewId);
    if (!isBuiltIn && !isCustom) {
      activeViewId = null;
    }
  }

  const state: CodeChromeState = {
    activeViewId,
    panelOpen: record.panelOpen === true,
    panelMaximized: record.panelMaximized === true,
    dirtyCount:
      typeof record.dirtyCount === "number" && Number.isFinite(record.dirtyCount)
        ? Math.max(0, Math.floor(record.dirtyCount))
        : 0,
    branch: typeof record.branch === "string" && record.branch.length > 0 ? record.branch : null,
  };
  if (record.activityBarItems !== undefined) {
    state.activityBarItems = activityBarItems;
  }
  if (typeof record.autoSaveEnabled === "boolean") {
    state.autoSaveEnabled = record.autoSaveEnabled;
  }
  state.languageId =
    typeof record.languageId === "string" && record.languageId.length > 0
      ? record.languageId
      : null;
  state.cursor = coerceCursorPosition(record.cursor);

  // Coerce openTabs: only preserve if it's an actual array of objects with a filePath string
  if (Array.isArray(record.openTabs)) {
    state.openTabs = record.openTabs
      .filter(
        (t): t is Record<string, unknown> =>
          t !== null &&
          typeof t === "object" &&
          typeof (t as Record<string, unknown>).filePath === "string",
      )
      .map((t) => ({
        filePath: t.filePath as string,
        ...(typeof t.viewColumn === "number" ? { viewColumn: t.viewColumn as number } : {}),
        ...(typeof t.active === "boolean" ? { active: t.active as boolean } : {}),
        ...(typeof t.pinned === "boolean" ? { pinned: t.pinned as boolean } : {}),
        ...(typeof t.preview === "boolean" ? { preview: t.preview as boolean } : {}),
      }));
  }

  const coerceTestItem = (value: unknown): CodeTestItem | null => {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.label !== "string") return null;
    return {
      id: item.id,
      label: item.label,
      uri: typeof item.uri === "string" ? item.uri : null,
      line:
        typeof item.line === "number" && Number.isFinite(item.line)
          ? Math.max(1, Math.floor(item.line))
          : null,
      busy: item.busy === true,
      children: Array.isArray(item.children)
        ? item.children.flatMap((child) => {
            const coerced = coerceTestItem(child);
            return coerced ? [coerced] : [];
          })
        : [],
    };
  };
  if (Array.isArray(record.testItems)) {
    state.testItems = record.testItems.flatMap((item) => {
      const coerced = coerceTestItem(item);
      return coerced ? [coerced] : [];
    });
  }

  return state;
}

/** Coerce an untrusted value into a 1-based CodeCursorPosition, or null. */
function coerceCursorPosition(value: unknown): CodeCursorPosition | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const line = record.line;
  const col = record.col;
  if (
    typeof line === "number" &&
    Number.isFinite(line) &&
    typeof col === "number" &&
    Number.isFinite(col)
  ) {
    return { line: Math.max(1, Math.floor(line)), col: Math.max(1, Math.floor(col)) };
  }
  return null;
}

/**
 * Derive the basename shown in the header from an absolute file path. Returns an
 * empty string for nullish/empty input. Handles both POSIX and Windows
 * separators so it is correct regardless of the host platform.
 */
export function deriveActiveFileName(path: string | null | undefined): string {
  if (!path) return "";
  const trimmed = path.replace(/[\\/]+$/, "");
  const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return lastSep === -1 ? trimmed : trimmed.slice(lastSep + 1);
}
