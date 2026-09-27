import { type Project, type Thread } from "./types";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import * as Schema from "effect/Schema";
import {
  BrowserDevicePreset,
  DEFAULT_PROJECT_TOOL_KIND,
  DEFAULT_PROJECT_TOOL_ORDER,
  ProjectBrowserSettings,
  ProjectCustomEmbedDefinition,
  ProjectServerPresetDefinition,
  ProjectServerProcessDefinition,
  ProjectToolDefinition as ProjectToolDefinitionSchema,
  ProjectWorkspaceSessionState,
  ProjectWorkspaceSettings,
  type BrowserDevicePreset as BrowserDevicePresetType,
  type ProjectToolDefinition,
  type ProjectWorkspaceSessionState as ProjectWorkspaceSessionStateType,
  type ProjectWorkspaceSettings as ProjectWorkspaceSettingsType,
} from "@tabs/contracts/settings";
import { ProjectId, ThreadId } from "@tabs/contracts";
import type { DesktopInstalledExtension } from "@tabs/contracts";
import { mergeExtensionToolbarTools } from "./extensionToolbarTools";
import {
  DEFAULT_CODE_CHROME_STATE,
  coerceChromeState,
  type CodeChromeState,
} from "@tabs/shared/codeChrome";

const WORKSPACE_SHELL_STORAGE_KEY = "tabs:workspace-shell:v1";

const decodeProjectWorkspaceSettingsSchema = Schema.decodeUnknownSync(ProjectWorkspaceSettings);
const decodeProjectWorkspaceSessionState = Schema.decodeSync(ProjectWorkspaceSessionState);

function sanitizeSessionState(value: unknown): ProjectWorkspaceSessionStateType {
  const defaults = decodeProjectWorkspaceSessionState({});
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return defaults;
  }
  const s = value as Record<string, unknown>;

  const openProjectIds = Array.isArray(s.openProjectIds)
    ? s.openProjectIds.filter(
        (id): id is ProjectId => typeof id === "string" && id.trim().length > 0,
      )
    : [];

  const activeProjectId =
    typeof s.activeProjectId === "string" && s.activeProjectId.trim().length > 0
      ? (s.activeProjectId as ProjectId)
      : null;

  const pendingTabIds = Array.isArray(s.pendingTabIds)
    ? s.pendingTabIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  const activePendingTabId =
    typeof s.activePendingTabId === "string" && s.activePendingTabId.trim().length > 0
      ? s.activePendingTabId
      : null;

  const activeToolIdByProjectId: Record<
    ProjectId,
    ProjectWorkspaceSessionStateType["activeToolIdByProjectId"][ProjectId]
  > = {};
  if (
    s.activeToolIdByProjectId &&
    typeof s.activeToolIdByProjectId === "object" &&
    !Array.isArray(s.activeToolIdByProjectId)
  ) {
    for (const [k, v] of Object.entries(s.activeToolIdByProjectId)) {
      if (typeof k === "string" && typeof v === "string" && k.trim().length > 0) {
        activeToolIdByProjectId[k as ProjectId] = v;
      }
    }
  }

  const rememberedThreadIdByProjectId: Record<ProjectId, ThreadId> = {};
  if (
    s.rememberedThreadIdByProjectId &&
    typeof s.rememberedThreadIdByProjectId === "object" &&
    !Array.isArray(s.rememberedThreadIdByProjectId)
  ) {
    for (const [k, v] of Object.entries(s.rememberedThreadIdByProjectId)) {
      if (typeof k === "string" && typeof v === "string" && k.trim().length > 0) {
        rememberedThreadIdByProjectId[k as ProjectId] = v as ThreadId;
      }
    }
  }

  return {
    openProjectIds,
    activeProjectId,
    pendingTabIds,
    activePendingTabId,
    activeToolIdByProjectId,
    rememberedThreadIdByProjectId,
  };
}

function sanitizeCodeToolState(value: unknown): ProjectCodeToolState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return defaultCodeToolState();
  }
  const c = value as Record<string, unknown>;
  return {
    lastFocusedPath: typeof c.lastFocusedPath === "string" ? c.lastFocusedPath : null,
    lastFocusedLineNumber:
      typeof c.lastFocusedLineNumber === "number" && Number.isFinite(c.lastFocusedLineNumber)
        ? c.lastFocusedLineNumber
        : null,
    navigationNonce:
      typeof c.navigationNonce === "number" && Number.isFinite(c.navigationNonce)
        ? c.navigationNonce
        : 0,
    sideChatOpen: typeof c.sideChatOpen === "boolean" ? c.sideChatOpen : false,
    sideChatThreadId:
      typeof c.sideChatThreadId === "string" && c.sideChatThreadId.trim().length > 0
        ? (c.sideChatThreadId as ThreadId)
        : null,
  };
}

function sanitizeGitToolState(value: unknown): ProjectGitToolState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return defaultGitToolState();
  }
  const g = value as Record<string, unknown>;
  return {
    selectedPath: typeof g.selectedPath === "string" ? g.selectedPath : null,
    selectedCommit: typeof g.selectedCommit === "string" ? g.selectedCommit : null,
  };
}

function sanitizeServerToolState(value: unknown): ProjectServerToolState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return defaultServerToolState();
  }
  const s = value as Record<string, unknown>;
  const logQueryByProcessId: Record<string, string> = {};
  if (
    s.logQueryByProcessId &&
    typeof s.logQueryByProcessId === "object" &&
    !Array.isArray(s.logQueryByProcessId)
  ) {
    for (const [pk, pv] of Object.entries(s.logQueryByProcessId)) {
      if (typeof pk === "string" && typeof pv === "string") {
        logQueryByProcessId[pk] = pv;
      }
    }
  }
  return { logQueryByProcessId };
}

function sanitizeBrowserToolState(
  value: unknown,
  settingsFallback?: ProjectWorkspaceSettingsType,
): ProjectBrowserToolState {
  const fallback = settingsFallback
    ? defaultBrowserToolState(settingsFallback)
    : {
        currentUrl: "",
        devicePreset: Schema.decodeSync(BrowserDevicePreset)("project-default"),
        customWidth: null,
        customHeight: null,
        landscape: false,
      };

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fallback;
  }
  const b = value as Record<string, unknown>;
  const currentUrl = typeof b.currentUrl === "string" ? b.currentUrl : fallback.currentUrl;
  let devicePreset: BrowserDevicePresetType = fallback.devicePreset;
  try {
    devicePreset = Schema.decodeUnknownSync(BrowserDevicePreset)(b.devicePreset);
  } catch {
    devicePreset = fallback.devicePreset;
  }
  const customWidth =
    typeof b.customWidth === "number" && Number.isFinite(b.customWidth) ? b.customWidth : null;
  const customHeight =
    typeof b.customHeight === "number" && Number.isFinite(b.customHeight) ? b.customHeight : null;
  const landscape = typeof b.landscape === "boolean" ? b.landscape : false;
  const chromeExpanded = typeof b.chromeExpanded === "boolean" ? b.chromeExpanded : undefined;

  return {
    currentUrl,
    devicePreset,
    customWidth,
    customHeight,
    landscape,
    ...(chromeExpanded !== undefined ? { chromeExpanded } : {}),
  };
}

function decodeArrayOrDefault<S extends Schema.Decoder<unknown>>(
  schema: S,
  value: unknown,
  fallback: S["Type"],
): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch {
    return fallback;
  }
}

function recoverProjectWorkspaceSettings(
  value: Record<string, unknown>,
): ProjectWorkspaceSettingsType {
  const defaults = createDefaultProjectWorkspaceSettings();
  const normalized = { ...value };

  if (
    Array.isArray(normalized.serverProcesses) &&
    !("terminalProcesses" in normalized) &&
    !("serverPresets" in normalized)
  ) {
    normalized.terminalProcesses = normalized.serverProcesses.filter(
      (process) =>
        process &&
        typeof process === "object" &&
        (!("autoStart" in process) || !(process as { autoStart?: unknown }).autoStart),
    );
    normalized.serverPresets = normalized.serverProcesses.filter(
      (process) =>
        process &&
        typeof process === "object" &&
        "autoStart" in process &&
        Boolean((process as { autoStart?: unknown }).autoStart),
    );
  }

  let browser = defaults.browser;
  if (normalized.browser && typeof normalized.browser === "object") {
    const rawBrowser = { ...(normalized.browser as Record<string, unknown>) };
    if (rawBrowser.partitionMode === "named") rawBrowser.partitionMode = "profile";
    if (rawBrowser.partitionMode === "project") rawBrowser.partitionMode = "shared";
    try {
      browser = Schema.decodeUnknownSync(ProjectBrowserSettings)(rawBrowser);
    } catch {
      // Preserve the safe default when this field alone is invalid.
    }
  }

  return decodeProjectWorkspaceSettings({
    tools: decodeArrayOrDefault(
      Schema.Array(ProjectToolDefinitionSchema),
      normalized.tools,
      defaults.tools,
    ),
    browser,
    terminalProcesses: decodeArrayOrDefault(
      Schema.Array(ProjectServerProcessDefinition),
      normalized.terminalProcesses,
      defaults.terminalProcesses,
    ),
    serverPresets: decodeArrayOrDefault(
      Schema.Array(ProjectServerPresetDefinition),
      normalized.serverPresets,
      defaults.serverPresets,
    ),
    customEmbeds: decodeArrayOrDefault(
      Schema.Array(ProjectCustomEmbedDefinition),
      normalized.customEmbeds,
      defaults.customEmbeds,
    ),
  });
}

export function migrateWorkspaceShellPersistedState(
  persistedState: unknown,
  _version: number,
): WorkspaceShellPersistedState {
  const defaults = createDefaultWorkspaceShellPersistedState();
  if (
    typeof persistedState !== "object" ||
    persistedState === null ||
    Array.isArray(persistedState)
  ) {
    return defaults;
  }

  const raw = persistedState as Record<string, unknown>;

  // 1. Session recovery
  const session = sanitizeSessionState(raw.session);

  // 2. Project settings by project ID
  const projectSettingsByProjectId: Record<ProjectId, ProjectWorkspaceSettingsType> = {};
  if (
    raw.projectSettingsByProjectId &&
    typeof raw.projectSettingsByProjectId === "object" &&
    !Array.isArray(raw.projectSettingsByProjectId)
  ) {
    for (const [id, rawSettings] of Object.entries(raw.projectSettingsByProjectId)) {
      if (
        typeof id !== "string" ||
        !id.trim() ||
        typeof rawSettings !== "object" ||
        rawSettings === null
      ) {
        continue;
      }
      const projectId = id as ProjectId;
      try {
        projectSettingsByProjectId[projectId] = decodeProjectWorkspaceSettings(rawSettings);
      } catch {
        try {
          projectSettingsByProjectId[projectId] = recoverProjectWorkspaceSettings(
            rawSettings as Record<string, unknown>,
          );
        } catch {
          projectSettingsByProjectId[projectId] = createDefaultProjectWorkspaceSettings();
        }
      }
    }
  }

  // 3. Browser URLs by session key
  const browserUrlBySessionKey: Record<string, string> = {};
  if (
    raw.browserUrlBySessionKey &&
    typeof raw.browserUrlBySessionKey === "object" &&
    !Array.isArray(raw.browserUrlBySessionKey)
  ) {
    for (const [k, v] of Object.entries(raw.browserUrlBySessionKey)) {
      if (typeof k === "string" && typeof v === "string") {
        browserUrlBySessionKey[k] = v;
      }
    }
  }

  // 4. Browser state by project ID
  const browserStateByProjectId: Record<ProjectId, ProjectBrowserToolState> = {};
  if (
    raw.browserStateByProjectId &&
    typeof raw.browserStateByProjectId === "object" &&
    !Array.isArray(raw.browserStateByProjectId)
  ) {
    for (const [k, v] of Object.entries(raw.browserStateByProjectId)) {
      if (typeof k === "string" && k.trim()) {
        const projectId = k as ProjectId;
        browserStateByProjectId[projectId] = sanitizeBrowserToolState(
          v,
          projectSettingsByProjectId[projectId],
        );
      }
    }
  }

  // 5. Browser state by session key
  const browserStateBySessionKey: Record<string, ProjectBrowserToolState> = {};
  if (
    raw.browserStateBySessionKey &&
    typeof raw.browserStateBySessionKey === "object" &&
    !Array.isArray(raw.browserStateBySessionKey)
  ) {
    for (const [k, v] of Object.entries(raw.browserStateBySessionKey)) {
      if (typeof k === "string" && k.trim()) {
        browserStateBySessionKey[k] = sanitizeBrowserToolState(v);
      }
    }
  }

  // 6. Code state by project ID
  const codeStateByProjectId: Record<ProjectId, ProjectCodeToolState> = {};
  if (
    raw.codeStateByProjectId &&
    typeof raw.codeStateByProjectId === "object" &&
    !Array.isArray(raw.codeStateByProjectId)
  ) {
    for (const [k, v] of Object.entries(raw.codeStateByProjectId)) {
      if (typeof k === "string" && k.trim()) {
        codeStateByProjectId[k as ProjectId] = sanitizeCodeToolState(v);
      }
    }
  }

  // 7. Code chrome state by project ID
  const codeChromeStateByProjectId: Record<ProjectId, CodeChromeState> = {};
  if (
    raw.codeChromeStateByProjectId &&
    typeof raw.codeChromeStateByProjectId === "object" &&
    !Array.isArray(raw.codeChromeStateByProjectId)
  ) {
    for (const [k, v] of Object.entries(raw.codeChromeStateByProjectId)) {
      if (typeof k === "string" && k.trim()) {
        codeChromeStateByProjectId[k as ProjectId] = coerceChromeState(v);
      }
    }
  }

  // 8. Git state by project ID
  const gitStateByProjectId: Record<ProjectId, ProjectGitToolState> = {};
  if (
    raw.gitStateByProjectId &&
    typeof raw.gitStateByProjectId === "object" &&
    !Array.isArray(raw.gitStateByProjectId)
  ) {
    for (const [k, v] of Object.entries(raw.gitStateByProjectId)) {
      if (typeof k === "string" && k.trim()) {
        gitStateByProjectId[k as ProjectId] = sanitizeGitToolState(v);
      }
    }
  }

  // 9. Server state by project ID
  const serverStateByProjectId: Record<ProjectId, ProjectServerToolState> = {};
  if (
    raw.serverStateByProjectId &&
    typeof raw.serverStateByProjectId === "object" &&
    !Array.isArray(raw.serverStateByProjectId)
  ) {
    for (const [k, v] of Object.entries(raw.serverStateByProjectId)) {
      if (typeof k === "string" && k.trim()) {
        serverStateByProjectId[k as ProjectId] = sanitizeServerToolState(v);
      }
    }
  }

  return {
    session,
    projectSettingsByProjectId,
    browserStateByProjectId,
    browserStateBySessionKey,
    browserUrlBySessionKey,
    codeStateByProjectId,
    codeChromeStateByProjectId,
    gitStateByProjectId,
    serverStateByProjectId,
  };
}

/** Persistent browser state uses project/tab keys; environment-scoped UI keys belong to a different store. */
export function browserSessionStateKey(projectId: ProjectId, sessionId = "browser"): string {
  return `${projectId}:${sessionId}`;
}

export interface ProjectBrowserToolState {
  currentUrl: string;
  devicePreset: BrowserDevicePresetType;
  customWidth: number | null;
  customHeight: number | null;
  landscape: boolean;
  chromeExpanded?: boolean;
}

export interface ProjectCodeToolState {
  lastFocusedPath: string | null;
  lastFocusedLineNumber?: number | null;
  navigationNonce: number;
  // The Code-tab AI side chat's open state and selected thread, persisted per
  // project so switching tools/projects (which unmounts the Code tool) doesn't
  // lose the side chat — the running task stays visible and continuous on return.
  sideChatOpen: boolean;
  sideChatThreadId: ThreadId | null;
}

export interface ProjectGitToolState {
  selectedPath: string | null;
  selectedCommit: string | null;
}

export interface ProjectServerToolState {
  logQueryByProcessId: Record<string, string>;
}

export interface WorkspaceShellPersistedState {
  session: ProjectWorkspaceSessionStateType;
  projectSettingsByProjectId: Record<ProjectId, ProjectWorkspaceSettingsType>;
  browserStateByProjectId: Record<ProjectId, ProjectBrowserToolState>;
  browserStateBySessionKey: Record<string, ProjectBrowserToolState>;
  // Last-navigated URL per browser tab, keyed by `${projectId}:${sessionId}`, so
  // each tab (incl. custom tabs) reopens where the user left it.
  browserUrlBySessionKey: Record<string, string>;
  codeStateByProjectId: Record<ProjectId, ProjectCodeToolState>;
  codeChromeStateByProjectId: Record<ProjectId, CodeChromeState>;
  gitStateByProjectId: Record<ProjectId, ProjectGitToolState>;
  serverStateByProjectId: Record<ProjectId, ProjectServerToolState>;
}

export interface WorkspaceShellStore extends WorkspaceShellPersistedState {
  syncProjects: (projects: ReadonlyArray<Project>, threads: ReadonlyArray<Thread>) => void;
  openProject: (projectId: ProjectId) => void;
  openProjectSurface: (
    projectId: ProjectId,
    toolId?: string | undefined,
    threadId?: ThreadId | null | undefined,
  ) => void;
  closeProject: (projectId: ProjectId) => void;
  setActiveProject: (projectId: ProjectId | null) => void;
  setActiveTool: (projectId: ProjectId, toolId: string) => void;
  rememberThread: (projectId: ProjectId, threadId: ThreadId) => void;
  upsertProjectSettings: (
    projectId: ProjectId,
    updater:
      | Partial<ProjectWorkspaceSettingsType>
      | ((current: ProjectWorkspaceSettingsType) => ProjectWorkspaceSettingsType),
  ) => void;
  removeExtensionToolPreferences: (extensionId: string) => void;
  setBrowserCurrentUrl: (projectId: ProjectId, url: string, sessionId?: string | undefined) => void;
  setBrowserChromeExpanded: (
    projectId: ProjectId,
    expanded: boolean,
    sessionId?: string | undefined,
  ) => void;
  setBrowserSessionUrl: (projectId: ProjectId, sessionId: string, url: string) => void;
  setBrowserViewport: (
    projectId: ProjectId,
    input: {
      devicePreset: BrowserDevicePresetType;
      customWidth?: number | null | undefined;
      customHeight?: number | null | undefined;
      landscape?: boolean | undefined;
    },
    sessionId?: string | undefined,
  ) => void;
  setCodeFocusedPath: (
    projectId: ProjectId,
    path: string | null,
    lineNumber?: number | null | undefined,
  ) => void;
  setCodeChromeState: (
    projectId: ProjectId,
    updater: CodeChromeState | ((current: CodeChromeState) => CodeChromeState),
  ) => void;
  setSideChatOpen: (projectId: ProjectId, open: boolean) => void;
  setSideChatThread: (projectId: ProjectId, threadId: ThreadId | null) => void;
  setGitSelectedPath: (projectId: ProjectId, path: string | null) => void;
  setGitSelectedCommit: (projectId: ProjectId, commit: string | null) => void;
  setServerLogQuery: (projectId: ProjectId, processId: string, query: string) => void;
  // Pending-tab actions
  openPendingTab: (pendingId: string) => void;
  resolvePendingTab: (pendingId: string, projectId: ProjectId) => void;
  closePendingTab: (pendingId: string) => void;
}

export function createDefaultProjectWorkspaceSettings(): ProjectWorkspaceSettingsType {
  return decodeProjectWorkspaceSettings({});
}

function mergeMissingBuiltInTools(
  tools: ProjectWorkspaceSettingsType["tools"],
): ProjectWorkspaceSettingsType["tools"] {
  const defaults = decodeProjectWorkspaceSettingsSchema({}).tools;
  const merged = [...tools];

  for (const [defaultIndex, defaultTool] of defaults.entries()) {
    if (merged.some((tool) => tool.kind === defaultTool.kind)) continue;
    const migratedTool = { ...defaultTool, visible: false };

    const previousKinds = new Set(defaults.slice(0, defaultIndex).map((tool) => tool.kind));
    let previousIndex = -1;
    for (const [toolIndex, tool] of merged.entries()) {
      if (previousKinds.has(tool.kind)) previousIndex = toolIndex;
    }

    if (previousIndex >= 0) {
      merged.splice(previousIndex + 1, 0, migratedTool);
      continue;
    }

    const nextKinds = new Set(defaults.slice(defaultIndex + 1).map((tool) => tool.kind));
    const nextIndex = merged.findIndex((tool) => nextKinds.has(tool.kind));
    merged.splice(nextIndex >= 0 ? nextIndex : merged.length, 0, migratedTool);
  }

  return merged;
}

function decodeProjectWorkspaceSettings(input: unknown): ProjectWorkspaceSettingsType {
  let toDecode = input;

  if (
    input !== null &&
    typeof input === "object" &&
    "serverProcesses" in input &&
    Array.isArray((input as any).serverProcesses)
  ) {
    const rawInput = input as any;
    toDecode = { ...rawInput };

    if (!("terminalProcesses" in rawInput) && !("serverPresets" in rawInput)) {
      (toDecode as any).terminalProcesses = rawInput.serverProcesses.filter(
        (p: any) => p && !p.autoStart,
      );
      (toDecode as any).serverPresets = rawInput.serverProcesses.filter(
        (p: any) => p && p.autoStart,
      );
    }
  }

  if (
    toDecode !== null &&
    typeof toDecode === "object" &&
    "browser" in toDecode &&
    (toDecode as any).browser &&
    typeof (toDecode as any).browser === "object"
  ) {
    const rawBrowser = { ...(toDecode as any).browser };
    if (rawBrowser.partitionMode === "named") {
      rawBrowser.partitionMode = "profile";
    } else if (rawBrowser.partitionMode === "project") {
      rawBrowser.partitionMode = "shared";
    }
    toDecode = { ...(toDecode as any), browser: rawBrowser };
  }

  const decoded = decodeProjectWorkspaceSettingsSchema(toDecode);

  const normalizeProcess = (process: any) => {
    const normalizedCommands =
      process.commands && process.commands.length > 0
        ? process.commands
        : process.command && process.command.trim().length > 0
          ? [process.command.trim()]
          : [];

    const result: any = {
      id: process.id,
      label: process.label,
      commands: normalizedCommands,
      cwd: process.cwd || "",
      env: process.env || {},
      autoStart: Boolean(process.autoStart),
    };

    if (process.command) result.command = process.command;
    if (process.previewUrl !== undefined) result.previewUrl = process.previewUrl;
    if (process.autoOpenPreview !== undefined) result.autoOpenPreview = process.autoOpenPreview;
    if (process.previewOpenTarget !== undefined)
      result.previewOpenTarget = process.previewOpenTarget;
    if (process.previewFocus !== undefined) result.previewFocus = process.previewFocus;
    if (process.dependsOn !== undefined) result.dependsOn = process.dependsOn;

    return result;
  };

  return {
    ...decoded,
    tools: mergeMissingBuiltInTools(decoded.tools),
    terminalProcesses: (decoded.terminalProcesses || []).map(normalizeProcess),
    serverPresets: (decoded.serverPresets || []).map(normalizeProcess),
  };
}

function defaultBrowserToolState(settings: ProjectWorkspaceSettingsType): ProjectBrowserToolState {
  return {
    // Seed the live URL once, at creation, from the configured default. Empty is
    // allowed — it renders a blank "new tab" rather than forcing localhost:3000.
    // A later change to `browser.defaultUrl` never re-navigates an open tab
    // (upsertProjectSettings leaves an existing tab's currentUrl untouched).
    currentUrl: settings.browser.defaultUrl.trim(),
    devicePreset: Schema.decodeSync(BrowserDevicePreset)("project-default"),
    customWidth: null,
    customHeight: null,
    landscape: false,
  };
}

function defaultCodeToolState(): ProjectCodeToolState {
  return {
    lastFocusedPath: null,
    lastFocusedLineNumber: null,
    navigationNonce: 0,
    sideChatOpen: false,
    sideChatThreadId: null,
  };
}

function defaultGitToolState(): ProjectGitToolState {
  return {
    selectedPath: null,
    selectedCommit: null,
  };
}

/**
 * Stable, frozen singletons used as the fallback when a project has no per-tool
 * state yet. Zustand selectors compare the returned snapshot by reference, so a
 * fresh `{}` fallback would make the component re-render on EVERY store update
 * (until the project's state exists). Returning these constants keeps the
 * reference stable, so the component only re-renders when the real state changes.
 */
export const EMPTY_PROJECT_CODE_TOOL_STATE: ProjectCodeToolState = Object.freeze({
  lastFocusedPath: null,
  navigationNonce: 0,
  sideChatOpen: false,
  sideChatThreadId: null,
});
export const EMPTY_PROJECT_GIT_TOOL_STATE: ProjectGitToolState = Object.freeze({
  selectedPath: null,
  selectedCommit: null,
});

function defaultServerToolState(): ProjectServerToolState {
  return {
    logQueryByProcessId: {},
  };
}

function resolveVisibleTools(settings: ProjectWorkspaceSettingsType): ProjectToolDefinition[] {
  const customEmbedIds = new Set((settings.customEmbeds || []).map((embed) => embed.id));
  const terminalProcessIds = new Set(
    (settings.terminalProcesses || []).map((process) => process.id),
  );
  const visible = (settings.tools || []).filter((tool) => {
    if (!tool.visible) return false;
    if (tool.kind === "custom_embed") {
      return tool.customEmbedId ? customEmbedIds.has(tool.customEmbedId) : false;
    }
    if (tool.kind === "custom_process") {
      return tool.terminalProcessId ? terminalProcessIds.has(tool.terminalProcessId) : false;
    }
    return true;
  });
  return visible.length > 0 ? visible : [...createDefaultProjectWorkspaceSettings().tools];
}

export function resolveActiveToolId(
  settings: ProjectWorkspaceSettingsType,
  requestedToolId: string | undefined,
): string {
  const visibleTools = resolveVisibleTools(settings);
  if (requestedToolId && visibleTools.some((tool) => tool.id === requestedToolId)) {
    return requestedToolId;
  }
  const defaultTool =
    visibleTools.find((tool) => tool.id === DEFAULT_PROJECT_TOOL_KIND) ??
    visibleTools.find((tool) => tool.kind === DEFAULT_PROJECT_TOOL_KIND);
  return defaultTool?.id ?? visibleTools[0]?.id ?? "agents";
}

function ensureProjectDefaults(
  state: WorkspaceShellPersistedState,
  projectId: ProjectId,
): WorkspaceShellPersistedState {
  const nextSettings =
    state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings();
  const defaultBrowser =
    state.browserStateByProjectId[projectId] ?? defaultBrowserToolState(nextSettings);
  const defaultBrowserKey = `${projectId}:browser`;
  return {
    ...state,
    projectSettingsByProjectId: {
      ...state.projectSettingsByProjectId,
      [projectId]: nextSettings,
    },
    browserStateByProjectId: {
      ...state.browserStateByProjectId,
      [projectId]: defaultBrowser,
    },
    browserStateBySessionKey: {
      ...state.browserStateBySessionKey,
      [defaultBrowserKey]: state.browserStateBySessionKey?.[defaultBrowserKey] ?? defaultBrowser,
    },
    codeStateByProjectId: {
      ...state.codeStateByProjectId,
      [projectId]: state.codeStateByProjectId[projectId] ?? defaultCodeToolState(),
    },
    codeChromeStateByProjectId: {
      ...state.codeChromeStateByProjectId,
      [projectId]: state.codeChromeStateByProjectId?.[projectId] ?? DEFAULT_CODE_CHROME_STATE,
    },
    gitStateByProjectId: {
      ...state.gitStateByProjectId,
      [projectId]: state.gitStateByProjectId[projectId] ?? defaultGitToolState(),
    },
    serverStateByProjectId: {
      ...state.serverStateByProjectId,
      [projectId]: state.serverStateByProjectId[projectId] ?? defaultServerToolState(),
    },
    session: {
      ...state.session,
      activeToolIdByProjectId: {
        ...state.session.activeToolIdByProjectId,
        [projectId]: resolveActiveToolId(
          nextSettings,
          state.session.activeToolIdByProjectId[projectId],
        ),
      },
    },
  };
}

export function createDefaultWorkspaceShellPersistedState(): WorkspaceShellPersistedState {
  return {
    session: decodeProjectWorkspaceSessionState({}),
    projectSettingsByProjectId: {},
    browserStateByProjectId: {},
    browserStateBySessionKey: {},
    browserUrlBySessionKey: {},
    codeStateByProjectId: {},
    codeChromeStateByProjectId: {},
    gitStateByProjectId: {},
    serverStateByProjectId: {},
  };
}

export function syncWorkspaceShellState(
  input: WorkspaceShellPersistedState,
  projects: ReadonlyArray<Project>,
  threads: ReadonlyArray<Thread>,
): WorkspaceShellPersistedState {
  const projectIds = new Set(projects.map((project) => project.id));
  let nextState = createDefaultWorkspaceShellPersistedState();
  // Preserve per-tab navigated URLs and per-session browser states (keyed by `${projectId}:${sessionId}`) across
  // the project sync so tabs reopen where the user left them.
  nextState.browserUrlBySessionKey = { ...input.browserUrlBySessionKey };
  nextState.browserStateBySessionKey = { ...input.browserStateBySessionKey };

  for (const project of projects) {
    nextState = ensureProjectDefaults(nextState, project.id);
    const settings = input.projectSettingsByProjectId[project.id];
    if (settings) {
      nextState.projectSettingsByProjectId[project.id] = decodeProjectWorkspaceSettings(settings);
      const defaultState = defaultBrowserToolState(
        nextState.projectSettingsByProjectId[project.id]!,
      );
      nextState.browserStateByProjectId[project.id] =
        input.browserStateByProjectId[project.id] ?? defaultState;
      const defaultBrowserKey = `${project.id}:browser`;
      if (!nextState.browserStateBySessionKey[defaultBrowserKey]) {
        nextState.browserStateBySessionKey[defaultBrowserKey] =
          input.browserStateByProjectId[project.id] ?? defaultState;
      }
    }
    if (input.codeStateByProjectId[project.id]) {
      nextState.codeStateByProjectId[project.id] = input.codeStateByProjectId[project.id]!;
    }
    if (input.codeChromeStateByProjectId?.[project.id]) {
      nextState.codeChromeStateByProjectId[project.id] =
        input.codeChromeStateByProjectId[project.id]!;
    }
    if (input.gitStateByProjectId[project.id]) {
      nextState.gitStateByProjectId[project.id] = input.gitStateByProjectId[project.id]!;
    }
    if (input.serverStateByProjectId[project.id]) {
      nextState.serverStateByProjectId[project.id] = input.serverStateByProjectId[project.id]!;
    }
  }

  const openProjectIds = input.session.openProjectIds.filter((projectId) =>
    projectIds.has(projectId),
  );
  // Preserve pending tab IDs as-is — they have no server-side project to
  // resolve against, so the existing "resolve or drop" filter must not touch them.
  const pendingTabIds = [...(input.session.pendingTabIds ?? [])];
  const nextOpenProjectIds = openProjectIds;
  const activeProjectId =
    input.session.activeProjectId &&
    projectIds.has(input.session.activeProjectId) &&
    nextOpenProjectIds.includes(input.session.activeProjectId)
      ? input.session.activeProjectId
      : (nextOpenProjectIds[0] ?? null);
  // Preserve activePendingTabId only if the pending tab still exists.
  const activePendingTabId =
    input.session.activePendingTabId && pendingTabIds.includes(input.session.activePendingTabId)
      ? input.session.activePendingTabId
      : null;
  const rememberedThreadIdByProjectId: Record<ProjectId, ThreadId> = {};
  const threadIds = new Set(threads.map((thread) => thread.id));
  for (const [projectId, threadId] of Object.entries(
    input.session.rememberedThreadIdByProjectId,
  ) as Array<[ProjectId, ThreadId]>) {
    if (!projectIds.has(projectId) || !threadIds.has(threadId)) {
      continue;
    }
    rememberedThreadIdByProjectId[projectId] = threadId;
  }

  const activeToolIdByProjectId: Record<ProjectId, string> = {};
  for (const project of projects) {
    activeToolIdByProjectId[project.id] = resolveActiveToolId(
      nextState.projectSettingsByProjectId[project.id] ?? createDefaultProjectWorkspaceSettings(),
      input.session.activeToolIdByProjectId[project.id],
    );
  }

  nextState.session = {
    openProjectIds: nextOpenProjectIds,
    activeProjectId,
    pendingTabIds,
    activePendingTabId,
    activeToolIdByProjectId,
    rememberedThreadIdByProjectId,
  };

  // Reset browser URL to default if resumeLastVisitedPage is disabled
  for (const project of projects) {
    const settings = nextState.projectSettingsByProjectId[project.id];
    const browserState = nextState.browserStateByProjectId[project.id];
    if (settings && browserState && settings.browser.resumeLastVisitedPage === false) {
      browserState.currentUrl = settings.browser.defaultUrl.trim();
    }
  }

  return nextState;
}

export function resolveProjectTools(
  settings: ProjectWorkspaceSettingsType,
  installedExtensions?: readonly DesktopInstalledExtension[],
  projectId?: string,
): ProjectToolDefinition[] {
  if (!installedExtensions || !projectId) return resolveVisibleTools(settings);
  return resolveVisibleTools({
    ...settings,
    tools: mergeExtensionToolbarTools(settings.tools, installedExtensions, projectId),
  });
}

export const useWorkspaceShellStore = create<WorkspaceShellStore>()(
  persist(
    (set) => ({
      ...createDefaultWorkspaceShellPersistedState(),
      syncProjects: (projects, threads) =>
        set((state) => syncWorkspaceShellState(state, projects, threads)),
      openProject: (projectId) =>
        set((state) => {
          const projectSettings =
            state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings();
          const openProjectIds = state.session.openProjectIds.includes(projectId)
            ? state.session.openProjectIds
            : [...state.session.openProjectIds, projectId];
          return ensureProjectDefaults(
            {
              ...state,
              session: {
                ...state.session,
                openProjectIds,
                activeProjectId: projectId,
                activePendingTabId: null,
                activeToolIdByProjectId: {
                  ...state.session.activeToolIdByProjectId,
                  [projectId]: resolveActiveToolId(
                    projectSettings,
                    state.session.activeToolIdByProjectId[projectId],
                  ),
                },
              },
            },
            projectId,
          );
        }),
      openProjectSurface: (projectId, toolId, threadId) =>
        set((state) => {
          const projectSettings =
            state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings();
          const openProjectIds = state.session.openProjectIds.includes(projectId)
            ? state.session.openProjectIds
            : [...state.session.openProjectIds, projectId];
          const candidateToolId = toolId ?? state.session.activeToolIdByProjectId[projectId];
          const effectiveToolId = resolveActiveToolId(projectSettings, candidateToolId);
          const rememberedThreads = { ...state.session.rememberedThreadIdByProjectId };
          if (threadId) {
            rememberedThreads[projectId] = threadId;
          }
          return ensureProjectDefaults(
            {
              ...state,
              session: {
                ...state.session,
                openProjectIds,
                activeProjectId: projectId,
                activePendingTabId: null,
                activeToolIdByProjectId: {
                  ...state.session.activeToolIdByProjectId,
                  [projectId]: effectiveToolId,
                },
                rememberedThreadIdByProjectId: rememberedThreads,
              },
            },
            projectId,
          );
        }),
      closeProject: (projectId) =>
        set((state) => {
          const openProjectIds = state.session.openProjectIds.filter((id) => id !== projectId);
          const wasActive = state.session.activeProjectId === projectId;
          // When closing the active project, fall back to: another real project
          // first, then a pending tab (setting activePendingTabId, not activeProjectId),
          // then null if all tabs are gone.
          const nextActiveProjectId = wasActive
            ? (openProjectIds[openProjectIds.length - 1] ?? null)
            : state.session.activeProjectId;
          const nextActivePendingTabId =
            wasActive && !nextActiveProjectId
              ? (state.session.pendingTabIds[state.session.pendingTabIds.length - 1] ??
                state.session.activePendingTabId)
              : state.session.activePendingTabId;
          return {
            ...state,
            session: {
              ...state.session,
              openProjectIds,
              activeProjectId: nextActiveProjectId,
              activePendingTabId: nextActivePendingTabId,
            },
          };
        }),

      setActiveProject: (projectId) =>
        set((state) => ({
          ...state,
          session: {
            ...state.session,
            activeProjectId: projectId,
            activePendingTabId: null,
            openProjectIds:
              projectId && !state.session.openProjectIds.includes(projectId)
                ? [...state.session.openProjectIds, projectId]
                : state.session.openProjectIds,
          },
        })),
      setActiveTool: (projectId, toolId) =>
        set((state) => ({
          ...state,
          session: {
            ...state.session,
            activeToolIdByProjectId: {
              ...state.session.activeToolIdByProjectId,
              [projectId]: toolId,
            },
          },
        })),
      rememberThread: (projectId, threadId) =>
        set((state) => ({
          ...state,
          session: {
            ...state.session,
            rememberedThreadIdByProjectId: {
              ...state.session.rememberedThreadIdByProjectId,
              [projectId]: threadId,
            },
          },
        })),
      upsertProjectSettings: (projectId, updater) =>
        set((state) => {
          const current =
            state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings();
          const nextSettings = decodeProjectWorkspaceSettings(
            typeof updater === "function" ? updater(current) : { ...current, ...updater },
          );
          const defaultBrowser =
            state.browserStateByProjectId[projectId] ?? defaultBrowserToolState(nextSettings);
          const defaultBrowserKey = `${projectId}:browser`;
          return {
            ...state,
            projectSettingsByProjectId: {
              ...state.projectSettingsByProjectId,
              [projectId]: nextSettings,
            },
            // `browser.defaultUrl` is the template for *new* browser tabs only.
            // Never re-write an existing tab's live `currentUrl` from a settings
            // change — otherwise editing the default re-navigates open tabs. Seed
            // a fresh entry only when one doesn't exist yet.
            browserStateByProjectId: state.browserStateByProjectId[projectId]
              ? state.browserStateByProjectId
              : {
                  ...state.browserStateByProjectId,
                  [projectId]: defaultBrowser,
                },
            browserStateBySessionKey: state.browserStateBySessionKey?.[defaultBrowserKey]
              ? state.browserStateBySessionKey
              : {
                  ...state.browserStateBySessionKey,
                  [defaultBrowserKey]: defaultBrowser,
                },
            session: {
              ...state.session,
              activeToolIdByProjectId: {
                ...state.session.activeToolIdByProjectId,
                [projectId]: resolveActiveToolId(
                  nextSettings,
                  state.session.activeToolIdByProjectId[projectId],
                ),
              },
            },
          };
        }),
      removeExtensionToolPreferences: (extensionId) =>
        set((state) => {
          const projectSettingsByProjectId = { ...state.projectSettingsByProjectId };
          const activeToolIdByProjectId = { ...state.session.activeToolIdByProjectId };
          let changed = false;
          for (const [projectId, settings] of Object.entries(projectSettingsByProjectId)) {
            const tools = settings.tools.filter(
              (tool) => tool.kind !== "extension" || tool.extensionId !== extensionId,
            );
            if (tools.length === settings.tools.length) continue;
            changed = true;
            const nextSettings = { ...settings, tools };
            projectSettingsByProjectId[projectId as ProjectId] = nextSettings;
            activeToolIdByProjectId[projectId as ProjectId] = resolveActiveToolId(
              nextSettings,
              activeToolIdByProjectId[projectId as ProjectId],
            );
          }
          return changed
            ? {
                ...state,
                projectSettingsByProjectId,
                session: { ...state.session, activeToolIdByProjectId },
              }
            : state;
        }),
      setBrowserCurrentUrl: (projectId, url, sessionId) =>
        set((state) => {
          const effectiveSessionId = sessionId ?? "browser";
          const sessionKey = browserSessionStateKey(projectId, effectiveSessionId);
          const currentSessionState =
            state.browserStateBySessionKey[sessionKey] ??
            (effectiveSessionId === "browser"
              ? state.browserStateByProjectId[projectId]
              : undefined) ??
            defaultBrowserToolState(
              state.projectSettingsByProjectId[projectId] ??
                createDefaultProjectWorkspaceSettings(),
            );
          if (currentSessionState.currentUrl === url) {
            return state;
          }
          const nextBrowserState: ProjectBrowserToolState = {
            ...currentSessionState,
            currentUrl: url,
          };
          const nextSessionMap = {
            ...state.browserStateBySessionKey,
            [sessionKey]: nextBrowserState,
          };
          const nextUrlMap = {
            ...state.browserUrlBySessionKey,
            [sessionKey]: url,
          };
          const nextProjectMap =
            effectiveSessionId === "browser"
              ? {
                  ...state.browserStateByProjectId,
                  [projectId]: nextBrowserState,
                }
              : state.browserStateByProjectId;
          return {
            ...state,
            browserStateBySessionKey: nextSessionMap,
            browserUrlBySessionKey: nextUrlMap,
            browserStateByProjectId: nextProjectMap,
          };
        }),
      setBrowserChromeExpanded: (projectId, expanded, sessionId) =>
        set((state) => {
          const effectiveSessionId = sessionId ?? "browser";
          const sessionKey = browserSessionStateKey(projectId, effectiveSessionId);
          const currentSessionState =
            state.browserStateBySessionKey[sessionKey] ??
            (effectiveSessionId === "browser"
              ? state.browserStateByProjectId[projectId]
              : undefined) ??
            defaultBrowserToolState(
              state.projectSettingsByProjectId[projectId] ??
                createDefaultProjectWorkspaceSettings(),
            );
          if (currentSessionState.chromeExpanded === expanded) {
            return state;
          }
          const nextBrowserState: ProjectBrowserToolState = {
            ...currentSessionState,
            chromeExpanded: expanded,
          };
          const nextSessionMap = {
            ...state.browserStateBySessionKey,
            [sessionKey]: nextBrowserState,
          };
          const nextProjectMap =
            effectiveSessionId === "browser"
              ? {
                  ...state.browserStateByProjectId,
                  [projectId]: nextBrowserState,
                }
              : state.browserStateByProjectId;
          return {
            ...state,
            browserStateBySessionKey: nextSessionMap,
            browserStateByProjectId: nextProjectMap,
          };
        }),
      setBrowserSessionUrl: (projectId, sessionId, url) =>
        set((state) => {
          const key = browserSessionStateKey(projectId, sessionId);
          const existingUrl = state.browserUrlBySessionKey[key];
          const existingSessionState = state.browserStateBySessionKey[key];
          if (existingUrl === url && existingSessionState?.currentUrl === url) {
            return state;
          }
          const nextSessionMap = existingSessionState
            ? {
                ...state.browserStateBySessionKey,
                [key]: {
                  ...existingSessionState,
                  currentUrl: url,
                },
              }
            : state.browserStateBySessionKey;
          return {
            ...state,
            browserUrlBySessionKey: {
              ...state.browserUrlBySessionKey,
              [key]: url,
            },
            browserStateBySessionKey: nextSessionMap,
          };
        }),
      setBrowserViewport: (projectId, input, sessionId) =>
        set((state) => {
          const effectiveSessionId = sessionId ?? "browser";
          const sessionKey = browserSessionStateKey(projectId, effectiveSessionId);
          const currentSessionState =
            state.browserStateBySessionKey[sessionKey] ??
            (effectiveSessionId === "browser"
              ? state.browserStateByProjectId[projectId]
              : undefined) ??
            defaultBrowserToolState(
              state.projectSettingsByProjectId[projectId] ??
                createDefaultProjectWorkspaceSettings(),
            );
          const nextBrowserState: ProjectBrowserToolState = {
            ...currentSessionState,
            devicePreset: input.devicePreset,
            customWidth:
              input.customWidth !== undefined
                ? input.customWidth
                : (currentSessionState.customWidth ?? null),
            customHeight:
              input.customHeight !== undefined
                ? input.customHeight
                : (currentSessionState.customHeight ?? null),
            landscape:
              input.landscape !== undefined
                ? input.landscape
                : (currentSessionState.landscape ?? false),
          };
          const nextSessionMap = {
            ...state.browserStateBySessionKey,
            [sessionKey]: nextBrowserState,
          };
          const nextProjectMap =
            effectiveSessionId === "browser"
              ? {
                  ...state.browserStateByProjectId,
                  [projectId]: nextBrowserState,
                }
              : state.browserStateByProjectId;
          return {
            ...state,
            browserStateBySessionKey: nextSessionMap,
            browserStateByProjectId: nextProjectMap,
          };
        }),
      setCodeFocusedPath: (projectId, path, lineNumber) =>
        set((state) => ({
          ...state,
          codeStateByProjectId: {
            ...state.codeStateByProjectId,
            [projectId]: {
              ...(state.codeStateByProjectId[projectId] ?? defaultCodeToolState()),
              lastFocusedPath: path,
              lastFocusedLineNumber: lineNumber ?? null,
              navigationNonce: (state.codeStateByProjectId[projectId]?.navigationNonce ?? 0) + 1,
            },
          },
        })),
      setCodeChromeState: (projectId, updater) =>
        set((state) => {
          const current = state.codeChromeStateByProjectId[projectId] ?? DEFAULT_CODE_CHROME_STATE;
          const nextChromeState = typeof updater === "function" ? updater(current) : updater;
          return {
            ...state,
            codeChromeStateByProjectId: {
              ...state.codeChromeStateByProjectId,
              [projectId]: nextChromeState,
            },
          };
        }),
      setSideChatOpen: (projectId, open) =>
        set((state) => ({
          ...state,
          codeStateByProjectId: {
            ...state.codeStateByProjectId,
            [projectId]: {
              ...(state.codeStateByProjectId[projectId] ?? defaultCodeToolState()),
              sideChatOpen: open,
            },
          },
        })),
      setSideChatThread: (projectId, threadId) =>
        set((state) => ({
          ...state,
          codeStateByProjectId: {
            ...state.codeStateByProjectId,
            [projectId]: {
              ...(state.codeStateByProjectId[projectId] ?? defaultCodeToolState()),
              sideChatThreadId: threadId,
            },
          },
        })),
      setGitSelectedPath: (projectId, path) =>
        set((state) => ({
          ...state,
          gitStateByProjectId: {
            ...state.gitStateByProjectId,
            [projectId]: {
              ...(state.gitStateByProjectId[projectId] ?? defaultGitToolState()),
              selectedPath: path,
              selectedCommit: path
                ? null
                : (state.gitStateByProjectId[projectId]?.selectedCommit ?? null),
            },
          },
        })),
      setGitSelectedCommit: (projectId, commit) =>
        set((state) => ({
          ...state,
          gitStateByProjectId: {
            ...state.gitStateByProjectId,
            [projectId]: {
              ...(state.gitStateByProjectId[projectId] ?? defaultGitToolState()),
              selectedPath: commit
                ? null
                : (state.gitStateByProjectId[projectId]?.selectedPath ?? null),
              selectedCommit: commit,
            },
          },
        })),
      setServerLogQuery: (projectId, processId, query) =>
        set((state) => ({
          ...state,
          serverStateByProjectId: {
            ...state.serverStateByProjectId,
            [projectId]: {
              ...(state.serverStateByProjectId[projectId] ?? defaultServerToolState()),
              logQueryByProcessId: {
                ...state.serverStateByProjectId[projectId]?.logQueryByProcessId,
                [processId]: query,
              },
            },
          },
        })),

      // ── Pending-tab actions ──────────────────────────────────────────────────

      openPendingTab: (pendingId) =>
        set((state) => ({
          ...state,
          session: {
            ...state.session,
            // Append the new pending tab to the end of the tab strip, but only
            // if it isn't already there (idempotent).
            pendingTabIds: state.session.pendingTabIds.includes(pendingId)
              ? state.session.pendingTabIds
              : [...state.session.pendingTabIds, pendingId],
            activePendingTabId: pendingId,
            // Clear the real active project so the content area shows the landing
            // screen for this pending tab.
            activeProjectId: null,
          },
        })),

      resolvePendingTab: (pendingId, projectId) =>
        set((state) => {
          // Replace the pending slot with the real project ID at the same position
          // in the combined tab strip (pending tabs interleave with real tabs).
          const pendingTabIds = state.session.pendingTabIds.filter((id) => id !== pendingId);
          const openProjectIds = state.session.openProjectIds.includes(projectId)
            ? state.session.openProjectIds
            : [...state.session.openProjectIds, projectId];
          const projectSettings =
            state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings();
          return ensureProjectDefaults(
            {
              ...state,
              session: {
                ...state.session,
                pendingTabIds,
                activePendingTabId: null,
                openProjectIds,
                activeProjectId: projectId,
                activeToolIdByProjectId: {
                  ...state.session.activeToolIdByProjectId,
                  [projectId]: resolveActiveToolId(
                    projectSettings,
                    state.session.activeToolIdByProjectId[projectId],
                  ),
                },
              },
            },
            projectId,
          );
        }),

      closePendingTab: (pendingId) =>
        set((state) => {
          const pendingTabIds = state.session.pendingTabIds.filter((id) => id !== pendingId);
          const wasActive = state.session.activePendingTabId === pendingId;
          // On close, fall back to the last real open project, or the last
          // remaining pending tab, or null (all tabs gone).
          const nextActivePendingTabId = wasActive
            ? (pendingTabIds[pendingTabIds.length - 1] ?? null)
            : state.session.activePendingTabId;
          const nextActiveProjectId = wasActive
            ? nextActivePendingTabId
              ? null
              : (state.session.openProjectIds[state.session.openProjectIds.length - 1] ?? null)
            : state.session.activeProjectId;
          return {
            ...state,
            session: {
              ...state.session,
              pendingTabIds,
              activePendingTabId: nextActivePendingTabId,
              activeProjectId: nextActiveProjectId,
            },
          };
        }),
    }),
    {
      name: WORKSPACE_SHELL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Stable persistence version 2 with field-by-field migration recovery.
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        return migrateWorkspaceShellPersistedState(persistedState, version);
      },
      partialize: (state) => ({
        session: state.session,
        projectSettingsByProjectId: state.projectSettingsByProjectId,
        browserStateByProjectId: state.browserStateByProjectId,
        browserStateBySessionKey: state.browserStateBySessionKey,
        browserUrlBySessionKey: state.browserUrlBySessionKey,
        codeStateByProjectId: state.codeStateByProjectId,
        codeChromeStateByProjectId: state.codeChromeStateByProjectId,
        gitStateByProjectId: state.gitStateByProjectId,
        serverStateByProjectId: state.serverStateByProjectId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Re-sanitize hydrated state to enforce runtime invariants across schema evolution
        const sanitized = migrateWorkspaceShellPersistedState(state, 2);
        Object.assign(state, sanitized);
      },
    },
  ),
);

export function useProjectWorkspaceSettings(
  projectId: ProjectId | null,
): ProjectWorkspaceSettingsType | null {
  return useWorkspaceShellStore((state) =>
    projectId
      ? (state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings())
      : null,
  );
}

export function useResolvedProjectTools(projectId: ProjectId | null): ProjectToolDefinition[] {
  return useWorkspaceShellStore((state) => {
    if (!projectId) {
      return [...createDefaultProjectWorkspaceSettings().tools];
    }
    return resolveProjectTools(
      state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings(),
    );
  });
}

export function resolveDefaultProjectToolOrder(): typeof DEFAULT_PROJECT_TOOL_ORDER {
  return DEFAULT_PROJECT_TOOL_ORDER;
}
