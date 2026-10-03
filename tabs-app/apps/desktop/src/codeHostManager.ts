import { isLightDesktopTheme } from "./desktopTheme";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ipcMain,
  nativeTheme,
  shell,
  WebContentsView,
  type BrowserWindow,
  type ProtocolRequest,
  type Rectangle,
} from "electron";
import type {
  CodeChromeState,
  CodeTabInfo,
  DesktopCodeHostActivateSessionInput,
  DesktopCodeHostEnsureSessionInput,
  DesktopCodeHostOpenFileInput,
  DesktopCodeHostSetBoundsInput,
  DesktopCodeHostState,
} from "@tabs/contracts";
import { RotatingFileSink } from "@tabs/shared/logging";

import type { CodeControlChannel } from "./codeControlChannel";
import type { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";

export const CODE_HOST_CHROME_STATE_CHANNEL = "desktop:code-host:chrome-state";

export const CODE_OSS_EMBED_EXTENSION_RELATIVE_PATH = Path.join(
  "..",
  "resources",
  "code-oss-extensions",
  "tabs-embed-defaults",
);
export const CODE_OSS_INTEGRATION_EXTENSION_RELATIVE_PATH = Path.join(
  "..",
  "resources",
  "code-oss-extensions",
  "tabs-workbench-integration",
);
export const CODE_OSS_DESKTOP_PRELOAD_RELATIVE_PATH = Path.join(
  "out",
  "vs",
  "base",
  "parts",
  "sandbox",
  "electron-browser",
  "preload.js",
);
export const CODE_OSS_DESKTOP_WORKBENCH_RELATIVE_PATH = Path.join(
  "out",
  "vs",
  "code",
  "electron-browser",
  "workbench",
  "workbench-dev.html",
);
export const CODE_OSS_NLS_MESSAGES_RELATIVE_PATH = Path.join("out-build", "nls.messages.json");
export const CODE_OSS_PRODUCT_CONFIGURATION_RELATIVE_PATH = "product.json";

const REQUIRED_CODE_OSS_DESKTOP_RELATIVE_PATHS = [
  CODE_OSS_DESKTOP_PRELOAD_RELATIVE_PATH,
  CODE_OSS_DESKTOP_WORKBENCH_RELATIVE_PATH,
  CODE_OSS_NLS_MESSAGES_RELATIVE_PATH,
  CODE_OSS_PRODUCT_CONFIGURATION_RELATIVE_PATH,
] as const;
const CODE_OSS_FILE_PROTOCOL = "vscode-file";
const CODE_OSS_FILE_PROTOCOL_AUTHORITY = "vscode-app";
const CODE_OSS_WEBVIEW_PROTOCOL = "vscode-webview";
const CODE_OSS_WEBVIEW_RESOURCES = new Set(["index.html", "fake.html", "service-worker.js"]);
const CODE_OSS_NAVIGATION_TIMEOUT_MS = 30_000;
const CODE_OSS_DEFAULT_EXTENSIONS_GALLERY = {
  serviceUrl: "https://open-vsx.org/vscode/gallery",
  itemUrl: "https://open-vsx.org/vscode/item",
} as const;
// Bound warm sessions so detached Code-OSS renderers cannot accumulate without limit.
const MAX_WARM_CODE_SESSIONS = 2;
const DEFAULT_CODE_HOST_STATE_DIR = Path.join(
  process.env.TABS_HOME?.trim() || Path.join(OS.homedir(), ".tabs"),
  "userdata",
);

// Keep a small, append-only manager trace outside the renderer. In embedded
// mode the native WebContents can fail before it is visible to DevTools, so a
// file trace is the only reliable way to distinguish protocol/navigation
// failures from extension-host handshake failures.
const CODE_HOST_DIAGNOSTIC_LOG = Path.join(DEFAULT_CODE_HOST_STATE_DIR, "code-host-manager.log");
const codeHostDiagnosticSink = new RotatingFileSink({
  filePath: CODE_HOST_DIAGNOSTIC_LOG,
  maxBytes: 5 * 1024 * 1024,
  maxFiles: 2,
});
// Batch diagnostic writes away from the Electron main-process event loop.
let diagnosticQueue: string[] = [];
let diagnosticQueuedBytes = 0;
let droppedDiagnosticLines = 0;
let flushScheduled = false;
const MAX_DIAGNOSTIC_QUEUE_BYTES = 256 * 1024;
const MAX_DIAGNOSTIC_DETAIL_CHARS = 8 * 1024;

function formatDiagnosticDetails(details: unknown): string {
  const serialized = JSON.stringify(details, (_key, value: unknown) => {
    if (typeof value === "string" && value.length > 2_048) {
      return `${value.slice(0, 2_048)}… [truncated]`;
    }
    if (Array.isArray(value) && value.length > 50) {
      return [...value.slice(0, 50), `… ${value.length - 50} more items`];
    }
    return value;
  });
  if (serialized === undefined || serialized.length <= MAX_DIAGNOSTIC_DETAIL_CHARS) {
    return serialized ?? "";
  }
  return `${serialized.slice(0, MAX_DIAGNOSTIC_DETAIL_CHARS)}… [truncated]`;
}

function flushDiagnosticQueue(): void {
  flushScheduled = false;
  if (diagnosticQueue.length === 0 && droppedDiagnosticLines === 0) return;
  const droppedNotice =
    droppedDiagnosticLines > 0
      ? `${new Date().toISOString()} dropped ${droppedDiagnosticLines} Code host diagnostic lines because the async queue was full\n`
      : "";
  const chunk = `${droppedNotice}${diagnosticQueue.join("")}`;
  diagnosticQueue = [];
  diagnosticQueuedBytes = 0;
  droppedDiagnosticLines = 0;
  try {
    codeHostDiagnosticSink.write(chunk);
  } catch {
    // Diagnostics must never affect the host lifecycle.
  }
}

function writeCodeHostDiagnostic(message: string, details?: unknown): void {
  try {
    const formattedDetails = details === undefined ? "" : formatDiagnosticDetails(details);
    const suffix = formattedDetails.length === 0 ? "" : ` ${formattedDetails}`;
    const line = `${new Date().toISOString()} ${message}${suffix}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (diagnosticQueuedBytes + lineBytes <= MAX_DIAGNOSTIC_QUEUE_BYTES) {
      diagnosticQueue.push(line);
      diagnosticQueuedBytes += lineBytes;
    } else {
      droppedDiagnosticLines += 1;
    }
    if (!flushScheduled) {
      flushScheduled = true;
      setImmediate(flushDiagnosticQueue);
    }
  } catch {
    // Diagnostics must never affect the host lifecycle.
  }
}

export interface CodeHostConfig {
  state: DesktopCodeHostState;
  runtime: CodeHostRuntime | null;
  rootDir?: string;
}

type FsLike = Pick<typeof FS, "existsSync" | "readdirSync" | "statSync">;

type CodeHostRuntime = {
  kind: "desktop-renderer";
  vscodeRoot: string;
  stateDir: string;
};

type CodeSession = {
  generation: number;
  lastActivatedAt: number;
  projectId: string;
  workspaceRoot: string;
  view: WebContentsView | null;
  partition: string | null;
  bounds: Rectangle | null;
  lastFocusedPath: string | null;
  lastNavigationNonce: number;
  lastLoadedUrl: string | null;
  desktopLoadPending: boolean;
  entry: string | null;
  workspaceUri: string | null;
  desktopConfigChannel: string | null;
  desktopProtocolRegistered: boolean;
  runtimeStartPromise: Promise<CodeSessionRuntime> | null;
};

type DesktopRendererSessionRuntime = {
  kind: "desktop-renderer";
  entry: string;
  workspaceUri: string;
};

type CodeSessionRuntime = DesktopRendererSessionRuntime;

type UriComponent = {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
};

type DesktopUserDataProfile = {
  id: string;
  isDefault: boolean;
  name: string;
  location: UriComponent;
  globalStorageHome: UriComponent;
  settingsResource: UriComponent;
  keybindingsResource: UriComponent;
  tasksResource: UriComponent;
  snippetsHome: UriComponent;
  promptsHome: UriComponent;
  extensionsResource: UriComponent;
  mcpResource: UriComponent;
  languageModelsResource: UriComponent;
  agentPluginsHome: UriComponent;
  cacheHome: UriComponent;
};

type DesktopWindowConfiguration = {
  _: string[];
  "folder-uri"?: string[];
  "file-uri"?: string[];
  "disable-telemetry": boolean;
  "disable-updates": boolean;
  "skip-release-notes": boolean;
  "skip-welcome": boolean;
  "builtin-extensions-dir"?: string;
  "extensions-dir": string;
  extensionDevelopmentPath?: string[];
  windowId: number;
  appRoot: string;
  userEnv: NodeJS.ProcessEnv;
  product: Record<string, unknown>;
  zoomLevel: number;
  codeCachePath: string;
  nls: {
    messages: string[];
    language: string;
  };
  cssModules?: string[];
  mainPid: number;
  machineId: string;
  sqmId: string;
  devDeviceId: string;
  isPortable: boolean;
  execPath: string;
  backupPath?: string;
  profiles: {
    home: UriComponent;
    all: DesktopUserDataProfile[];
    profile: DesktopUserDataProfile;
  };
  homeDir: string;
  tmpDir: string;
  userDataDir: string;
  isSessionsWindow?: boolean;
  workspace: {
    id: string;
    uri?: UriComponent;
    configPath?: UriComponent;
  };
  logLevel: number;
  loggers: unknown[];
  logsPath: string;
  isInitialStartup: boolean;
  perfMarks: never[];
  os: {
    release: string;
    hostname: string;
    arch: string;
  };
  autoDetectHighContrast: boolean;
  autoDetectColorScheme: boolean;
  accessibilitySupport: boolean;
  colorScheme: {
    dark: boolean;
    highContrast: boolean;
  };
  policiesData: Record<string, never>;
};

const productConfigurationCache = new Map<string, Record<string, unknown>>();
const nlsMessagesCache = new Map<string, string[]>();
const cssModulesCache = new Map<string, string[]>();

function normalizeFilePath(input: string): string {
  return input.replace(/\\/g, "/");
}

export function getCodeOssContentType(pathname: string): string {
  switch (Path.extname(pathname).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

export async function readCodeOssProtocolFile(
  pathname: string,
  initialHeaders?: HeadersInit,
): Promise<Response> {
  const contents = await FS.promises.readFile(pathname);
  const headers = new Headers(initialHeaders);
  headers.set("Content-Type", getCodeOssContentType(pathname));
  return new Response(contents, { status: 200, headers });
}

function findDefaultWorkspaceFile(workspaceRoot: string): string | null {
  try {
    const candidates = [
      "README.md",
      "readme.md",
      "README.txt",
      "package.json",
      "index.ts",
      "index.js",
      "src/main.ts",
      "src/index.ts",
      "src/App.tsx",
      "src/App.jsx",
    ];
    for (const cand of candidates) {
      if (isFile(Path.join(workspaceRoot, cand), FS)) {
        return cand;
      }
    }
    const entries = FS.readdirSync(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith(".")) {
        return entry.name;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const CODE_OSS_EMBED_DEFAULT_SETTINGS: Record<string, unknown> = {
  "workbench.startupEditor": "none",
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "workbench.welcome.enabled": false,
  "workbench.tips.enabled": true,
  "workbench.editor.empty.hint": "hidden",
  // Tabs restores editors from its project-scoped workspace-tabs file. Native
  // workbench restoration is disabled so a stale editor-group snapshot cannot
  // reintroduce files from another Tabs project before that filtered restore.
  "workbench.editor.restoreEditors": false,
  // Code owns its complete stock workbench inside the Tabs Code tool. Keeping
  // these parts native avoids duplicating VS Code's layout and accessibility
  // behavior in the surrounding React shell.
  // Hide the stock activity bar from the first workbench frame. The Tabs
  // integration extension enforces the same value after activation, but using
  // "default" here briefly exposed extension icons (including ChatGPT/Codex)
  // during initial Code-OSS startup.
  "workbench.activityBar.location": "hidden",
  // Tabs supplies the outer activity rail. Code-OSS keeps ownership of the
  // corresponding views, commands, keyboard navigation, and sidebar content.
  "workbench.activityBar.visible": false,
  "workbench.statusBar.visible": true,
  "window.menuBarVisibility": "hidden",
  "window.titleBarStyle": "native",
  // A WebContentsView is still a native Electron workbench. Keep Code-OSS's
  // platform menu implementation instead of substituting its HTML menu layer.
  "window.menuStyle": "native",
  "window.customTitleBarVisibility": "never",
  "workbench.layoutControl.enabled": false,
  "window.commandCenter": false,
  // The embedded editor is a single-user local IDE driving the user's own
  // checkout — Workspace Trust prompts add nothing here and, more importantly,
  // an untrusted workspace can prevent the bundled Tabs integration extension
  // from activating.
  "security.workspace.trust.enabled": false,
  // Keep Code-OSS AI extensions enabled even when Tabs' own Agents surface is
  // selected. Changing this setting makes upstream Code-OSS stop and restart
  // the extension host, which cancels authentication and extension RPCs during
  // startup. The outer shell controls whether Copilot's auxiliary bar is
  // visible without changing extension enablement.
  "chat.disableAIFeatures": false,
  "chat.commandCenter.enabled": true,
  "workbench.secondarySideBar.defaultVisibility": "visible",
  // Open VSX signature archives are not Microsoft Marketplace repository
  // signatures. Some currently contain the Open VSX signature alongside an
  // empty legacy .signature.p7s, which Microsoft's verifier rejects before an
  // otherwise valid extension can be installed. Keep integrity checks at the
  // transport/package layer and do not apply the incompatible repository
  // signature policy to this gallery.
  "extensions.verifySignature": false,
  // Update discovery must remain enabled for gallery-managed extensions.
  // Disabling this makes the per-extension "Auto Update" toggle misleading:
  // Code-OSS cannot install an update it never discovers.
  "extensions.autoCheckUpdates": true,
  "extensions.autoUpdate": true,
};

// Older builds wrote cosmetic editor choices on every extension activation.
// They are not required by the embed and must remain user-controlled, just as
// they are in stock VS Code. Only remove a value when it still exactly matches
// the historical forced value; a user's different customization is preserved.
const LEGACY_FORCED_EDITOR_SETTINGS: Record<string, unknown> = {
  "workbench.editor.showTabs": "multiple",
  "workbench.editor.tabActionLocation": "right",
  "workbench.editor.tabSizing": "shrink",
  "breadcrumbs.enabled": false,
  "workbench.view.alwaysShowHeaderActions": true,
  "editor.fontFamily": '"Geist Mono", "Fira Code", monospace',
  "editor.fontSize": 13,
  "editor.lineHeight": 1.6,
  "editor.cursorStyle": "line",
  "editor.cursorWidth": 2,
  "editor.cursorSmoothCaretAnimation": "on",
  "editor.smoothScrolling": true,
  "workbench.list.smoothScrolling": true,
  "editor.minimap.autohide": true,
  "editor.minimap.scale": 1,
  "editor.scrollbar.verticalScrollbarSize": 4,
  "editor.scrollbar.horizontalScrollbarSize": 4,
  "editor.renderLineHighlight": "gutter",
  "editor.overviewRulerBorder": false,
  "editor.hideCursorInOverviewRuler": true,
};

function writeMergedJsonFile(pathname: string, patch: Record<string, unknown>): void {
  FS.mkdirSync(Path.dirname(pathname), { recursive: true });
  let current: Record<string, unknown> = {};
  if (isFile(pathname, FS)) {
    try {
      current = JSON.parse(FS.readFileSync(pathname, "utf8")) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }
  FS.writeFileSync(pathname, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, "utf8");
}

export function removeLegacyForcedEditorSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned = { ...settings };
  for (const [key, forcedValue] of Object.entries(LEGACY_FORCED_EDITOR_SETTINGS)) {
    if (JSON.stringify(cleaned[key]) === JSON.stringify(forcedValue)) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

type ExtensionRegistration = {
  identifier?: { id?: string };
  version?: string;
  location?: { fsPath?: string; path?: string };
  relativeLocation?: string;
  metadata?: { installedTimestamp?: number };
};

export function resolveCodeOssAiProviderSettings(
  _provider: "tabs" | "copilot",
): Record<string, unknown> {
  return {
    // This must remain false for both providers. `chat.disableAIFeatures` is a
    // global Code-OSS extension-enablement switch, not a view-visibility flag.
    "chat.disableAIFeatures": false,
    // Provider selection controls Tabs' overlay. It must not disable or hide
    // native extension views such as Copilot Chat, Claude Code, or Codex.
    "chat.commandCenter.enabled": true,
    "workbench.secondarySideBar.defaultVisibility": "visible",
  };
}

export function resolveCodeOssApplicationSettingsPaths(stateDir: string): string[] {
  return [
    Path.join(stateDir, "code-oss-main", "profile", "default", "settings.json"),
    Path.join(stateDir, "code-oss-desktop", "shared-profile", "default", "settings.json"),
  ];
}

function readExtensionRegistrations(pathname: string): ExtensionRegistration[] {
  try {
    const value = JSON.parse(FS.readFileSync(pathname, "utf8")) as unknown;
    return Array.isArray(value) ? (value as ExtensionRegistration[]) : [];
  } catch {
    return [];
  }
}

function resolveRegisteredExtensionPath(
  registration: ExtensionRegistration,
  extensionsDir: string,
): string | null {
  const configuredPath = registration.location?.fsPath ?? registration.location?.path;
  if (configuredPath) {
    return Path.resolve(configuredPath);
  }
  return registration.relativeLocation
    ? Path.resolve(extensionsDir, registration.relativeLocation)
    : null;
}

/**
 * Migrate per-workspace extension registrations into the shared native profile.
 * The extension files have always been shared; keeping the registry shared too
 * prevents one workspace from retaining a pointer to a version removed by
 * another workspace.
 */
export function reconcileSharedExtensionRegistry(stateDir: string): string {
  const desktopStateRoot = Path.join(stateDir, "code-oss-desktop");
  const extensionsDir = Path.join(desktopStateRoot, "extensions");
  const sharedRegistry = Path.join(
    desktopStateRoot,
    "shared-profile",
    "default",
    "extensions.json",
  );
  const registryPaths = new Set<string>([sharedRegistry]);

  try {
    for (const entry of FS.readdirSync(desktopStateRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      registryPaths.add(
        Path.join(desktopStateRoot, entry.name, "profile", "default", "extensions.json"),
      );
    }
  } catch {
    // The state root is created below on first launch.
  }

  const registrations = new Map<string, ExtensionRegistration>();
  for (const registryPath of registryPaths) {
    for (const registration of readExtensionRegistrations(registryPath)) {
      const id = registration.identifier?.id?.toLowerCase();
      const extensionPath = resolveRegisteredExtensionPath(registration, extensionsDir);
      if (!id || !extensionPath || !isFile(Path.join(extensionPath, "package.json"), FS)) {
        continue;
      }
      const current = registrations.get(id);
      if (
        !current ||
        (registration.metadata?.installedTimestamp ?? 0) >=
          (current.metadata?.installedTimestamp ?? 0)
      ) {
        registrations.set(id, registration);
      }
    }
  }

  FS.mkdirSync(Path.dirname(sharedRegistry), { recursive: true });
  const temporaryRegistry = `${sharedRegistry}.${process.pid}.${Crypto.randomUUID()}.tmp`;
  FS.writeFileSync(temporaryRegistry, JSON.stringify(Array.from(registrations.values())), "utf8");
  FS.renameSync(temporaryRegistry, sharedRegistry);
  return sharedRegistry;
}

function writeKeybindingsJsonFile(pathname: string, rules: Array<Record<string, unknown>>): void {
  FS.mkdirSync(Path.dirname(pathname), { recursive: true });
  let current: Array<Record<string, unknown>> = [];
  if (isFile(pathname, FS)) {
    try {
      current = JSON.parse(FS.readFileSync(pathname, "utf8")) as Array<Record<string, unknown>>;
      if (!Array.isArray(current)) {
        current = [];
      }
    } catch {
      current = [];
    }
  }
  const targetKeys = new Set(rules.map((r) => r.key));
  const filtered = current.filter((item) => !targetKeys.has(item.key));
  FS.writeFileSync(pathname, `${JSON.stringify([...filtered, ...rules], null, 2)}\n`, "utf8");
}

function getRequiredCodeOssPath(root: string, relativePath: string): string {
  return Path.join(root, relativePath);
}

function buildVsCodeFileUrl(pathname: string): string {
  const fileUrl = pathToFileURL(pathname);
  return new URL(
    `${fileUrl.pathname}${fileUrl.search}${fileUrl.hash}`,
    `${CODE_OSS_FILE_PROTOCOL}://${CODE_OSS_FILE_PROTOCOL_AUTHORITY}/`,
  ).toString();
}

function getCodeOssEmbedExtensionPath(baseDir: string): string {
  return resolveCodeOssExtensionPath(baseDir, "tabs-embed-defaults");
}

function getCodeOssIntegrationExtensionPath(baseDir: string): string {
  return resolveCodeOssExtensionPath(baseDir, "tabs-workbench-integration");
}

export function resolveCodeOssExtensionPath(
  baseDir: string,
  extensionDirectory: string,
  existsSync: (path: string) => boolean = FS.existsSync,
): string {
  const sourcePath = Path.resolve(
    baseDir,
    "..",
    "resources",
    "code-oss-extensions",
    extensionDirectory,
  );
  const packagedPath = Path.resolve(
    baseDir,
    "..",
    "prod-resources",
    "code-oss-extensions",
    extensionDirectory,
  );
  const unpackedPath = packagedPath.replace(
    `${Path.sep}app.asar${Path.sep}`,
    `${Path.sep}app.asar.unpacked${Path.sep}`,
  );

  for (const candidate of [unpackedPath, packagedPath, sourcePath]) {
    if (existsSync(candidate)) return candidate;
  }

  return sourcePath;
}

/**
 * Merge the embed's settings into a product.json's `configurationDefaults`.
 * Pure for testability. Returns the next product object and whether anything
 * actually changed (callers skip the disk write when unchanged).
 *
 * Product configuration defaults are applied before the native workbench's
 * profile and workspace configuration, avoiding first-run prompt races.
 */
export function mergeProductConfigurationDefaults(
  product: Record<string, unknown>,
  defaults: Record<string, unknown>,
): { product: Record<string, unknown>; changed: boolean } {
  const existing =
    typeof product.configurationDefaults === "object" && product.configurationDefaults !== null
      ? (product.configurationDefaults as Record<string, unknown>)
      : {};
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    return { product, changed: false };
  }
  return {
    product: {
      ...product,
      configurationDefaults: { ...existing, ...defaults },
    },
    changed: true,
  };
}

/**
 * Code - OSS deliberately ships without a marketplace. Tabs uses Open VSX,
 * matching other Code-OSS distributions, so installed gallery extensions can
 * be searched and updated. Preserve a gallery supplied by a branded runtime.
 */
export function addDefaultExtensionGallery(
  product: Record<string, unknown>,
): Record<string, unknown> {
  if (
    typeof product.extensionsGallery === "object" &&
    product.extensionsGallery !== null &&
    typeof (product.extensionsGallery as Record<string, unknown>).serviceUrl === "string"
  ) {
    return product;
  }
  return { ...product, extensionsGallery: CODE_OSS_DEFAULT_EXTENSIONS_GALLERY };
}

function isDirectory(pathname: string, fs: FsLike): boolean {
  return fs.existsSync(pathname) && fs.statSync(pathname).isDirectory();
}

function isFile(pathname: string, fs: FsLike): boolean {
  return fs.existsSync(pathname) && fs.statSync(pathname).isFile();
}

function hasCodeOssMarker(candidate: string, fs: FsLike): boolean {
  return [CODE_OSS_DESKTOP_PRELOAD_RELATIVE_PATH, CODE_OSS_DESKTOP_WORKBENCH_RELATIVE_PATH].some(
    (relativePath) => isFile(getRequiredCodeOssPath(candidate, relativePath), fs),
  );
}

function resolveVsCodeRootCandidate(candidate: string, fs: FsLike): string | null {
  const normalizedCandidate = Path.resolve(candidate);
  if (hasCodeOssMarker(normalizedCandidate, fs)) {
    return normalizedCandidate;
  }

  const parentCandidate = Path.dirname(normalizedCandidate);
  if (hasCodeOssMarker(parentCandidate, fs)) {
    return parentCandidate;
  }

  return null;
}

function createUnavailableState(reason: string): CodeHostConfig {
  return {
    state: {
      available: false,
      mode: "external",
      entry: null,
      reason,
    },
    runtime: null,
  };
}

function createAvailableState(input: {
  entry?: string | null;
  runtime: CodeHostRuntime | null;
  rootDir?: string;
}): CodeHostConfig {
  return {
    ...(input.rootDir ? { rootDir: input.rootDir } : {}),
    state: {
      available: true,
      mode: "embedded",
      entry: input.entry ?? null,
      reason: null,
    },
    runtime: input.runtime,
  };
}

function safeReadDirectoryNames(pathname: string, fs: FsLike): string[] {
  try {
    return fs
      .readdirSync(pathname, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function resolveWorkspaceRootForSession(
  requestedWorkspaceRoot: string,
  config: Pick<CodeHostConfig, "rootDir" | "runtime">,
  fs: FsLike,
): string {
  const normalizedRequestedRoot = Path.resolve(requestedWorkspaceRoot);
  if (isDirectory(normalizedRequestedRoot, fs)) {
    return normalizedRequestedRoot;
  }

  const basename = Path.basename(normalizedRequestedRoot);
  if (!basename) {
    return normalizedRequestedRoot;
  }

  const candidateRoots = new Set<string>();
  const candidatePaths = new Set<string>();
  const addRoot = (value: string | null | undefined) => {
    if (!value) return;
    candidateRoots.add(Path.resolve(value));
  };
  const addCandidate = (value: string | null | undefined) => {
    if (!value) return;
    candidatePaths.add(Path.resolve(value));
  };

  addRoot(Path.dirname(normalizedRequestedRoot));
  addRoot(config.rootDir ?? null);
  addRoot(config.rootDir ? Path.dirname(config.rootDir) : null);
  addRoot(config.rootDir ? Path.dirname(Path.dirname(config.rootDir)) : null);
  addRoot(config.runtime ? Path.dirname(config.runtime.vscodeRoot) : null);

  addCandidate(normalizedRequestedRoot);
  for (const root of candidateRoots) {
    if (Path.basename(root) === basename) {
      addCandidate(root);
    }
    addCandidate(Path.join(root, basename));
    for (const child of safeReadDirectoryNames(root, fs)) {
      addCandidate(Path.join(root, child, basename));
    }
  }

  for (const candidate of candidatePaths) {
    if (isDirectory(candidate, fs)) {
      return candidate;
    }
  }

  throw new Error(
    `The project folder no longer exists: ${normalizedRequestedRoot}. ` +
      "Update the project folder in Tabs or reopen the project before starting Code.",
  );
}

function resolveManagedDesktopRoot(
  candidate: string,
  fs: FsLike,
): { ok: true; vscodeRoot: string; stateDir: string } | { ok: false; reason: string } {
  const vscodeRoot = resolveVsCodeRootCandidate(candidate, fs);
  if (!vscodeRoot || !isDirectory(vscodeRoot, fs)) {
    return {
      ok: false,
      reason: `Configured Code-OSS build directory does not exist or is not a VS Code checkout: ${candidate}`,
    };
  }

  for (const relativePath of REQUIRED_CODE_OSS_DESKTOP_RELATIVE_PATHS) {
    const assetPath = getRequiredCodeOssPath(vscodeRoot, relativePath);
    if (!isFile(assetPath, fs)) {
      return {
        ok: false,
        reason: [
          "Code-OSS desktop runtime not found.",
          `Expected compiled asset: ${assetPath}`,
          `Build it with: \`cd ${vscodeRoot} && npm install && npm run compile\``,
          "Then restart the Tabs desktop app.",
        ].join(" "),
      };
    }
  }

  return {
    ok: true,
    vscodeRoot,
    stateDir: DEFAULT_CODE_HOST_STATE_DIR,
  };
}

function getDefaultResolutionFailureReason(rootDir: string): string {
  const expectedSiblingRoot = Path.join(rootDir, "..", "tabs-code-oss");
  const expectedAsset = Path.join(expectedSiblingRoot, CODE_OSS_DESKTOP_WORKBENCH_RELATIVE_PATH);
  return [
    "Code-OSS desktop runtime not found.",
    `Expected local VS Code checkout: ${expectedSiblingRoot}`,
    `Expected compiled asset: ${expectedAsset}`,
    "Build it with: `cd ../tabs-code-oss && npm install && npm run compile`",
    "Or set `TABS_CODE_OSS_BUILD_DIR` to the local `tabs-code-oss` checkout root.",
  ].join(" ");
}

export function resolveCodeHostConfigWithFs(
  input: {
    rootDir: string;
    env: NodeJS.ProcessEnv;
  },
  fs: FsLike,
): CodeHostConfig {
  const explicitBuildDir = input.env.TABS_CODE_OSS_BUILD_DIR?.trim() || null;
  if (explicitBuildDir) {
    const resolvedDesktopRoot = resolveManagedDesktopRoot(explicitBuildDir, fs);
    if (resolvedDesktopRoot.ok) {
      return createAvailableState({
        runtime: {
          kind: "desktop-renderer",
          vscodeRoot: resolvedDesktopRoot.vscodeRoot,
          stateDir: resolvedDesktopRoot.stateDir,
        },
        rootDir: input.rootDir,
      });
    }
    return createUnavailableState(resolvedDesktopRoot.reason);
  }

  // In packaged apps, process.resourcesPath points to the Resources directory
  // which contains tabs-code-oss as an unpacked directory
  const fallbackRoots = process.resourcesPath
    ? [
        // First try Resources/tabs-code-oss (packaged app location)
        Path.join(process.resourcesPath, "vscode-main"),
        Path.join(process.resourcesPath, "tabs-code-oss"),
        // Then try sibling directories (development)
        Path.join(input.rootDir, "..", "vscode-main"),
        Path.join(input.rootDir, "..", "tabs-code-oss"),
        Path.join(input.rootDir, "..", "vscode"),
      ]
    : [
        // Development mode fallbacks
        Path.join(input.rootDir, "..", "vscode-main"),
        Path.join(input.rootDir, "..", "tabs-code-oss"),
        Path.join(input.rootDir, "..", "vscode"),
      ];

  for (const fallbackRoot of fallbackRoots) {
    if (!isDirectory(fallbackRoot, fs)) {
      continue;
    }

    const resolvedDesktopRoot = resolveManagedDesktopRoot(fallbackRoot, fs);
    if (resolvedDesktopRoot.ok) {
      return createAvailableState({
        runtime: {
          kind: "desktop-renderer",
          vscodeRoot: resolvedDesktopRoot.vscodeRoot,
          stateDir: resolvedDesktopRoot.stateDir,
        },
        rootDir: input.rootDir,
      });
    }
  }

  return createUnavailableState(getDefaultResolutionFailureReason(input.rootDir));
}

export function resolveCodeHostConfig(input: {
  rootDir: string;
  env: NodeJS.ProcessEnv;
}): CodeHostConfig {
  return resolveCodeHostConfigWithFs(input, FS);
}

function buildDesktopSessionUrl(
  entry: string,
  session: Pick<
    CodeSession,
    "workspaceRoot" | "lastFocusedPath" | "lastNavigationNonce" | "projectId"
  >,
): string {
  const url = new URL(entry);
  url.searchParams.set("tabs_projectId", session.projectId);
  url.searchParams.set("tabs_workspaceRoot", session.workspaceRoot);
  url.searchParams.set("tabs_navigationNonce", String(session.lastNavigationNonce));
  if (session.lastFocusedPath) {
    url.searchParams.set("tabs_relativePath", normalizeFilePath(session.lastFocusedPath));
  } else {
    url.searchParams.delete("tabs_relativePath");
  }
  return url.toString();
}

export function getWorkspaceTabsFilePath(
  projectId: string,
  stateDir: string = DEFAULT_CODE_HOST_STATE_DIR,
): string {
  const safeId = projectId.trim() || "default";
  return Path.join(stateDir, `workspace-tabs-${safeId}.json`);
}

export function readWorkspaceTabs(
  projectId: string,
  stateDir: string = DEFAULT_CODE_HOST_STATE_DIR,
  fs: Pick<typeof FS, "readFileSync" | "existsSync"> = FS,
): CodeTabInfo[] | null {
  try {
    const filePath = getWorkspaceTabsFilePath(projectId, stateDir);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CodeTabInfo[]) : null;
  } catch {
    return null;
  }
}

export function writeWorkspaceTabs(
  projectId: string,
  tabs: CodeTabInfo[],
  stateDir: string = DEFAULT_CODE_HOST_STATE_DIR,
  fs: Pick<typeof FS, "mkdirSync" | "writeFileSync"> = FS,
): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const filePath = getWorkspaceTabsFilePath(projectId, stateDir);
    fs.writeFileSync(filePath, `${JSON.stringify(tabs, null, 2)}\n`, "utf8");
  } catch (err) {
    console.error(`[code-oss] failed to write workspace tabs for ${projectId}:`, err);
  }
}

export function isPathInsideWorkspace(workspaceRoot: string, filePath: string): boolean {
  const resolvedRoot = Path.resolve(workspaceRoot);
  const resolvedFile = Path.resolve(filePath);
  const relativePath = Path.relative(resolvedRoot, resolvedFile);
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${Path.sep}`) &&
    relativePath !== ".." &&
    !Path.isAbsolute(relativePath)
  );
}

export function shouldOpenCodeOssUrlExternally(url: string): boolean {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return (
      protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:" ||
      protocol === "tabs:"
    );
  } catch {
    return false;
  }
}

export function filterWorkspaceTabs(
  workspaceRoot: string,
  tabs: readonly CodeTabInfo[],
): CodeTabInfo[] {
  return tabs.filter((tab) => {
    const fullPath = Path.isAbsolute(tab.filePath)
      ? tab.filePath
      : Path.resolve(workspaceRoot, tab.filePath);
    return isPathInsideWorkspace(workspaceRoot, fullPath);
  });
}

export function resolveCodeOssNodeModulesResource(
  resourcePath: string,
  existsSync: (path: string) => boolean = FS.existsSync,
): string {
  if (existsSync(resourcePath)) return resourcePath;

  for (const asarDirectory of ["node_modules.asar.unpacked", "node_modules.asar"]) {
    const marker = `${Path.sep}${asarDirectory}${Path.sep}`;
    if (!resourcePath.includes(marker)) continue;

    const developmentPath = resourcePath.replace(marker, `${Path.sep}node_modules${Path.sep}`);
    if (existsSync(developmentPath)) return developmentPath;
  }

  return resourcePath;
}

export function resolveCodeOssWorkbenchTheme(themeId: string, customConfig?: any): string {
  return isLightDesktopTheme(themeId, customConfig)
    ? "Default Light Modern"
    : "Default Dark Modern";
}

export class CodeHostManager {
  private readonly sessions = new Map<string, CodeSession>();
  private readonly loadPromiseByProjectId = new Map<string, Promise<void>>();
  private readonly rendererDiagnosticLastSeen = new Map<string, number>();
  private nextSessionGeneration = 1;
  private activeProjectId: string | null = null;
  private currentThemeId: string = "tabs-dark";
  private currentCustomConfig: any = null;
  private disposed = false;
  private registerNativeWebContents:
    | ((
        webContents: Electron.WebContents,
        getBounds: () => Electron.Rectangle | null,
        projectId: string,
      ) => void)
    | null = null;

  setNativeWebContentsRegistrar(
    registrar:
      | ((
          webContents: Electron.WebContents,
          getBounds: () => Electron.Rectangle | null,
          projectId: string,
        ) => void)
      | null,
  ): void {
    this.registerNativeWebContents = registrar;
    if (registrar) {
      for (const session of this.sessions.values()) {
        if (session.view && !session.view.webContents.isDestroyed()) {
          registrar(
            session.view.webContents,
            () => session.view?.getBounds() ?? null,
            session.projectId,
          );
        }
      }
    }
  }

  private currentFontPreferences: any = null;
  private currentAiProvider: "tabs" | "copilot" = "tabs";

  setTheme(themeId: string, customConfig?: any, fontPreferences?: any): void {
    this.currentThemeId = themeId;
    this.currentCustomConfig = customConfig ?? null;
    this.currentFontPreferences = fontPreferences ?? null;
    const backgroundColor = this.isCurrentThemeLight() ? "#f8f8f8" : "#141414";
    for (const session of this.sessions.values()) {
      if (session.view && !session.view.webContents.isDestroyed()) {
        session.view.setBackgroundColor(backgroundColor);
      }
    }
  }

  private isCurrentThemeLight(): boolean {
    return resolveCodeOssWorkbenchTheme(this.currentThemeId, this.currentCustomConfig).includes(
      "Light",
    );
  }

  setAiProvider(provider: "tabs" | "copilot"): void {
    this.currentAiProvider = provider;
    const settingsPatch: Record<string, unknown> = {
      // Extension installation is owned by Code-OSS's main process, whose
      // application-scoped configuration comes from code-oss-main rather than
      // an individual project's profile. Keep this setting in both places so
      // Open VSX packages never fall back to Microsoft's repository-signature
      // verifier after a provider switch or a fresh application profile.
      "extensions.verifySignature": false,
      ...resolveCodeOssAiProviderSettings(provider),
    };
    const stateDir = this.config.runtime?.stateDir ?? DEFAULT_CODE_HOST_STATE_DIR;
    for (const settingsPath of resolveCodeOssApplicationSettingsPaths(stateDir)) {
      try {
        writeMergedJsonFile(settingsPath, settingsPatch);
        console.log(`[code-oss] updated AI provider settings (${provider}) → ${settingsPath}`);
      } catch (err) {
        console.error("[code-oss] failed to write AI provider settings", err);
      }
    }
  }

  private workspaceTabsDebounceTimers = new Map<string, NodeJS.Timeout>();

  handleChromeStateForTabs(projectId: string, state: CodeChromeState): void {
    if (!state.openTabs) return;

    const session = this.sessions.get(projectId);
    if (!session) return;

    const tabs = filterWorkspaceTabs(session.workspaceRoot, state.openTabs);
    const existingTimer = this.workspaceTabsDebounceTimers.get(projectId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.workspaceTabsDebounceTimers.delete(projectId);
    }

    if (tabs.length > 0) {
      const timer = setTimeout(() => {
        this.workspaceTabsDebounceTimers.delete(projectId);
        writeWorkspaceTabs(projectId, [...tabs]);
      }, 500);
      this.workspaceTabsDebounceTimers.set(projectId, timer);
    } else {
      // Empty tabs: stabilization delay (1000ms) to ensure intentional zero-tabs state
      const timer = setTimeout(() => {
        this.workspaceTabsDebounceTimers.delete(projectId);
        writeWorkspaceTabs(projectId, []);
      }, 1000);
      this.workspaceTabsDebounceTimers.set(projectId, timer);
    }
  }

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly config: CodeHostConfig,
    private readonly controlChannel?: CodeControlChannel,
    private readonly stackCoordinator?: NativeViewStackCoordinator,
    private readonly agentsWorkspace?: string,
  ) {
    this.controlChannel?.onChromeState((projectId, state) => {
      this.handleChromeStateForTabs(projectId, state);
    });

    this.controlChannel?.onExtensionHostConnected(async (projectId) => {
      // 1. Sync active theme
      if (this.currentFontPreferences) {
        this.controlChannel?.setTheme(
          this.currentThemeId,
          this.currentCustomConfig,
          this.currentFontPreferences,
        );
      } else {
        this.controlChannel?.setTheme(this.currentThemeId, this.currentCustomConfig);
      }

      // 2. Queue persisted tabs without artificial per-editor sleeps. The
      // control channel preserves message order, so inactive editors still
      // arrive before the active editor without extending startup linearly.
      const session = this.sessions.get(projectId);
      const savedTabs = readWorkspaceTabs(projectId);

      if (session && Array.isArray(savedTabs)) {
        const workspaceTabs = filterWorkspaceTabs(session.workspaceRoot, savedTabs);
        if (workspaceTabs.length !== savedTabs.length) {
          writeWorkspaceTabs(projectId, workspaceTabs);
        }
        if (workspaceTabs.length === 0) {
          // Explicit zero-tabs state persisted by user closing all tabs. Do not open fallback file.
          return;
        }

        const tabsToRestore = [...workspaceTabs];
        const inactiveTabs = tabsToRestore.filter((t) => !t.active);
        const activeTabs = tabsToRestore.filter((t) => t.active);

        // Open inactive tabs first with preserveFocus: true
        for (const tab of inactiveTabs) {
          const fullPath = Path.isAbsolute(tab.filePath)
            ? tab.filePath
            : Path.resolve(Path.join(session?.workspaceRoot ?? "", tab.filePath));
          const openOpts: {
            preview?: boolean;
            pinned?: boolean;
            preserveFocus?: boolean;
            viewColumn?: number;
          } = { preserveFocus: true };
          if (typeof tab.preview === "boolean") openOpts.preview = tab.preview;
          if (typeof tab.pinned === "boolean") openOpts.pinned = tab.pinned;
          if (typeof tab.viewColumn === "number") openOpts.viewColumn = tab.viewColumn;
          this.controlChannel?.openFile(projectId, fullPath, openOpts);
        }

        // Open active tab last with preserveFocus: false
        for (const tab of activeTabs) {
          const fullPath = Path.isAbsolute(tab.filePath)
            ? tab.filePath
            : Path.resolve(Path.join(session?.workspaceRoot ?? "", tab.filePath));
          const openOpts: {
            preview?: boolean;
            pinned?: boolean;
            preserveFocus?: boolean;
            viewColumn?: number;
          } = { preserveFocus: false };
          if (typeof tab.preview === "boolean") openOpts.preview = tab.preview;
          if (typeof tab.pinned === "boolean") openOpts.pinned = tab.pinned;
          if (typeof tab.viewColumn === "number") openOpts.viewColumn = tab.viewColumn;
          this.controlChannel?.openFile(projectId, fullPath, openOpts);
        }
        return;
      }

      // Fallback: if no persisted tab-list file exists, open lastFocusedPath if set
      if (!session?.lastFocusedPath) return;
      const fullFilePath = Path.resolve(Path.join(session.workspaceRoot, session.lastFocusedPath));
      this.controlChannel?.openFile(projectId, fullFilePath);
    });
  }

  ownsWebContents(id: number): boolean {
    return [...this.sessions.values()].some(
      (session) =>
        session.view &&
        !session.view.webContents.isDestroyed() &&
        session.view.webContents.id === id,
    );
  }

  async getState(): Promise<DesktopCodeHostState> {
    let version: string | null = null;
    if (this.config.runtime) {
      try {
        const metadata = JSON.parse(
          await FS.promises.readFile(
            Path.join(this.config.runtime.vscodeRoot, "package.json"),
            "utf8",
          ),
        ) as { version?: unknown };
        if (typeof metadata.version === "string" && metadata.version.trim()) {
          version = metadata.version;
        }
      } catch {
        // An unavailable version must not prevent reporting runtime availability.
      }
    }
    return { ...this.config.state, version };
  }

  async recreateSession(projectId: string): Promise<void> {
    const session = this.sessions.get(projectId);
    if (!session) return;

    session.entry = null;
    session.workspaceUri = null;
    session.runtimeStartPromise = null;
    session.lastLoadedUrl = null;
    session.desktopLoadPending = true;

    if (this.activeProjectId === projectId) {
      await this.loadSessionWhenVisible(session);
    }
  }

  async ensureSession(input: DesktopCodeHostEnsureSessionInput): Promise<void> {
    writeCodeHostDiagnostic(`[code-oss:${input.projectId}] ensureSession requested`, {
      workspaceRoot: input.workspaceRoot,
      available: this.config.state.available,
      runtimeRoot: this.config.runtime?.vscodeRoot ?? null,
    });
    console.log(`[code-oss:${input.projectId}] ensureSession requested`, {
      workspaceRoot: input.workspaceRoot,
      available: this.config.state.available,
      runtimeRoot: this.config.runtime?.vscodeRoot ?? null,
    });
    if (!this.config.state.available) {
      return;
    }

    const workspaceRoot = resolveWorkspaceRootForSession(input.workspaceRoot, this.config, FS);
    writeCodeHostDiagnostic(
      `[code-oss:${input.projectId}] resolved workspace root ${workspaceRoot}`,
    );
    console.log(`[code-oss:${input.projectId}] resolved workspace root`, workspaceRoot);

    const existing = this.sessions.get(input.projectId);
    if (existing) {
      const workspaceChanged = existing.workspaceRoot !== workspaceRoot;
      existing.workspaceRoot = workspaceRoot;
      if (workspaceChanged) {
        existing.entry = null;
        existing.workspaceUri = null;
        existing.runtimeStartPromise = null;
        existing.lastLoadedUrl = null;
        existing.desktopLoadPending = true;
        await this.loadSessionWhenVisible(existing);
      }
      return;
    }

    const partition = `persist:tabs-code-host:${input.projectId}`;
    const desktopRuntime = this.config.runtime;
    const desktopConfigChannel = desktopRuntime
      ? `vscode:tabs-window-config:${Crypto.randomUUID()}`
      : null;
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        partition,
        // Never throttle the workbench while the Code tab is hidden: a detached
        // view throttles timers, which stalls the workbench's startup lifecycle
        // (it can sit forever before "Restored"/"Eventually"), so extensions
        // gated on later activation phases never start and the editor resumes
        // half-initialized when the tab is shown again.
        backgroundThrottling: false,
        ...(desktopRuntime
          ? {
              preload: getRequiredCodeOssPath(
                desktopRuntime.vscodeRoot,
                CODE_OSS_DESKTOP_PRELOAD_RELATIVE_PATH,
              ),
              additionalArguments: [`--vscode-window-config=${desktopConfigChannel}`],
            }
          : null),
      },
    });
    this.registerNativeWebContents?.(view.webContents, () => view.getBounds(), input.projectId);
    view.setBackgroundColor(this.isCurrentThemeLight() ? "#f8f8f8" : "#141414");

    const allowedPermissions = new Set([
      "clipboard-read",
      "clipboard-write",
      "clipboard-sanitized-write",
      "pointerLock",
      "notifications",
    ]);
    if (view.webContents?.session) {
      view.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback(allowedPermissions.has(permission));
      });
      view.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
        return allowedPermissions.has(permission);
      });
    }

    // Keep the embedded editor fully inside Tabs: never let Code-OSS spawn a
    // separate window (e.g. cmd+shift+n "New Window"). Deny every new-window
    // request; genuinely external links open in the system browser instead.
    view.webContents.setWindowOpenHandler(({ url }) => {
      const isInternal =
        url === "about:blank" || /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url);
      if (!isInternal && shouldOpenCodeOssUrlExternally(url)) {
        void shell.openExternal(url).catch(() => {
          /* ignore */
        });
      }
      return { action: "deny" };
    });

    if (desktopConfigChannel) {
      ipcMain.handle(desktopConfigChannel, async () => {
        const startedAt = Date.now();
        writeCodeHostDiagnostic(`[code-oss:${input.projectId}] window configuration requested`);
        try {
          const configuration = this.buildDesktopWindowConfiguration(input.projectId);
          writeCodeHostDiagnostic(`[code-oss:${input.projectId}] window configuration resolved`, {
            durationMs: Date.now() - startedAt,
          });
          return configuration;
        } catch (error) {
          writeCodeHostDiagnostic(`[code-oss:${input.projectId}] window configuration failed`, {
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      });
    }

    const session: CodeSession = {
      generation: this.nextSessionGeneration++,
      lastActivatedAt: Date.now(),
      projectId: input.projectId,
      workspaceRoot,
      view,
      partition,
      bounds: null,
      lastFocusedPath: null,
      lastNavigationNonce: 0,
      lastLoadedUrl: null,
      desktopLoadPending: true,
      entry: null,
      workspaceUri: null,
      desktopConfigChannel,
      desktopProtocolRegistered: false,
      runtimeStartPromise: null,
    };
    this.sessions.set(input.projectId, session);
    this.registerDesktopDiagnostics(session);
    this.registerDesktopRequestDiagnostics(session);
    writeCodeHostDiagnostic(`[code-oss:${input.projectId}] embedded session created`, {
      webContentsId: view.webContents.id,
      configChannel: desktopConfigChannel,
    });
    console.log(`[code-oss:${input.projectId}] embedded session created`, {
      webContentsId: view.webContents.id,
      configChannel: desktopConfigChannel,
    });
    await this.loadSessionWhenVisible(session);
  }

  async activateSession(input: DesktopCodeHostActivateSessionInput): Promise<void> {
    writeCodeHostDiagnostic(`[code-oss:${input.projectId}] activateSession requested`);
    console.log(`[code-oss:${input.projectId}] activateSession requested`);
    if (!this.config.state.available) {
      writeCodeHostDiagnostic(
        `[code-oss:${input.projectId}] activateSession skipped: host unavailable`,
        this.config.state.reason,
      );
      console.warn(
        `[code-oss:${input.projectId}] activateSession skipped: host unavailable`,
        this.config.state.reason,
      );
      return;
    }

    const session = this.sessions.get(input.projectId);
    const generation = session?.generation;
    const window = this.getWindow();
    if (!session || !window) {
      writeCodeHostDiagnostic(
        `[code-oss:${input.projectId}] activateSession skipped: missing session/window`,
        {
          session: Boolean(session),
          window: Boolean(window),
        },
      );
      console.warn(
        `[code-oss:${input.projectId}] activateSession skipped: missing session/window`,
        {
          session: Boolean(session),
          window: Boolean(window),
        },
      );
      return;
    }

    const current = this.activeProjectId ? this.sessions.get(this.activeProjectId) : null;
    if (current && current.projectId !== session.projectId) {
      this.detachSession(current);
    }

    this.activeProjectId = session.projectId;
    session.lastActivatedAt = Date.now();
    if (session.bounds && session.view) {
      this.attachSession(session);
      session.view.setBounds(session.bounds);
    }
    await this.loadSessionWhenVisible(session);
    if (
      this.sessions.get(input.projectId) !== session ||
      session.generation !== generation ||
      !session.view ||
      session.view.webContents.isDestroyed()
    ) {
      writeCodeHostDiagnostic(`[code-oss:${input.projectId}] activation cancelled: stale session`);
      return;
    }
    if (session.lastLoadedUrl && this.controlChannel) {
      writeCodeHostDiagnostic(
        `[code-oss:${input.projectId}] waiting for integration extension host`,
      );
      console.log(`[code-oss:${input.projectId}] waiting for integration extension host`);
      // Extension activation must not hold the editor's visible/interactive
      // state hostage. Copilot, Claude and other providers become available
      // progressively after the workbench itself is usable.
      void this.controlChannel
        .waitForExtensionHost(session.projectId)
        .then(() => {
          if (this.sessions.get(input.projectId) !== session) return;
          writeCodeHostDiagnostic(
            `[code-oss:${input.projectId}] integration extension host connected`,
          );
          console.log(`[code-oss:${input.projectId}] integration extension host connected`);
        })
        .catch((error) => {
          if (this.sessions.get(input.projectId) !== session) return;
          writeCodeHostDiagnostic(`[code-oss:${input.projectId}] extension host wait failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    const cachedState = this.controlChannel?.getChromeState(session.projectId);
    if (cachedState && !window.isDestroyed()) {
      window.webContents.send(CODE_HOST_CHROME_STATE_CHANNEL, {
        projectId: session.projectId,
        state: cachedState,
      });
    }
    this.pruneWarmSessions();
  }

  private pruneWarmSessions(): void {
    if (this.sessions.size <= MAX_WARM_CODE_SESSIONS) return;
    const inactiveSessions = [...this.sessions.values()]
      .filter((session) => session.projectId !== this.activeProjectId)
      .toSorted((left, right) => left.lastActivatedAt - right.lastActivatedAt);
    while (this.sessions.size > MAX_WARM_CODE_SESSIONS && inactiveSessions.length > 0) {
      const session = inactiveSessions.shift();
      if (!session) break;
      writeCodeHostDiagnostic(`[code-oss:${session.projectId}] evicting cold session`);
      this.disposeSessionConfigChannel(session);
      this.disposeDesktopProtocols(session);
      session.view?.webContents.close({ waitForBeforeUnload: false });
      this.sessions.delete(session.projectId);
      this.loadPromiseByProjectId.delete(session.projectId);
    }
  }

  hideActiveSession(): void {
    if (!this.activeProjectId) return;
    const session = this.sessions.get(this.activeProjectId);
    if (session && session.view) {
      writeCodeHostDiagnostic(`[code-oss:${session.projectId}] hideActiveSession detach`);
      // Detaching a WebContentsView while Chromium is still navigating can
      // abort the main-frame request. Treat that as a cancelled, not a
      // successfully loaded, session so the next activation starts a clean
      // navigation instead of waiting forever for an extension host that can
      // never connect.
      if (session.view.webContents.isLoading()) {
        session.lastLoadedUrl = null;
        session.desktopLoadPending = true;
        session.view.webContents.stop();
        writeCodeHostDiagnostic(`[code-oss:${session.projectId}] cancelled pending navigation`);
      }
      this.detachSession(session);
    }
    this.activeProjectId = null;
  }

  async captureSession(projectId: string): Promise<string | null> {
    const session = this.sessions.get(projectId);
    if (!session?.view || session.view.webContents.isDestroyed()) return null;
    try {
      const image = await session.view.webContents.capturePage();
      return image.isEmpty() ? null : image.toDataURL();
    } catch (error) {
      writeCodeHostDiagnostic(`[code-oss:${projectId}] session capture failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Ask every connected embedded workbench to save its dirty editors before shutdown. */
  saveAllOpenSessions(): void {
    for (const projectId of this.sessions.keys()) {
      this.controlChannel?.runCommand(projectId, "workbench.action.files.saveAll");
    }
  }

  async openFile(input: DesktopCodeHostOpenFileInput): Promise<void> {
    if (!this.config.state.available) {
      return;
    }

    const session = this.sessions.get(input.projectId);
    if (!session) {
      return;
    }

    const normalizedRelativePath = normalizeFilePath(input.relativePath);
    const fullFilePath = Path.resolve(session.workspaceRoot, normalizedRelativePath);
    if (!isPathInsideWorkspace(session.workspaceRoot, fullFilePath)) {
      writeCodeHostDiagnostic(`[code-oss:${input.projectId}] rejected file outside workspace`, {
        relativePath: input.relativePath,
        workspaceRoot: session.workspaceRoot,
      });
      return;
    }
    const needsUpdate =
      session.lastFocusedPath !== normalizedRelativePath ||
      session.lastNavigationNonce !== input.navigationNonce ||
      input.lineNumber !== undefined;
    session.lastFocusedPath = normalizedRelativePath;
    session.lastNavigationNonce = input.navigationNonce;

    if (!needsUpdate) {
      return;
    }

    if (this.controlChannel) {
      const sent = this.controlChannel.openFile(input.projectId, fullFilePath, {
        lineNumber: input.lineNumber,
      });
      if (sent) {
        return;
      }
    }

    if (session.lastLoadedUrl === null) {
      session.desktopLoadPending = true;
      await this.loadSessionWhenVisible(session);
    }
  }

  setBounds(input: DesktopCodeHostSetBoundsInput): void {
    if (!this.config.state.available) {
      return;
    }
    const session = this.sessions.get(input.projectId);
    if (!session) {
      return;
    }

    if (!input.visible || input.width <= 0 || input.height <= 0) {
      writeCodeHostDiagnostic(`[code-oss:${input.projectId}] setBounds hidden`, {
        width: input.width,
        height: input.height,
        activeProjectId: this.activeProjectId,
      });
      session.bounds = null;
      if (this.activeProjectId === input.projectId) {
        this.detachSession(session);
      }
      return;
    }

    const mainWindow = this.getWindow();
    const mainWebContents = mainWindow?.webContents as { getZoomFactor?: () => number } | undefined;
    const zoomFactor =
      typeof mainWebContents?.getZoomFactor === "function" ? mainWebContents.getZoomFactor() : 1.0;

    let x = Math.round(input.x * zoomFactor);
    let y = Math.round(input.y * zoomFactor);
    let width = Math.round(input.width * zoomFactor);
    let height = Math.round(input.height * zoomFactor);

    const isDestroyed =
      typeof mainWindow?.isDestroyed === "function" ? mainWindow.isDestroyed() : false;
    const getContentSize =
      typeof mainWindow?.getContentSize === "function"
        ? mainWindow.getContentSize.bind(mainWindow)
        : null;

    if (mainWindow && !isDestroyed && getContentSize) {
      try {
        const [contentWidth, contentHeight] = getContentSize();
        if (typeof contentWidth === "number" && typeof contentHeight === "number") {
          const rightEdgeDip = Math.round((input.x + input.width) * zoomFactor);
          if (Math.abs(contentWidth - rightEdgeDip) <= 12) {
            width = Math.max(0, contentWidth - x);
          }
          const bottomEdgeDip = Math.round((input.y + input.height) * zoomFactor);
          if (Math.abs(contentHeight - bottomEdgeDip) <= 12) {
            height = Math.max(0, contentHeight - y);
          }
        }
      } catch {
        /* ignore */
      }
    }

    session.bounds = { x, y, width, height };

    if (session.view) {
      const viewWebContents = session.view.webContents as
        | {
            getZoomFactor?: () => number;
            setZoomFactor?: (factor: number) => void;
          }
        | undefined;
      const currentZoom =
        typeof viewWebContents?.getZoomFactor === "function"
          ? viewWebContents.getZoomFactor()
          : 1.0;
      if (
        Math.abs(currentZoom - zoomFactor) > 0.001 &&
        typeof viewWebContents?.setZoomFactor === "function"
      ) {
        viewWebContents.setZoomFactor(zoomFactor);
      }
    }

    if (this.activeProjectId === input.projectId) {
      this.attachSession(session);
      session.view?.setBounds(session.bounds);
      void this.loadSessionWhenVisible(session);
    }
  }

  syncSessions(projectIds: readonly string[]): void {
    writeCodeHostDiagnostic("[code-oss] syncSessions", {
      projectIds: [...projectIds],
      sessions: [...this.sessions.keys()],
      activeProjectId: this.activeProjectId,
    });
    const allowed = new Set(projectIds);
    for (const [projectId, session] of this.sessions) {
      if (allowed.has(projectId)) continue;
      writeCodeHostDiagnostic(`[code-oss:${projectId}] syncSessions closing session`, {
        active: this.activeProjectId === projectId,
      });
      if (this.activeProjectId === projectId) {
        if (session.view) {
          this.detachSession(session);
        }
        this.activeProjectId = null;
      }
      this.disposeSessionConfigChannel(session);
      this.disposeDesktopProtocols(session);
      session.view?.webContents.close({ waitForBeforeUnload: false });
      this.sessions.delete(projectId);
    }
  }

  async flushAndShutdownSessions(): Promise<void> {
    this.disposed = true;
    this.hideActiveSession();

    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();

    await Promise.all(
      sessions.map(async (session) => {
        if (session.view && !session.view.webContents.isDestroyed()) {
          try {
            // Invoke Code-OSS's official IWorkbench.shutdown() path.
            //
            // The workbench entry point (workbench.ts) exposes a global
            // `window.__tabs_codehost_shutdown()` that calls the IDisposable
            // returned by `create()`. Disposing it triggers:
            //   IWorkbench.shutdown()
            //   → BrowserLifecycleService.shutdown()
            //   → storageService.flush(WillSaveStateReason.SHUTDOWN)
            //   → IndexedDB transactions are committed to LevelDB on disk.
            //
            // This is the correct flush path; a synthetic `beforeunload` event
            // would only hit onBeforeUnload() → doShutdown() which fires
            // storageService.flush() optimistically (fire-and-forget) and
            // cannot be awaited from the main process.
            await session.view.webContents.executeJavaScript(
              `(async () => {
                const fn = window.__tabs_codehost_shutdown;
                if (typeof fn === 'function') {
                  const res = fn();
                  if (res instanceof Promise) {
                    await res;
                  }
                }
                return true;
              })()`,
            );
          } catch {
            /* best effort — if the webcontents crashes or the page hasn't loaded yet, continue */
          }

          try {
            // After Code-OSS has flushed its own storage, tell Chromium to
            // flush the partition's DOMStorage (localStorage) to disk too.
            // Note: flushStorageData() covers DOMStorage/localStorage only;
            // IndexedDB flushing is handled by the shutdown() call above.
            if (session.view.webContents.session) {
              await session.view.webContents.session.flushStorageData();
            }
          } catch {
            /* best effort */
          }

          try {
            session.view.webContents.close({ waitForBeforeUnload: false });
          } catch {
            /* best effort */
          }
        }

        this.disposeSessionConfigChannel(session);
        this.disposeDesktopProtocols(session);
      }),
    );
  }

  dispose(): void {
    void this.flushAndShutdownSessions().catch(() => undefined);
  }

  disableEmbeddedHost(reason: string): void {
    writeCodeHostDiagnostic("[code-oss] disableEmbeddedHost", {
      reason,
      sessions: [...this.sessions.keys()],
    });
    this.hideActiveSession();
    for (const session of this.sessions.values()) {
      this.disposeSessionConfigChannel(session);
      this.disposeDesktopProtocols(session);
      session.view?.webContents.close({ waitForBeforeUnload: false });
    }
    this.sessions.clear();
    this.config.runtime = null;
    this.config.state.available = false;
    this.config.state.entry = null;
    this.config.state.reason = reason;
  }

  /**
   * Adopt a newly-resolved runtime/state (e.g. after the Code-OSS runtime
   * finished downloading on a thin install). Clears existing sessions and
   * mutates the held config in place so callers keep a valid reference.
   */
  reconfigure(config: CodeHostConfig): void {
    writeCodeHostDiagnostic("[code-oss] reconfigure", {
      available: config.state.available,
      sessions: [...this.sessions.keys()],
    });
    this.hideActiveSession();
    for (const session of this.sessions.values()) {
      this.disposeSessionConfigChannel(session);
      this.disposeDesktopProtocols(session);
      session.view?.webContents.close({ waitForBeforeUnload: false });
    }
    this.sessions.clear();
    this.config.runtime = config.runtime;
    this.config.state.available = config.state.available;
    this.config.state.mode = config.state.mode;
    this.config.state.entry = config.state.entry;
    this.config.state.reason = config.state.reason;
    if (config.rootDir) {
      this.config.rootDir = config.rootDir;
    }
  }

  private async loadSession(session: CodeSession): Promise<void> {
    const existing = this.loadPromiseByProjectId.get(session.projectId);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const loadStartedAt = Date.now();
      try {
        const runtime = await this.ensureSessionRuntime(session);
        if (!this.agentsWorkspace && !session.lastFocusedPath) {
          session.lastFocusedPath = findDefaultWorkspaceFile(session.workspaceRoot);
        }
        const nextUrl = buildDesktopSessionUrl(runtime.entry, session);
        if (session.lastLoadedUrl === nextUrl) {
          writeCodeHostDiagnostic(`[code-oss:${session.projectId}] session already loaded`);
          console.log(`[code-oss:${session.projectId}] session already loaded`);
          return;
        }
        const desktopRuntime = this.config.runtime;
        if (!desktopRuntime) {
          throw new Error("Desktop Code-OSS runtime is unavailable.");
        }
        this.ensureDesktopProtocol(session, desktopRuntime);
        session.desktopLoadPending = false;
        if (!session.view) {
          throw new Error("Embedded Code-OSS session view is unavailable.");
        }
        writeCodeHostDiagnostic(`[code-oss:${session.projectId}] loading workbench ${nextUrl}`);
        console.log(`[code-oss:${session.projectId}] loading workbench`, nextUrl);
        const loadRequest = session.view.webContents.loadURL(nextUrl);
        let timeoutHandle: NodeJS.Timeout | null = null;
        try {
          await Promise.race([
            loadRequest,
            new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(
                  new Error(
                    `Code-OSS workbench navigation timed out after ${CODE_OSS_NAVIGATION_TIMEOUT_MS}ms.`,
                  ),
                );
              }, CODE_OSS_NAVIGATION_TIMEOUT_MS);
            }),
          ]);
        } catch (error) {
          session.lastLoadedUrl = null;
          session.desktopLoadPending = true;
          if (!session.view.webContents.isDestroyed()) {
            session.view.webContents.stop();
          }
          await loadRequest.catch(() => undefined);
          throw error;
        } finally {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
        }
        session.lastLoadedUrl = nextUrl;
        writeCodeHostDiagnostic(`[code-oss:${session.projectId}] workbench loadURL resolved`, {
          durationMs: Date.now() - loadStartedAt,
        });
        console.log(`[code-oss:${session.projectId}] workbench loadURL resolved`);
      } catch (error) {
        writeCodeHostDiagnostic(`[code-oss:${session.projectId}] workbench load failed`, error);
        console.error(`[code-oss:${session.projectId}] workbench load failed`, error);
        throw error;
      } finally {
        this.loadPromiseByProjectId.delete(session.projectId);
      }
    })();

    this.loadPromiseByProjectId.set(session.projectId, promise);
    return promise;
  }

  private async loadSessionWhenVisible(session: CodeSession): Promise<void> {
    const runtime = this.config.runtime;
    if (!runtime) {
      return;
    }

    if (!session.desktopLoadPending) {
      return;
    }

    const isActive = this.activeProjectId === session.projectId;
    const hasBounds = Boolean(
      session.bounds && session.bounds.width > 0 && session.bounds.height > 0,
    );
    if (!isActive || !hasBounds) {
      return;
    }

    await this.loadSession(session);
  }

  private async ensureSessionRuntime(session: CodeSession): Promise<CodeSessionRuntime> {
    if (!this.config.state.available) {
      throw new Error(this.config.state.reason ?? "Code-OSS is unavailable.");
    }

    const runtime = this.config.runtime;
    if (!runtime) {
      throw new Error("Desktop Code-OSS runtime is unavailable.");
    }

    if (session.entry && session.workspaceUri) {
      return {
        kind: "desktop-renderer",
        entry: session.entry,
        workspaceUri: session.workspaceUri,
      };
    }

    if (session.runtimeStartPromise) {
      return session.runtimeStartPromise;
    }

    session.runtimeStartPromise = Promise.resolve(this.startDesktopRenderer(runtime, session))
      .then((runtime) => {
        session.entry = runtime.entry;
        session.workspaceUri = runtime.workspaceUri;
        this.config.state.entry = runtime.entry;
        this.config.state.reason = null;
        return runtime;
      })
      .catch((error) => {
        session.runtimeStartPromise = null;
        this.config.state.available = false;
        this.config.state.reason = error instanceof Error ? error.message : String(error);
        if (this.config.state.entry === session.entry) {
          this.config.state.entry = null;
        }
        throw error;
      });

    return session.runtimeStartPromise;
  }

  private startDesktopRenderer(
    runtime: Extract<CodeHostRuntime, { kind: "desktop-renderer" }>,
    session: CodeSession,
  ): DesktopRendererSessionRuntime {
    if (!session.desktopConfigChannel) {
      throw new Error("Missing desktop Code-OSS configuration channel.");
    }

    return {
      kind: "desktop-renderer",
      entry: buildVsCodeFileUrl(
        getRequiredCodeOssPath(
          runtime.vscodeRoot,
          this.agentsWorkspace
            ? Path.join("out", "vs", "sessions", "electron-browser", "sessions-dev.html")
            : CODE_OSS_DESKTOP_WORKBENCH_RELATIVE_PATH,
        ),
      ),
      workspaceUri: pathToFileURL(session.workspaceRoot).toString(),
    };
  }

  public focusSession(projectId: string): void {
    const session = this.sessions.get(projectId);
    if (!session || !session.view) return;
    session.view.webContents.focus?.();
  }

  private attachSession(session: CodeSession): void {
    const window = this.getWindow();
    if (!window || !session.view) return;
    if (this.stackCoordinator) {
      this.stackCoordinator.attachToolView(session.view);
    } else if (!window.contentView.children.includes(session.view)) {
      window.contentView.addChildView(session.view);
    }
    session.view.webContents.focus?.();
  }

  private detachSession(session: CodeSession): void {
    const window = this.getWindow();
    if (!window || !session.view) return;
    if (this.stackCoordinator) {
      this.stackCoordinator.detachToolView(session.view);
    } else if (window.contentView.children.includes(session.view)) {
      window.contentView.removeChildView(session.view);
    }
    // Keep background throttling enabled. Foreground contents are unaffected,
    // while disabling it on any view can unthrottle the entire BrowserWindow.
    try {
      session.view.webContents.setBackgroundThrottling(true);
    } catch {
      // Best-effort
    }
  }

  private disposeSessionConfigChannel(session: CodeSession): void {
    if (!session.desktopConfigChannel) {
      return;
    }
    ipcMain.removeHandler(session.desktopConfigChannel);
    session.desktopConfigChannel = null;
  }

  private disposeDesktopProtocols(session: CodeSession): void {
    if (!session.desktopProtocolRegistered || !session.view?.webContents.session) {
      return;
    }

    const browserSession = session.view.webContents.session;
    for (const scheme of [CODE_OSS_FILE_PROTOCOL, CODE_OSS_WEBVIEW_PROTOCOL]) {
      if (browserSession.protocol.isProtocolHandled(scheme)) {
        browserSession.protocol.unhandle(scheme);
      }
    }
    session.desktopProtocolRegistered = false;
    writeCodeHostDiagnostic(`[code-oss:${session.projectId}] desktop protocols removed`, {
      partition: session.partition,
    });
  }

  private ensureDesktopProtocol(
    session: CodeSession,
    runtime: Extract<CodeHostRuntime, { kind: "desktop-renderer" }>,
  ): void {
    if (session.desktopProtocolRegistered) {
      return;
    }
    if (!session.view) {
      throw new Error("Desktop Code-OSS WebContentsView is unavailable.");
    }

    const browserSession = session.view.webContents.session;
    const prefix = `[code-oss:${session.projectId}]`;
    const allowedRoots = this.getDesktopAllowedRoots(session);
    // Persistent Electron sessions outlive their WebContents. A renderer
    // reload can therefore leave an earlier handler behind even though its
    // owning CodeSession has already gone away. Replace stale handlers before
    // registering the new session's roots and runtime.
    for (const scheme of [CODE_OSS_FILE_PROTOCOL, CODE_OSS_WEBVIEW_PROTOCOL]) {
      if (browserSession.protocol.isProtocolHandled(scheme)) {
        browserSession.protocol.unhandle(scheme);
      }
    }
    // Electron 40 still exposes registerFileProtocol, but it is deprecated and
    // can leave a WebContentsView navigation pending when the handler is owned
    // by a non-default persistent session. The promise-based handler commits a
    // real Response and lets Chromium finish the document request reliably.
    browserSession.protocol.handle(CODE_OSS_FILE_PROTOCOL, async (request) => {
      const resolvedPath = this.resolveDesktopProtocolPath(request, allowedRoots);
      if (!resolvedPath) {
        return new Response(null, { status: 404, statusText: "Not Found" });
      }

      try {
        // Do not route local workbench resources back through Chromium's
        // `session.fetch(file://...)`. Custom partitions intermittently return
        // an empty body for file URLs (most visibly Oniguruma WASM and worker
        // modules), even though the file exists. The stock vscode-file provider
        // reads from disk too; doing so here preserves exact bytes and MIME.
        return await readCodeOssProtocolFile(
          resolvedPath,
          this.buildDesktopProtocolHeaders(request.url, resolvedPath, runtime),
        );
      } catch (error) {
        writeCodeHostDiagnostic(`${prefix} protocol-read-error`, {
          url: request.url,
          resolvedPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response(null, { status: 404, statusText: "Not Found" });
      }
    });

    // The stock Electron main process normally installs this handler through
    // WebviewMainService. Tabs owns the Electron main process, so native
    // workbench webviews (extension READMEs, changelogs, and extension UIs)
    // need the equivalent endpoint in the embedded session.
    browserSession.protocol.handle(CODE_OSS_WEBVIEW_PROTOCOL, async (request) => {
      try {
        const resourceName = Path.posix.basename(new URL(request.url).pathname);
        if (!CODE_OSS_WEBVIEW_RESOURCES.has(resourceName)) {
          return new Response(null, { status: 404, statusText: "Not Found" });
        }
        const resourcePath = Path.join(
          runtime.vscodeRoot,
          "out",
          "vs",
          "workbench",
          "contrib",
          "webview",
          "browser",
          "pre",
          resourceName,
        );
        return await readCodeOssProtocolFile(resourcePath, {
          "Cross-Origin-Resource-Policy": "cross-origin",
        });
      } catch {
        return new Response(null, { status: 404, statusText: "Not Found" });
      }
    });

    session.desktopProtocolRegistered = true;
    writeCodeHostDiagnostic(`${prefix} desktop protocols registered`, {
      partition: session.partition,
    });
    this.config.state.entry = session.entry;
  }

  private buildDesktopProtocolHeaders(
    requestUrl: string,
    resolvedPath: string,
    runtime: Extract<CodeHostRuntime, { kind: "desktop-renderer" }>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    };

    if (
      resolvedPath.startsWith(Path.join(runtime.vscodeRoot, ".build", "extensions")) ||
      resolvedPath.startsWith(Path.join(runtime.vscodeRoot, "extensions"))
    ) {
      headers["Access-Control-Allow-Origin"] = "*";
    }

    return headers;
  }

  private getDesktopAllowedRoots(session: CodeSession): string[] {
    const runtime = this.config.runtime;
    if (!runtime) {
      return [session.workspaceRoot];
    }

    const sessionStateRoot = this.getDesktopSessionStateRoot(session.projectId, runtime.stateDir);
    return [
      runtime.vscodeRoot,
      Path.join(runtime.vscodeRoot, "extensions"),
      Path.join(runtime.vscodeRoot, ".build", "extensions"),
      session.workspaceRoot,
      sessionStateRoot,
      // Shared (user-global) extensions live outside the per-project session
      // root, so they must be allowlisted explicitly or the workbench can't load
      // installed extensions' icons/webview assets through the file protocol.
      this.getDesktopSharedExtensionsDir(runtime.stateDir),
      getCodeOssEmbedExtensionPath(__dirname),
    ]
      .map((pathname) => Path.resolve(pathname))
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  private resolveDesktopProtocolPath(
    request: Pick<ProtocolRequest, "url">,
    allowedRoots: readonly string[],
  ): string | null {
    try {
      const parsed = new URL(request.url);
      if (parsed.protocol !== `${CODE_OSS_FILE_PROTOCOL}:`) {
        return null;
      }

      const fileUrl = new URL(`file://${parsed.pathname}${parsed.search}${parsed.hash}`);
      let resolvedPath = Path.resolve(fileURLToPath(fileUrl));
      // Packaged Code-OSS emits both `.asar` and `.asar.unpacked` resource
      // URLs. Downloaded and development runtimes are ordinary source trees,
      // where those dependencies live under `node_modules`.
      resolvedPath = resolveCodeOssNodeModulesResource(resolvedPath);
      if (
        allowedRoots.some((root) => {
          const relativePath = Path.relative(root, resolvedPath);
          return (
            relativePath === "" ||
            (!relativePath.startsWith("..") && !Path.isAbsolute(relativePath))
          );
        })
      ) {
        return resolvedPath;
      }
    } catch {
      return null;
    }

    return null;
  }

  private buildDesktopWindowConfiguration(projectId: string): DesktopWindowConfiguration {
    const session = this.sessions.get(projectId);
    const runtime = this.config.runtime;
    if (!session || !runtime || !session.view) {
      throw new Error("Desktop Code-OSS runtime is unavailable.");
    }

    const sessionStateRoot = this.getDesktopSessionStateRoot(projectId, runtime.stateDir);
    const sharedExtensionsDir = this.getDesktopSharedExtensionsDir(runtime.stateDir);
    const sharedExtensionsRegistry = reconcileSharedExtensionRegistry(runtime.stateDir);
    const profileRoot = Path.join(runtime.stateDir, "code-oss-desktop", "shared-profile");
    const profile = this.ensureDesktopUserDataProfile(profileRoot, sharedExtensionsRegistry);
    const focusedFilePath = session.lastFocusedPath
      ? Path.join(session.workspaceRoot, session.lastFocusedPath)
      : null;
    const embedExtensionPath = getCodeOssEmbedExtensionPath(__dirname);
    const integrationExtensionPath = getCodeOssIntegrationExtensionPath(__dirname);
    const builtInExtensionsDir = Path.join(runtime.vscodeRoot, ".build", "extensions");

    FS.mkdirSync(Path.join(sessionStateRoot, "logs"), { recursive: true });
    FS.mkdirSync(Path.join(sessionStateRoot, "cache"), { recursive: true });
    FS.mkdirSync(sharedExtensionsDir, { recursive: true });

    const configuration: DesktopWindowConfiguration = {
      _: [],
      "folder-uri": [pathToFileURL(session.workspaceRoot).toString()],
      "disable-telemetry": true,
      "disable-updates": true,
      "skip-release-notes": true,
      "skip-welcome": true,
      "extensions-dir": sharedExtensionsDir,
      windowId: session.view.webContents.id,
      appRoot: runtime.vscodeRoot,
      userEnv: {
        VSCODE_CWD: session.workspaceRoot,
        // Identify this project's extension host on the shared control channel so
        // the native chrome routes commands to the right editor. Without it the
        // integration extension announces an empty projectId and the broker can't
        // match it, leaving every chrome button a silent no-op.
        TABS_PROJECT_ID: projectId,
        ...(process.env.TABS_CODE_CONTROL_URL
          ? { TABS_CODE_CONTROL_URL: process.env.TABS_CODE_CONTROL_URL }
          : null),
        // The extension prefers the live URL file (it survives a main-process
        // restart on a new port); forward it alongside the launch-time URL.
        ...(process.env.TABS_CODE_CONTROL_FILE
          ? { TABS_CODE_CONTROL_FILE: process.env.TABS_CODE_CONTROL_FILE }
          : null),
      },
      product: this.getProductConfiguration(runtime.vscodeRoot),
      zoomLevel: 0,
      codeCachePath: Path.join(sessionStateRoot, "cache"),
      nls: {
        messages: this.getNlsMessages(runtime.vscodeRoot),
        language: "en",
      },
      cssModules: this.getCssModules(runtime.vscodeRoot),
      mainPid: process.pid,
      machineId: this.hashDesktopIdentity(`machine:${runtime.vscodeRoot}`),
      sqmId: this.hashDesktopIdentity(`sqm:${runtime.vscodeRoot}`),
      devDeviceId: this.hashDesktopIdentity(`dev:${runtime.vscodeRoot}`),
      isPortable: false,
      execPath: process.execPath,
      profiles: {
        home: this.toFileUriComponent(Path.join(profileRoot, "profiles")),
        all: [profile],
        profile,
      },
      homeDir: OS.homedir(),
      tmpDir: OS.tmpdir(),
      userDataDir: sessionStateRoot,
      ...(this.agentsWorkspace ? { isSessionsWindow: true } : {}),
      workspace: {
        id: this.hashDesktopIdentity(`workspace:${this.agentsWorkspace ?? session.workspaceRoot}`),
        ...(this.agentsWorkspace
          ? { configPath: this.toFileUriComponent(this.agentsWorkspace) }
          : { uri: this.toFileUriComponent(session.workspaceRoot) }),
      },
      logLevel: 2,
      loggers: [],
      logsPath: Path.join(sessionStateRoot, "logs"),
      isInitialStartup: false,
      perfMarks: [],
      os: {
        release: OS.release(),
        hostname: OS.hostname(),
        arch: OS.arch(),
      },
      autoDetectHighContrast: true,
      autoDetectColorScheme: true,
      accessibilitySupport: false,
      colorScheme: {
        dark: nativeTheme.shouldUseDarkColors,
        highContrast: nativeTheme.shouldUseHighContrastColors,
      },
      policiesData: {},
    };

    if (focusedFilePath) {
      configuration["file-uri"] = [pathToFileURL(focusedFilePath).toString()];
    }

    if (isDirectory(builtInExtensionsDir, FS)) {
      configuration["builtin-extensions-dir"] = builtInExtensionsDir;
    }

    configuration.extensionDevelopmentPath = [embedExtensionPath, integrationExtensionPath].filter(
      (extensionPath) => isDirectory(extensionPath, FS),
    );

    return configuration;
  }

  private getDesktopSessionStateRoot(projectId: string, stateDir: string): string {
    return Path.join(stateDir, "code-oss-desktop", projectId);
  }

  /**
   * Extensions install location, shared by every project window — mirrors real
   * VS Code, where the extensions dir is per-user, not per-folder. Lives beside
   * the per-project session roots so installing an extension in one project
   * makes it available in all of them (per-project enablement state still lives
   * in each project's userDataDir). This is deliberately NOT under a projectId.
   */
  private getDesktopSharedExtensionsDir(stateDir: string): string {
    return Path.join(stateDir, "code-oss-desktop", "extensions");
  }

  private ensureDesktopUserDataProfile(
    profileRoot: string,
    sharedExtensionsRegistry: string,
  ): DesktopUserDataProfile {
    const location = Path.join(profileRoot, "default");
    const cacheHome = Path.join(profileRoot, "cache");
    for (const pathname of [location, cacheHome]) {
      FS.mkdirSync(pathname, { recursive: true });
    }
    for (const pathname of [
      Path.join(location, "snippets"),
      Path.join(location, "prompts"),
      Path.join(location, "agentPlugins"),
      Path.join(location, "globalStorage"),
    ]) {
      FS.mkdirSync(pathname, { recursive: true });
    }
    try {
      const desktopSettingsPath = Path.join(location, "settings.json");
      if (isFile(desktopSettingsPath, FS)) {
        try {
          const current = JSON.parse(FS.readFileSync(desktopSettingsPath, "utf8")) as Record<
            string,
            unknown
          >;
          const cleaned = removeLegacyForcedEditorSettings(current);
          if (JSON.stringify(cleaned) !== JSON.stringify(current)) {
            FS.writeFileSync(desktopSettingsPath, `${JSON.stringify(cleaned, null, 2)}\n`, "utf8");
          }
        } catch {
          // A malformed settings file is handled by writeMergedJsonFile below.
        }
      }
      writeMergedJsonFile(desktopSettingsPath, {
        ...CODE_OSS_EMBED_DEFAULT_SETTINGS,
        // Apply the outer Tabs theme before the extension host starts. The
        // integration extension still installs the detailed color overrides,
        // but the workbench must not flash or remain on a stale opposite theme
        // while that host is activating.
        "workbench.colorTheme": resolveCodeOssWorkbenchTheme(
          this.currentThemeId,
          this.currentCustomConfig,
        ),
      });
    } catch {
      // Non-fatal. The integration extension also enforces these settings.
    }

    try {
      const desktopKeybindingsPath = Path.join(location, "keybindings.json");
      writeKeybindingsJsonFile(desktopKeybindingsPath, [
        {
          key: "cmd+shift+n",
          command: "-workbench.action.newWindow",
        },
        {
          key: "cmd+shift+n",
          command: "tabs.openProjectTab",
        },
        {
          key: "ctrl+shift+n",
          command: "-workbench.action.newWindow",
        },
        {
          key: "ctrl+shift+n",
          command: "tabs.openProjectTab",
        },
      ]);
    } catch {
      // Non-fatal.
    }

    return {
      id: "default",
      isDefault: true,
      name: "Default",
      location: this.toFileUriComponent(location),
      globalStorageHome: this.toFileUriComponent(Path.join(location, "globalStorage")),
      settingsResource: this.toFileUriComponent(Path.join(location, "settings.json")),
      keybindingsResource: this.toFileUriComponent(Path.join(location, "keybindings.json")),
      tasksResource: this.toFileUriComponent(Path.join(location, "tasks.json")),
      snippetsHome: this.toFileUriComponent(Path.join(location, "snippets")),
      promptsHome: this.toFileUriComponent(Path.join(location, "prompts")),
      extensionsResource: this.toFileUriComponent(sharedExtensionsRegistry),
      mcpResource: this.toFileUriComponent(Path.join(location, "mcp.json")),
      languageModelsResource: this.toFileUriComponent(Path.join(location, "languageModels.json")),
      agentPluginsHome: this.toFileUriComponent(Path.join(location, "agentPlugins")),
      cacheHome: this.toFileUriComponent(cacheHome),
    };
  }

  private toFileUriComponent(pathname: string): UriComponent {
    const fileUrl = pathToFileURL(pathname);
    return {
      scheme: "file",
      authority: fileUrl.hostname,
      // URI.revive expects a decoded path; URL.pathname is already percent-encoded.
      path: decodeURIComponent(fileUrl.pathname),
      query: "",
      fragment: "",
    };
  }

  private hashDesktopIdentity(value: string): string {
    return Crypto.createHash("sha256").update(value).digest("hex");
  }

  private getProductConfiguration(vscodeRoot: string): Record<string, unknown> {
    const cached = productConfigurationCache.get(vscodeRoot);
    if (cached) {
      return cached;
    }

    const parsed = JSON.parse(
      FS.readFileSync(
        getRequiredCodeOssPath(vscodeRoot, CODE_OSS_PRODUCT_CONFIGURATION_RELATIVE_PATH),
        "utf8",
      ),
    ) as Record<string, unknown>;
    if (typeof parsed.version !== "string") {
      const packageConfiguration = JSON.parse(
        FS.readFileSync(Path.join(vscodeRoot, "package.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof packageConfiguration.version === "string") {
        parsed.version = packageConfiguration.version;
      }
    }
    const configuredProduct = addDefaultExtensionGallery(parsed);
    productConfigurationCache.set(vscodeRoot, configuredProduct);
    return configuredProduct;
  }

  private getNlsMessages(vscodeRoot: string): string[] {
    const cached = nlsMessagesCache.get(vscodeRoot);
    if (cached) {
      return cached;
    }

    const parsed = JSON.parse(
      FS.readFileSync(
        getRequiredCodeOssPath(vscodeRoot, CODE_OSS_NLS_MESSAGES_RELATIVE_PATH),
        "utf8",
      ),
    ) as string[];
    nlsMessagesCache.set(vscodeRoot, parsed);
    return parsed;
  }

  private registerDesktopDiagnostics(session: CodeSession): void {
    const runtime = this.config.runtime;
    if (!runtime || !session.view) {
      return;
    }

    const prefix = `[code-oss:${session.projectId}]`;
    session.view.webContents.on("did-start-loading", () => {
      writeCodeHostDiagnostic(`${prefix} did-start-loading`);
      console.log(`${prefix} did-start-loading`);
    });
    session.view.webContents.on("did-finish-load", () => {
      session.desktopLoadPending = false;
      writeCodeHostDiagnostic(
        `${prefix} did-finish-load ${session.view?.webContents.getURL() ?? ""}`,
      );
      console.log(`${prefix} did-finish-load`, session.view?.webContents.getURL());
    });
    session.view.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        session.lastLoadedUrl = null;
        session.desktopLoadPending = true;
        writeCodeHostDiagnostic(`${prefix} did-fail-load`, {
          errorCode,
          errorDescription,
          validatedURL,
        });
        console.error(`${prefix} did-fail-load`, {
          errorCode,
          errorDescription,
          validatedURL,
        });
      },
    );
    session.view.webContents.on("render-process-gone", (_event, details) => {
      session.lastLoadedUrl = null;
      session.desktopLoadPending = true;
      writeCodeHostDiagnostic(`${prefix} render-process-gone`, details);
      console.error(`${prefix} render-process-gone`, details);
    });
    session.view.webContents.on("destroyed", () => {
      writeCodeHostDiagnostic(`${prefix} webContents destroyed`);
      console.error(`${prefix} webContents destroyed`);
    });
    session.view.webContents.on("unresponsive", () => {
      writeCodeHostDiagnostic(`${prefix} webContents unresponsive`);
      console.warn(`${prefix} webContents unresponsive`);
    });
    session.view.webContents.on("responsive", () => {
      writeCodeHostDiagnostic(`${prefix} webContents responsive`);
    });
    session.view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      // Chromium levels 0-2 include routine debug/info/warnings. Forwarding all
      // of them synchronously produced thousands of writes during startup and
      // blocked input dispatch in Electron's main process.
      if (level < 3) {
        return;
      }
      // ResizeObserver warnings are emitted by complex extension webviews and
      // are not actionable host failures. Chromium can emit them hundreds of
      // times per second, turning diagnostics into a main-process I/O storm.
      if (message.includes("ResizeObserver loop")) {
        return;
      }
      if (message.startsWith("Loading the font 'data:font/")) {
        return;
      }
      const diagnosticKey = `${session.projectId}:${level}:${sourceId}:${line}:${message}`;
      const now = Date.now();
      const lastSeen = this.rendererDiagnosticLastSeen.get(diagnosticKey) ?? 0;
      if (now - lastSeen < 10_000) {
        return;
      }
      if (this.rendererDiagnosticLastSeen.size >= 500) {
        for (const [key, timestamp] of this.rendererDiagnosticLastSeen) {
          if (now - timestamp >= 10_000) this.rendererDiagnosticLastSeen.delete(key);
        }
      }
      this.rendererDiagnosticLastSeen.set(diagnosticKey, now);
      writeCodeHostDiagnostic(`${prefix} renderer-console`, {
        level,
        message: message.slice(0, 1000),
        line,
        sourceId,
      });
    });
    session.view.webContents.on("preload-error", (_event, preloadPathname, error) => {
      writeCodeHostDiagnostic(`${prefix} preload-error`, {
        preloadPathname,
        error,
      });
      console.error(`${prefix} preload-error`, preloadPathname, error);
    });
  }

  private registerDesktopRequestDiagnostics(session: CodeSession): void {
    const runtime = this.config.runtime;
    if (!runtime || !session.view) {
      return;
    }

    const prefix = `[code-oss:${session.projectId}]`;
    const browserSession = session.view.webContents.session;
    const filter = { urls: [`${CODE_OSS_FILE_PROTOCOL}://*/*`] };
    browserSession.webRequest.onErrorOccurred(filter, (details) => {
      writeCodeHostDiagnostic(`${prefix} request-error`, {
        url: details.url,
        error: details.error,
        resourceType: details.resourceType,
      });
      console.error(`${prefix} request-error`, {
        url: details.url,
        error: details.error,
        resourceType: details.resourceType,
      });
    });
    browserSession.webRequest.onHeadersReceived(filter, (details, callback) => {
      if (details.url.includes("/workbench-dev.html") || details.url.includes("/workbench.js")) {
        console.error(`${prefix} response`, {
          url: details.url,
          statusCode: details.statusCode,
          resourceType: details.resourceType,
          responseHeaders: details.responseHeaders,
        });
      }
      callback(
        details.responseHeaders
          ? { cancel: false, responseHeaders: details.responseHeaders }
          : { cancel: false },
      );
    });
  }

  private getCssModules(vscodeRoot: string): string[] {
    const cached = cssModulesCache.get(vscodeRoot);
    if (cached) {
      return cached;
    }

    const outRoot = Path.join(vscodeRoot, "out");
    const cssModules: string[] = [];
    const queue = [outRoot];

    while (queue.length > 0) {
      const current = queue.pop();
      if (!current || !isDirectory(current, FS)) {
        continue;
      }

      for (const entry of FS.readdirSync(current, { withFileTypes: true })) {
        const absolutePath = Path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(absolutePath);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith(".css")) {
          continue;
        }

        const relativePath = Path.relative(outRoot, absolutePath);
        cssModules.push(normalizeFilePath(relativePath));
      }
    }

    cssModules.sort();
    cssModulesCache.set(vscodeRoot, cssModules);
    return cssModules;
  }
}
