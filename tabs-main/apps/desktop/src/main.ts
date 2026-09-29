import { probeBrowserReadiness } from "./browserReadiness";
import type { BrowserComparisonInput } from "@tabs/contracts";
import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { createClerkBridge } from "@clerk/electron";
import { storage as clerkStorage } from "@clerk/electron/storage";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  protocol,
  safeStorage,
  session,
  shell,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import type {
  DesktopIconTheme,
  DesktopTheme,
  DesktopUpdateActionResult,
  DesktopUpdateState,
  DesktopSshEnvironmentTarget,
  DesktopExtensionBoundsInput,
  DesktopExtensionViewInput,
  DesktopExchangeListing,
  TabsExtensionAssignment,
} from "@tabs/contracts";
import { BrowserImportInput } from "@tabs/contracts";
import { DEFAULT_DESKTOP_ICON_THEME } from "@tabs/contracts/settings";
import { autoUpdater } from "electron-updater";
import { DEFAULT_KEYBINDINGS, parseKeybindingShortcut } from "@tabs/shared/keybindings";
import type { KeybindingShortcut } from "@tabs/contracts";

import type {
  ContextMenuItem,
  DesktopCloneRepositoryInput,
  DesktopCloneRepositoryResult,
  PickFileOptions,
  PickFolderOptions,
} from "@tabs/contracts";
import { NetService, layer as netServiceLayer } from "@tabs/shared/Net";
import { RotatingFileSink } from "@tabs/shared/logging";
import { showDesktopConfirmDialog } from "./confirmDialog";
import { DesktopShutdown, layer as shutdownLayer } from "./app/DesktopShutdown";
import { syncShellEnvironment } from "./syncShellEnvironment";
import { getAutoUpdateDisabledReason, shouldBroadcastDownloadProgress } from "./updateState";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnInstallStart,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "./updateMachine";
import { isArm64HostRunningIntelBuild, resolveDesktopRuntimeInfo } from "./runtimeArch";
import { MacPreviewUpdater } from "./macPreviewUpdater";
import {
  assertUpdateInstallEnvironment,
  assertWindowsInstallerReady,
  downloadNativeUpdateWithFallback,
  handOffNativeUpdateAfterCleanup,
} from "./desktopUpdaterRuntime";
import {
  prepareLinuxAppImageUpdate,
  type PreparedLinuxAppImageUpdate,
} from "./linuxAppImageUpdater";
import { CodeHostManager, resolveCodeHostConfig } from "./codeHostManager";
import { BrowserHostManager } from "./browserHostManager";
import { ExtensionViewManager } from "./extensionViewManager";
import { ExtensionAiBrokerServer } from "./extensionAiBrokerServer";
import { configuredExchangeOrigin, discoverExchangePage } from "./exchangeCatalog";
import { ExchangeUpdateMonitor } from "./exchangeUpdateMonitor";
import { ExchangeAutomaticUpdater } from "./exchangeAutomaticUpdater";
import { ExchangeSignedMetadataHints } from "./exchangeSignedMetadataHints";
import { configuredExchangeTrust, ExchangeInstallService } from "./exchangeInstall";
import { resolveUserDataPathWithFs } from "./userDataPath";
import { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";
import {
  normalizeNotificationToasts,
  NotificationOverlayManager,
} from "./notificationOverlayManager";
import {
  ensureRuntimeInstalled,
  isRuntimeInstalled,
  resolveInstalledRuntimeDir,
  type RuntimeInstallProgress,
} from "./codeOssRuntimeInstaller";
import { DesktopCaptureCoordinator } from "./capture/DesktopCaptureCoordinator";
import type { DesktopCaptureOptions } from "@tabs/contracts";
import { CodeControlChannel } from "./codeControlChannel";
import { getTailscaleStatus } from "./tailscale";
import { DEFAULT_CODE_CHROME_STATE, type CodeChromeState } from "@tabs/shared/codeChrome";
import {
  createNativeCodeHostMainBackend,
  type NativeCodeHostMainBackend,
} from "./nativeCodeHostMain";
import { findNativeCodeHostURLs, isNativeCodeHostURL } from "./nativeCodeHostUrl";
import {
  createSshEnvironmentBridge,
  resolveSshPasswordPrompt,
  type SshEnvironmentBridge,
} from "./sshEnvironmentBridge";

// Prevent EPIPE crashes when pipes are closed unexpectedly (e.g. parent process killed)
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

syncShellEnvironment();

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CLONE_REPOSITORY_CHANNEL = "desktop:clone-repository";
const PICK_FILE_CHANNEL = "desktop:pick-file";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const SET_ICON_THEME_CHANNEL = "desktop:set-icon-theme";
const SET_AI_PROVIDER_CHANNEL = "desktop:set-ai-provider";
const SET_ZOOM_FACTOR_CHANNEL = "desktop:set-zoom-factor";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const OPEN_POPOUT_WINDOW_CHANNEL = "desktop:open-popout-window";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const APP_CLOSING_CHANNEL = "desktop:app-closing";
const APP_SETTINGS_FLUSH_DONE_CHANNEL = "desktop:settings-flush-done";
const QUIT_CONFIRMATION_REQUEST_CHANNEL = "desktop:quit-confirmation-request";
const QUIT_CONFIRMATION_RESPONSE_CHANNEL = "desktop:quit-confirmation-response";
const GET_CONFIRM_BEFORE_QUIT_CHANNEL = "desktop:get-confirm-before-quit";
const SET_CONFIRM_BEFORE_QUIT_CHANNEL = "desktop:set-confirm-before-quit";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL = "desktop:get-local-environment-bootstraps";
const GET_CONNECTION_CATALOG_CHANNEL = "desktop:get-connection-catalog";
const SET_CONNECTION_CATALOG_CHANNEL = "desktop:set-connection-catalog";
const CLEAR_CONNECTION_CATALOG_CHANNEL = "desktop:clear-connection-catalog";
const DISCOVER_SSH_HOSTS_CHANNEL = "desktop:discover-ssh-hosts";
const ENSURE_SSH_ENVIRONMENT_CHANNEL = "desktop:ensure-ssh-environment";
const DISCONNECT_SSH_ENVIRONMENT_CHANNEL = "desktop:disconnect-ssh-environment";
const FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL = "desktop:fetch-ssh-environment-descriptor";
const BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL = "desktop:bootstrap-ssh-bearer-session";
const FETCH_SSH_SESSION_STATE_CHANNEL = "desktop:fetch-ssh-session-state";
const ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL = "desktop:issue-ssh-websocket-token";
const RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL = "desktop:resolve-ssh-password-prompt";
const SYSTEM_RESUME_CHANNEL = "desktop:system-resume";
const HOST_POWER_GET_CHANNEL = "desktop:host-power:get";
const HOST_POWER_CHANGED_CHANNEL = "desktop:host-power:changed";
const CODE_HOST_GET_STATE_CHANNEL = "desktop:code-host:get-state";
const CODE_HOST_ENSURE_SESSION_CHANNEL = "desktop:code-host:ensure-session";
const CODE_HOST_ACTIVATE_SESSION_CHANNEL = "desktop:code-host:activate-session";
const CODE_HOST_HIDE_SESSION_CHANNEL = "desktop:code-host:hide-session";
const CODE_HOST_CAPTURE_SESSION_CHANNEL = "desktop:code-host:capture-session";
const CODE_HOST_OPEN_FILE_CHANNEL = "desktop:code-host:open-file";
const CODE_HOST_SET_BOUNDS_CHANNEL = "desktop:code-host:set-bounds";
const CODE_HOST_SYNC_SESSIONS_CHANNEL = "desktop:code-host:sync-sessions";
// Native Code-tab chrome ↔ embedded workbench command bridge (see
// codeControlChannel.ts). The renderer invokes run-command; main pushes
// chrome-state updates back to the renderer.
const CODE_HOST_RUN_COMMAND_CHANNEL = "vscode:tabs-code-host:run-command";
const CODE_HOST_GET_CHROME_STATE_CHANNEL = "desktop:code-host:get-chrome-state";
const CODE_HOST_CHROME_STATE_CHANNEL = "desktop:code-host:chrome-state";
const BROWSER_HOST_GET_STATE_CHANNEL = "desktop:browser-host:get-state";
const EXTENSION_LIST_CHANNEL = "desktop:extension:list";
const EXTENSION_CHANGED_CHANNEL = "desktop:extension:changed";
const EXTENSION_DISCOVER_CHANNEL = "desktop:extension:discover";
const EXTENSION_CHECK_UPDATE_CHANNEL = "desktop:extension:check-update";
const EXTENSION_EXCHANGE_AVAILABLE_CHANNEL = "desktop:extension:exchange-available";
const EXTENSION_EXCHANGE_PREPARE_CHANNEL = "desktop:extension:exchange-prepare";
const EXTENSION_EXCHANGE_CONFIRM_CHANNEL = "desktop:extension:exchange-confirm";
const EXTENSION_EXCHANGE_CANCEL_CHANNEL = "desktop:extension:exchange-cancel";
const EXTENSION_UNINSTALL_CHANNEL = "desktop:extension:uninstall";
const EXTENSION_SET_DISABLED_CHANNEL = "desktop:extension:set-disabled";
const EXTENSION_SET_UPDATES_PINNED_CHANNEL = "desktop:extension:set-updates-pinned";
const EXTENSION_INSTALL_DEV_CHANNEL = "desktop:extension:install-dev";
const EXTENSION_INSTALL_LOCAL_PACKAGE_CHANNEL = "desktop:extension:install-local-package";
const EXTENSION_ASSIGN_CHANNEL = "desktop:extension:assign";
const EXTENSION_ADD_PROFILE_CHANNEL = "desktop:extension:add-profile";
const EXTENSION_CREDENTIALS_LIST_CHANNEL = "desktop:extension:credentials-list";
const EXTENSION_CREDENTIAL_SET_CHANNEL = "desktop:extension:credential-set";
const EXTENSION_ACTIVATE_CHANNEL = "desktop:extension:activate";
export const EXTENSION_VIEW_ERROR_CHANNEL = "desktop:extension:view-error";
const EXTENSION_SET_BOUNDS_CHANNEL = "desktop:extension:set-bounds";
const EXTENSION_HIDE_CHANNEL = "desktop:extension:hide";
const EXTENSION_STORAGE_CHANNEL = "desktop:extension:storage";
const EXTENSION_WORKSPACE_READ_CHANNEL = "desktop:extension:workspace-read";
const EXTENSION_GIT_STATUS_CHANNEL = "desktop:extension:git-status";
const EXTENSION_NETWORK_GET_CHANNEL = "desktop:extension:network-get";
const EXTENSION_LOGIC_INVOKE_CHANNEL = "desktop:extension:logic-invoke";
const WRITE_CLIPBOARD_TEXT_CHANNEL = "desktop:clipboard:write-text";
const READ_CLIPBOARD_TEXT_CHANNEL = "desktop:clipboard:read-text";
const DESKTOP_CAPTURE_SCREEN_CHANNEL = "desktop:capture:screen";
const DESKTOP_CAPTURE_GET_PERMISSION_CHANNEL = "desktop:capture:get-permission";
const DESKTOP_CAPTURE_REQUEST_PERMISSION_CHANNEL = "desktop:capture:request-permission";
const BROWSER_HOST_GET_SESSION_STATE_CHANNEL = "desktop:browser-host:get-session-state";
const BROWSER_HOST_ENSURE_SESSION_CHANNEL = "desktop:browser-host:ensure-session";
const BROWSER_HOST_ACTIVATE_SESSION_CHANNEL = "desktop:browser-host:activate-session";
const BROWSER_HOST_HIDE_SESSION_CHANNEL = "desktop:browser-host:hide-session";
const BROWSER_HOST_NAVIGATE_SESSION_CHANNEL = "desktop:browser-host:navigate-session";
const BROWSER_HOST_RELOAD_SESSION_CHANNEL = "desktop:browser-host:reload-session";
const BROWSER_HOST_SET_ZOOM_CHANNEL = "desktop:browser-host:set-zoom";
const BROWSER_HOST_SET_AUDIO_MUTED_CHANNEL = "desktop:browser-host:set-audio-muted";
const BROWSER_HOST_OPEN_PICTURE_IN_PICTURE_CHANNEL = "desktop:browser-host:open-picture-in-picture";
const BROWSER_HOST_CLOSE_PICTURE_IN_PICTURE_CHANNEL =
  "desktop:browser-host:close-picture-in-picture";
const BROWSER_HOST_SET_COLOR_SCHEME_CHANNEL = "desktop:browser-host:set-color-scheme";
const BROWSER_HOST_BACK_SESSION_CHANNEL = "desktop:browser-host:back-session";
const BROWSER_HOST_FORWARD_SESSION_CHANNEL = "desktop:browser-host:forward-session";
const BROWSER_HOST_TOGGLE_DEVTOOLS_CHANNEL = "desktop:browser-host:toggle-devtools";
const BROWSER_HOST_AUTOMATION_CHANNEL = "desktop:browser-host:automation";
const BROWSER_HOST_CAPTURE_SCREENSHOT_CHANNEL = "desktop:browser-host:capture-screenshot";
const BROWSER_HOST_MEDIA_SOURCE_CHANNEL = "desktop:browser-host:media-source";
const BROWSER_HOST_SAVE_RECORDING_CHANNEL = "desktop:browser-host:save-recording";
const BROWSER_HOST_PICK_ELEMENT_CHANNEL = "desktop:browser-host:pick-element";
const BROWSER_HOST_REVEAL_ARTIFACT_CHANNEL = "desktop:browser-host:reveal-artifact";
const BROWSER_HOST_COPY_ARTIFACT_CHANNEL = "desktop:browser-host:copy-artifact";
const BROWSER_HOST_SET_BOUNDS_CHANNEL = "desktop:browser-host:set-bounds";
const BROWSER_HOST_SYNC_SESSIONS_CHANNEL = "desktop:browser-host:sync-sessions";
const CODE_HOST_RECREATE_SESSION_CHANNEL = "desktop:code-host:recreate-session";
const BROWSER_HOST_RECREATE_SESSION_CHANNEL = "desktop:browser-host:recreate-session";
const BROWSER_HOST_CLEAR_SESSION_DATA_CHANNEL = "desktop:browser-host:clear-session-data";
const BROWSER_HOST_CLEAR_PROFILE_DATA_CHANNEL = "desktop:browser-host:clear-profile-data";
const BROWSER_HOST_OPEN_PROFILE_LOGIN_WINDOW_CHANNEL =
  "desktop:browser-host:open-profile-login-window";
const BROWSER_HOST_GET_PROFILE_DOMAINS_CHANNEL = "desktop:browser-host:get-profile-domains";
const BROWSER_HOST_INSPECT_PROFILE_CHANNEL = "desktop:browser-host:inspect-profile";
const BROWSER_HOST_CLEAR_PROFILE_DOMAIN_CHANNEL = "desktop:browser-host:clear-profile-domain";
const BROWSER_HOST_LIST_IMPORT_SOURCES_CHANNEL = "desktop:browser-host:list-import-sources";
const BROWSER_HOST_IMPORT_COOKIES_CHANNEL = "desktop:browser-host:import-cookies";
const BROWSER_HOST_RESPOND_PERMISSION_CHANNEL = "desktop:browser-host:respond-permission";
const BROWSER_HOST_GET_PROFILE_PERMISSIONS_CHANNEL = "desktop:browser-host:get-profile-permissions";
const BROWSER_HOST_REVOKE_PROFILE_PERMISSION_CHANNEL =
  "desktop:browser-host:revoke-profile-permission";
const BROWSER_HOST_TAKE_CONTROL_CHANNEL = "desktop:browser-host:take-control";
const BROWSER_HOST_RESUME_AGENT_CHANNEL = "desktop:browser-host:resume-agent";
const BROWSER_HOST_ASSIGN_TAB_TASK_CHANNEL = "desktop:browser-host:assign-tab-task";
const BROWSER_HOST_RETAIN_TAB_CHANNEL = "desktop:browser-host:retain-tab";
const BROWSER_HOST_CLEANUP_AGENT_TABS_CHANNEL = "desktop:browser-host:cleanup-agent-tabs";
const BROWSER_HOST_DESTROY_SESSION_CHANNEL = "desktop:browser-host:destroy-session";
const BROWSER_HOST_GET_RECENTLY_CLOSED_CHANNEL = "desktop:browser-host:get-recently-closed";
const BROWSER_HOST_RESTORE_RECENTLY_CLOSED_CHANNEL = "desktop:browser-host:restore-recently-closed";
const NOTIFICATION_OVERLAY_SYNC_CHANNEL = "desktop:notification-overlay:sync";
const NOTIFICATION_OVERLAY_ACTION_CHANNEL = "desktop:notification-overlay:action";
const NOTIFICATION_OVERLAY_DISMISS_CHANNEL = "desktop:notification-overlay:dismiss";
const NOTIFICATION_OVERLAY_REPORT_BOUNDS_CHANNEL = "desktop:notification-overlay:report-bounds";
const NOTIFICATION_OVERLAY_RESTORE_FOCUS_CHANNEL = "desktop:notification-overlay:restore-focus";

function readBrowserSessionId(input: unknown): string | undefined {
  const value = (input as { sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value : undefined;
}
const VSCODE_FETCH_SHELL_ENV_CHANNEL = "vscode:fetchShellEnv";
const VSCODE_TOGGLE_DEVTOOLS_CHANNEL = "vscode:toggleDevTools";
const VSCODE_OPEN_DEVTOOLS_CHANNEL = "vscode:openDevTools";
const VSCODE_RELOAD_WINDOW_CHANNEL = "vscode:reloadWindow";
const VSCODE_NOTIFY_ZOOM_LEVEL_CHANNEL = "vscode:notifyZoomLevel";
const BASE_DIR = process.env.TABS_HOME?.trim() || Path.join(OS.homedir(), ".tabs");
const STATE_DIR = Path.join(BASE_DIR, "userdata");
const DESKTOP_THEME_STATE_PATH = Path.join(STATE_DIR, "desktop-theme.json");
const DESKTOP_SCHEME = "tabs";
// In packaged apps, ROOT_DIR should point to the Resources directory, not inside the asar.
// __dirname in packaged app: /path/to/Tabs.app/Contents/Resources/app.asar/apps/desktop/dist-electron
// We need ROOT_DIR to be: /path/to/Tabs.app/Contents/Resources (where tabs-code-main lives).
//
// IMPORTANT: This MUST be a function call — a top-level ternary referencing `app.isPackaged`
// gets tree-shaken by tsdown/esbuild because the bundler evaluates the electron import as
// a static external and folds the branch away.  A function body is opaque to the bundler.
function resolveRootDir(): string {
  // Dynamic require ensures the bundler cannot statically evaluate this branch.
  const _electron = require("electron") as typeof import("electron");
  if (_electron.app.isPackaged && process.resourcesPath) {
    return process.resourcesPath;
  }
  return Path.resolve(__dirname, "../../..");
}

type PersistedDesktopTheme = {
  themeId: string;
  preference?: string;
  customConfig?: unknown;
};

function loadPersistedDesktopTheme(): PersistedDesktopTheme | null {
  try {
    const parsed = JSON.parse(FS.readFileSync(DESKTOP_THEME_STATE_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    const themeId = getSafeTheme(parsed.themeId);
    const preference = getSafeTheme(parsed.preference);
    return themeId
      ? {
          themeId,
          ...(preference ? { preference } : null),
          customConfig: parsed.customConfig,
        }
      : null;
  } catch {
    return null;
  }
}

function savePersistedDesktopTheme(theme: PersistedDesktopTheme): void {
  try {
    FS.mkdirSync(Path.dirname(DESKTOP_THEME_STATE_PATH), { recursive: true });
    FS.writeFileSync(DESKTOP_THEME_STATE_PATH, `${JSON.stringify(theme, null, 2)}\n`, "utf8");
  } catch {
    // Theme persistence is best-effort; renderer storage remains the fallback.
  }
}

function isLightDesktopTheme(themeId: string, customConfig?: any): boolean {
  return themeId === "custom"
    ? customConfig?.baseVariant === "light"
    : themeId === "tabs-light" || themeId === "solarized-light" || themeId === "light";
}
const ROOT_DIR = resolveRootDir();

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL || !app.isPackaged);
const APP_BASE_NAME = "Tabs";
const APP_DISPLAY_NAME = isDevelopment ? "Tabs Dev" : APP_BASE_NAME;
const APP_USER_MODEL_ID = isDevelopment ? "com.tabs.app.dev" : "com.tabs.app";
const USER_DATA_DIR_NAME = isDevelopment ? "tabs-dev" : "tabs";
const LEGACY_USER_DATA_DIR_NAME = isDevelopment ? "Tabs (Dev)" : "Tabs (Alpha)";
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;
const LOG_DIR = Path.join(STATE_DIR, "logs");
const DEV_DESKTOP_LOG_PATH = Path.join(STATE_DIR, "desktop-dev.log");
const DESKTOP_PREFERENCES_PATH = Path.join(STATE_DIR, "desktop-preferences.json");
const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_MAX_FILES = 10;

type DesktopPreferences = {
  iconTheme?: DesktopIconTheme;
  confirmBeforeQuit?: boolean;
};
const APP_RUN_ID = Crypto.randomBytes(6).toString("hex");
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DESKTOP_UPDATE_CHANNEL = "latest";
const DESKTOP_UPDATE_ALLOW_PRERELEASE = false;

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];

let mainWindow: BrowserWindow | null = null;
let sshEnvironmentBridgePromise: Promise<SshEnvironmentBridge> | null = null;
let hostSuspended = false;

function readHostPowerSnapshot() {
  const idleSeconds = powerMonitor.getSystemIdleTime();
  const idleState = powerMonitor.getSystemIdleState(60);
  return {
    source: "electron-main" as const,
    idle: idleState === "active" ? ("false" as const) : ("true" as const),
    idleSeconds,
    locked: idleState === "locked" ? ("true" as const) : ("false" as const),
    suspended: hostSuspended,
    onBattery: powerMonitor.isOnBatteryPower() ? ("true" as const) : ("false" as const),
    lowPowerMode: "unknown" as const,
    thermalState: powerMonitor.getCurrentThermalState(),
    stale: false,
    updatedAt: DateTime.nowUnsafe(),
  };
}

function broadcastHostPowerSnapshot(): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  window.webContents.send(HOST_POWER_CHANGED_CHANNEL, readHostPowerSnapshot());
}

function getSshEnvironmentBridge(): Promise<SshEnvironmentBridge> {
  sshEnvironmentBridgePromise ??= createSshEnvironmentBridge({
    getWindow: () => mainWindow,
    cliPackageSpec: `tabs@${app.getVersion()}`,
  });
  return sshEnvironmentBridgePromise;
}
let currentDesktopIconTheme = loadDesktopIconThemePreference();
let backendProcess: ChildProcess.ChildProcess | null = null;
let backendPort = 0;
let backendAuthToken = "";
let backendWsUrl = "";
let backendHttpUrl = "";
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;
let isQuittingConfirmed = false;
let isQuitConfirmationOpen = false;
let desktopProtocolRegistered = false;
let nativeCodeHostMainBackend: NativeCodeHostMainBackend | null = null;
const pendingNativeCodeHostURLs: string[] = [];

function forwardNativeCodeHostURL(rawUrl: string): void {
  if (!isNativeCodeHostURL(rawUrl, DESKTOP_SCHEME)) return;
  if (!nativeCodeHostMainBackend) {
    pendingNativeCodeHostURLs.push(rawUrl);
    return;
  }
  void nativeCodeHostMainBackend.handleURL(rawUrl).catch((error: unknown) => {
    console.error("[code-oss] failed to route protocol URL", error);
  });
}
let aboutCommitHashCache: string | null | undefined;
let desktopLogSink: RotatingFileSink | null = null;
let backendLogSink: RotatingFileSink | null = null;
let restoreStdIoCapture: (() => void) | null = null;
// Level B (thin installer): when the app is packaged without a bundled runtime,
// resolve a previously-downloaded one for this app version. Never override in dev
// or when a fat runtime is bundled in resourcesPath.
if (
  !isDevelopment &&
  (!process.resourcesPath || !FS.existsSync(Path.join(process.resourcesPath, "tabs-code-main"))) &&
  !process.env.TABS_CODE_OSS_BUILD_DIR?.trim() &&
  isRuntimeInstalled(app.getVersion())
) {
  process.env.TABS_CODE_OSS_BUILD_DIR = resolveInstalledRuntimeDir(app.getVersion());
}
const codeHostConfig = resolveCodeHostConfig({
  rootDir: ROOT_DIR,
  env: process.env,
});
const nativeViewCoordinator = new NativeViewStackCoordinator({ getWindow: () => mainWindow });
const notificationOverlayManager = new NotificationOverlayManager({
  getWindow: () => mainWindow,
  stackCoordinator: nativeViewCoordinator,
  onAction: (toastId, actionId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(NOTIFICATION_OVERLAY_ACTION_CHANNEL, { toastId, actionId });
    }
  },
  onDismiss: (toastId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(NOTIFICATION_OVERLAY_DISMISS_CHANNEL, { toastId });
    }
  },
  restoreActiveFocus: () => {
    try {
      nativeViewCoordinator.restoreLastFocusedWebContents();
    } catch {}
  },
});
const codeControlChannel = new CodeControlChannel();
const codeHostManager = new CodeHostManager(
  () => mainWindow,
  codeHostConfig,
  codeControlChannel,
  nativeViewCoordinator,
);
const persistedDesktopTheme = loadPersistedDesktopTheme();
if (persistedDesktopTheme) {
  nativeTheme.themeSource =
    !persistedDesktopTheme.preference || persistedDesktopTheme.preference === "system"
      ? "system"
      : isLightDesktopTheme(persistedDesktopTheme.themeId, persistedDesktopTheme.customConfig)
        ? "light"
        : "dark";
  codeHostManager.setTheme(persistedDesktopTheme.themeId, persistedDesktopTheme.customConfig);
  notificationOverlayManager.setTheme({
    themeId: persistedDesktopTheme.themeId,
    isDark: !isLightDesktopTheme(persistedDesktopTheme.themeId, persistedDesktopTheme.customConfig),
  });
}
const browserHostManager = new BrowserHostManager(() => mainWindow, nativeViewCoordinator);
const extensionViewManager = new ExtensionViewManager(
  () => mainWindow,
  nativeViewCoordinator,
  Path.join(STATE_DIR, "development-extensions.json"),
  app.getVersion(),
  !app.isPackaged,
  safeStorage,
);
const extensionAiBrokerServer = new ExtensionAiBrokerServer(extensionViewManager);
let extensionAiBrokerConfig: { readonly endpoint: string; readonly token: string } | null = null;
let exchangeInstallService: ExchangeInstallService | null = null;
let exchangeStatusTimer: ReturnType<typeof setInterval> | null = null;
let exchangeUpdateTimer: ReturnType<typeof setInterval> | null = null;
let exchangeUpdateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let exchangeSignedMetadataHints: ExchangeSignedMetadataHints | null = null;
app.on("will-quit", () => {
  extensionAiBrokerServer.close();
  if (exchangeStatusTimer) clearInterval(exchangeStatusTimer);
  if (exchangeUpdateTimer) clearInterval(exchangeUpdateTimer);
  if (exchangeUpdateStartupTimer) clearTimeout(exchangeUpdateStartupTimer);
  exchangeSignedMetadataHints?.stop();
  exchangeInstallService?.dispose();
});
function requireExchangeInstallService(): ExchangeInstallService {
  if (exchangeInstallService) return exchangeInstallService;
  const origin = configuredExchangeOrigin(process.env.TABS_EXCHANGE_ORIGIN, !app.isPackaged);
  const configuration = configuredExchangeTrust(process.env, origin);
  if (!configuration) {
    throw new Error("Exchange installation needs an out-of-band pinned trust root.");
  }
  exchangeInstallService = new ExchangeInstallService(
    configuration,
    Path.join(STATE_DIR, "exchange-trust"),
    app.getVersion(),
    () => extensionViewManager.list(),
    (archive, registryOrigin, digest, options) =>
      extensionViewManager.installVerifiedExchangePackage(archive, registryOrigin, digest, options),
  );
  return exchangeInstallService;
}
const exchangeUpdateMonitor = new ExchangeUpdateMonitor(
  () => extensionViewManager.list(),
  (extension) => requireExchangeInstallService().availableUpdate(extension),
  () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(EXTENSION_CHANGED_CHANNEL);
    }
  },
  (id, error) => {
    writeDesktopLogHeader(`Exchange update check failed for ${id}: ${formatErrorMessage(error)}`);
  },
);
const exchangeAutomaticUpdater = new ExchangeAutomaticUpdater(
  () => extensionViewManager.list(),
  (entry) => exchangeUpdateMonitor.availableFor(entry),
  (id) =>
    extensionViewManager.canApplySilentUpdate(id) && !exchangeInstallService?.hasManualReview(id),
  (listing, options) => requireExchangeInstallService().prepare(listing, options),
  (token, options) => requireExchangeInstallService().confirm(token, options),
  (token) => exchangeInstallService?.cancel(token),
  () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(EXTENSION_CHANGED_CHANNEL);
    }
  },
  (id, error) => {
    writeDesktopLogHeader(
      `Exchange automatic update failed for ${id}: ${formatErrorMessage(error)}`,
    );
  },
);
function applyAvailableExchangeUpdates(): void {
  if (process.env.TABS_EXCHANGE_AUTOMATIC_UPDATES !== "true") return;
  void exchangeAutomaticUpdater.applyAvailable().catch((error) => {
    writeDesktopLogHeader(`Exchange automatic update failed: ${formatErrorMessage(error)}`);
  });
}
function checkAllInstalledExchangeUpdates(): void {
  if (!process.env.TABS_EXCHANGE_TRUST_ROOT_PATH || !process.env.TABS_EXCHANGE_ORIGIN) return;
  void exchangeUpdateMonitor
    .check()
    .then(applyAvailableExchangeUpdates)
    .catch((error) => {
      writeDesktopLogHeader(`Exchange update monitor failed: ${formatErrorMessage(error)}`);
    });
}
async function checkInstalledExchangeStatus(extensionId: string): Promise<void> {
  const installed = extensionViewManager.list().find((entry) => entry.id === extensionId);
  if (!installed || installed.source !== "exchange" || installed.revoked) return;
  const status = await requireExchangeInstallService().statusFor(installed);
  if (status === "revoked" && installed.registryOrigin && installed.digest) {
    try {
      extensionViewManager.revokeIfCurrent(
        installed.id,
        installed.registryOrigin,
        installed.digest,
      );
    } finally {
      const current = extensionViewManager.list().find((entry) => entry.id === installed.id);
      if (current?.revoked && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(EXTENSION_CHANGED_CHANNEL);
      }
    }
  }
}

async function checkAllInstalledExchangeStatuses(): Promise<void> {
  const extensions = extensionViewManager.list().filter((entry) => entry.source === "exchange");
  await Promise.all(
    extensions.map((entry) =>
      checkInstalledExchangeStatus(entry.id).catch((error) => {
        writeDesktopLogHeader(
          `Exchange status check failed for ${entry.id}: ${formatErrorMessage(error)}`,
        );
      }),
    ),
  );
}
const desktopCaptureCoordinator = new DesktopCaptureCoordinator();
const CODE_OSS_PRIMARY_STATE_DIR = Path.join(STATE_DIR, "code-oss-main");

let destructiveMenuIconCache: Electron.NativeImage | null | undefined;
const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation: app.runningUnderARM64Translation === true,
});
const initialUpdateState = (): DesktopUpdateState =>
  createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo);

function logTimestamp(): string {
  return new Date().toISOString();
}

function logScope(scope: string): string {
  return `${scope} run=${APP_RUN_ID}`;
}

function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function backendChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TABS_PORT;
  delete env.TABS_AUTH_TOKEN;
  delete env.TABS_MODE;
  delete env.TABS_NO_BROWSER;
  delete env.TABS_HOST;
  delete env.TABS_DESKTOP_WS_URL;
  return env;
}

export function writeDesktopLogHeader(message: string): void {
  if (isDevelopment) {
    const line = `[${logTimestamp()}] [desktop-dev] ${message}\n`;
    try {
      FS.mkdirSync(STATE_DIR, { recursive: true });
      FS.appendFileSync(DEV_DESKTOP_LOG_PATH, line, "utf8");
    } catch {
      // Ignore dev logging failures.
    }
  }
  if (!desktopLogSink) return;
  desktopLogSink.write(`[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`);
}

function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
  if (!backendLogSink) return;
  const normalizedDetails = sanitizeLogValue(details);
  backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${normalizedDetails} ----\n`,
  );
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function getSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  return parsedUrl.toString();
}

function getSafeTheme(rawTheme: unknown): string | null {
  if (typeof rawTheme === "string" && rawTheme.trim().length > 0) {
    return rawTheme.trim();
  }

  return null;
}

function writeDesktopStreamChunk(
  streamName: "stdout" | "stderr",
  chunk: unknown,
  encoding: BufferEncoding | undefined,
): void {
  if (!desktopLogSink) return;
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), typeof chunk === "string" ? encoding : undefined);
  desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName)}] `);
  desktopLogSink.write(buffer);
  if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
    desktopLogSink.write("\n");
  }
}

function installStdIoCapture(): void {
  if (!app.isPackaged || desktopLogSink === null || restoreStdIoCapture !== null) {
    return;
  }

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const patchWrite =
    (streamName: "stdout" | "stderr", originalWrite: typeof process.stdout.write) =>
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
      writeDesktopStreamChunk(streamName, chunk, encoding);
      if (typeof encodingOrCallback === "function") {
        return originalWrite(chunk, encodingOrCallback);
      }
      if (callback !== undefined) {
        return originalWrite(chunk, encoding, callback);
      }
      if (encoding !== undefined) {
        return originalWrite(chunk, encoding);
      }
      return originalWrite(chunk);
    };

  process.stdout.write = patchWrite("stdout", originalStdoutWrite);
  process.stderr.write = patchWrite("stderr", originalStderrWrite);

  restoreStdIoCapture = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    restoreStdIoCapture = null;
  };
}

function initializePackagedLogging(): void {
  if (!app.isPackaged) return;
  try {
    desktopLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "desktop-main.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    backendLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "server-child.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    installStdIoCapture();
    writeDesktopLogHeader(`runtime log capture enabled logDir=${LOG_DIR}`);
  } catch (error) {
    // Logging setup should never block app startup.
    console.error("[desktop] failed to initialize packaged logging", error);
  }
}

function captureBackendOutput(child: ChildProcess.ChildProcess): void {
  if (!app.isPackaged || backendLogSink === null) return;
  const writeChunk = (chunk: unknown): void => {
    if (!backendLogSink) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    backendLogSink.write(buffer);
  };
  child.stdout?.on("data", writeChunk);
  child.stderr?.on("data", writeChunk);
}

initializePackagedLogging();

function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
  if (process.platform !== "darwin") return undefined;
  if (destructiveMenuIconCache !== undefined) {
    return destructiveMenuIconCache ?? undefined;
  }
  try {
    const icon = nativeImage.createFromNamedImage("trash").resize({
      width: 14,
      height: 14,
    });
    if (icon.isEmpty()) {
      destructiveMenuIconCache = null;
      return undefined;
    }
    icon.setTemplateImage(true);
    destructiveMenuIconCache = icon;
    return icon;
  } catch {
    destructiveMenuIconCache = null;
    return undefined;
  }
}

/**
 * Per-platform title-bar configuration.
 *
 * - macOS: inset traffic lights over our custom top bar (`hiddenInset`).
 * - Windows: hide the native title bar and overlay the caption buttons onto our
 *   own top bar via the Window Controls Overlay. Without this Windows renders a
 *   separate native title-bar strip *above* the tabs, which looks odd.
 * - Linux: keep the previous behavior.
 */
function resolveTitleBarOptions(): Pick<
  Electron.BrowserWindowConstructorOptions,
  "titleBarStyle" | "trafficLightPosition" | "titleBarOverlay"
> {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
    };
  }
  if (process.platform === "win32") {
    return {
      titleBarStyle: "hidden",
      // Matches the app's dark top-bar surface and the 52px header height so the
      // min/maximize/close buttons sit on the tab bar instead of a native strip.
      titleBarOverlay: { color: "#161616", symbolColor: "#cfcfcf", height: 52 },
    };
  }
  return { titleBarStyle: "hiddenInset" };
}
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateInstallInFlight = false;
let nativeUpdateInstallPending = false;
let linuxDownloadedUpdatePath: string | null = null;
let windowsDownloadedUpdatePath: string | null = null;
let preparedLinuxUpdate: PreparedLinuxAppImageUpdate | null = null;
let updateInstallHandoffTimer: ReturnType<typeof setTimeout> | null = null;
let updaterConfigured = false;
let updateState: DesktopUpdateState = initialUpdateState();
let macPreviewUpdater: MacPreviewUpdater | null = null;

function resolveUpdaterErrorContext(): DesktopUpdateErrorContext {
  if (updateInstallInFlight) return "install";
  if (updateDownloadInFlight) return "download";
  if (updateCheckInFlight) return "check";
  return updateState.errorContext;
}

function clearUpdateInstallHandoffTimer(): void {
  if (!updateInstallHandoffTimer) return;
  clearTimeout(updateInstallHandoffTimer);
  updateInstallHandoffTimer = null;
}

function recoverFailedUpdateInstall(message: string): void {
  clearUpdateInstallHandoffTimer();
  isQuitting = false;
  isQuittingConfirmed = false;
  updateInstallInFlight = false;
  nativeUpdateInstallPending = false;
  const stagedLinuxUpdate = preparedLinuxUpdate;
  preparedLinuxUpdate = null;
  if (stagedLinuxUpdate) {
    void stagedLinuxUpdate
      .dispose()
      .catch((error) =>
        console.warn(`[desktop-updater] Could not clean up Linux update staging: ${String(error)}`),
      );
  }
  setUpdateState(reduceDesktopUpdateStateOnInstallFailure(updateState, message));
}

function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "tabs-extension",
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
    {
      scheme: DESKTOP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: "vscode-file",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    },
    {
      scheme: "vscode-webview",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        allowServiceWorkers: true,
        codeCache: true,
      },
    },
  ]);
}

function resolveAppRoot(): string {
  if (!app.isPackaged) {
    return ROOT_DIR;
  }
  return app.getAppPath();
}

/** Read the baked-in app-update.yml config (if applicable). */
function readAppUpdateYml(): Record<string, string> | null {
  try {
    // electron-updater reads from process.resourcesPath in packaged builds,
    // or dev-app-update.yml via app.getAppPath() in dev.
    const ymlPath = app.isPackaged
      ? Path.join(process.resourcesPath, "app-update.yml")
      : Path.join(app.getAppPath(), "dev-app-update.yml");
    const raw = FS.readFileSync(ymlPath, "utf-8");
    // The YAML is simple key-value pairs — avoid pulling in a YAML parser by
    // doing a line-based parse (fields: provider, owner, repo, releaseType, …).
    const entries: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match?.[1] && match[2]) entries[match[1]] = match[2].trim();
    }
    return entries.provider ? entries : null;
  } catch {
    return null;
  }
}

function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!COMMIT_HASH_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase();
}

function resolveEmbeddedCommitHash(): string | null {
  const packageJsonPath = Path.join(resolveAppRoot(), "package.json");
  if (!FS.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const raw = FS.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { tabsCommitHash?: unknown };
    return normalizeCommitHash(parsed.tabsCommitHash);
  } catch {
    return null;
  }
}

function resolveAboutCommitHash(): string | null {
  if (aboutCommitHashCache !== undefined) {
    return aboutCommitHashCache;
  }

  const envCommitHash = normalizeCommitHash(process.env.TABS_COMMIT_HASH);
  if (envCommitHash) {
    aboutCommitHashCache = envCommitHash;
    return aboutCommitHashCache;
  }

  // Only packaged builds are required to expose commit metadata.
  if (!app.isPackaged) {
    aboutCommitHashCache = null;
    return aboutCommitHashCache;
  }

  aboutCommitHashCache = resolveEmbeddedCommitHash();

  return aboutCommitHashCache;
}

function resolveBackendEntry(): string {
  return Path.join(resolveAppRoot(), "apps/server/dist/index.mjs");
}

function resolveBackendCwd(): string {
  if (!app.isPackaged) {
    return resolveAppRoot();
  }
  return OS.homedir();
}

function resolveDesktopStaticDir(): string | null {
  const appRoot = resolveAppRoot();
  const candidates = [
    Path.join(appRoot, "apps/server/dist/client"),
    Path.join(appRoot, "apps/web/dist"),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(Path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

function resolveDesktopStaticPath(staticRoot: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname);
  const normalizedPath = Path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (normalizedPath.includes("..")) {
    return Path.join(staticRoot, "index.html");
  }

  const requestedPath = normalizedPath.length > 0 ? normalizedPath : "index.html";
  const resolvedPath = Path.join(staticRoot, requestedPath);

  if (Path.extname(resolvedPath)) {
    return resolvedPath;
  }

  const nestedIndex = Path.join(resolvedPath, "index.html");
  if (FS.existsSync(nestedIndex)) {
    return nestedIndex;
  }

  return Path.join(staticRoot, "index.html");
}

function isStaticAssetRequest(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return Path.extname(url.pathname).length > 0;
  } catch {
    return false;
  }
}

function handleFatalStartupError(stage: string, error: unknown): void {
  const message = formatErrorMessage(error);
  const detail =
    error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`);
  console.error(`[desktop] fatal startup error (${stage})`, error);
  if (!isQuitting) {
    isQuitting = true;
    dialog.showErrorBox("Tabs failed to start", `Stage: ${stage}\n${message}${detail}`);
  }
  stopBackend();
  restoreStdIoCapture?.();
  app.quit();
}

function registerDesktopProtocol(): void {
  if (isDevelopment || desktopProtocolRegistered) return;

  const staticRoot = resolveDesktopStaticDir();
  if (!staticRoot) {
    throw new Error(
      "Desktop static bundle missing. Build apps/server (with bundled client) first.",
    );
  }

  const staticRootResolved = Path.resolve(staticRoot);
  const staticRootPrefix = `${staticRootResolved}${Path.sep}`;
  const fallbackIndex = Path.join(staticRootResolved, "index.html");

  protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
    try {
      const candidate = resolveDesktopStaticPath(staticRootResolved, request.url);
      const resolvedCandidate = Path.resolve(candidate);
      const isInRoot =
        resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix);
      const isAssetRequest = isStaticAssetRequest(request.url);

      if (!isInRoot || !FS.existsSync(resolvedCandidate)) {
        if (isAssetRequest) {
          callback({ error: -6 });
          return;
        }
        callback({ path: fallbackIndex });
        return;
      }

      callback({ path: resolvedCandidate });
    } catch {
      callback({ path: fallbackIndex });
    }
  });

  desktopProtocolRegistered = true;
}

function dispatchMenuAction(action: string): void {
  const existingWindow =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  const targetWindow = existingWindow ?? createWindow();
  if (!existingWindow) {
    mainWindow = targetWindow;
  }

  const send = () => {
    if (targetWindow.isDestroyed()) return;
    targetWindow.webContents.send(MENU_ACTION_CHANNEL, action);
    if (!targetWindow.isVisible()) {
      targetWindow.show();
    }
    targetWindow.focus();
  };

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function handleCheckForUpdatesMenuClick(): void {
  const disabledReason = getAutoUpdateDisabledReason({
    isDevelopment,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    disabledByEnv: process.env.TABS_DISABLE_AUTO_UPDATE === "1",
  });
  if (disabledReason) {
    console.info("[desktop-updater] Manual update check requested, but updates are disabled.");
    void dialog.showMessageBox({
      type: "info",
      title: "Updates unavailable",
      message: "Automatic updates are not available right now.",
      detail: disabledReason,
      buttons: ["OK"],
    });
    return;
  }

  if (!BrowserWindow.getAllWindows().length) {
    mainWindow = createWindow();
  }
  void checkForUpdatesFromMenu();
}

async function checkForUpdatesFromMenu(): Promise<void> {
  await checkForUpdates("menu");

  if (updateState.status === "up-to-date") {
    void dialog.showMessageBox({
      type: "info",
      title: "You're up to date!",
      message: `Tabs ${updateState.currentVersion} is currently the newest version available.`,
      buttons: ["OK"],
    });
  } else if (updateState.status === "error") {
    void dialog.showMessageBox({
      type: "warning",
      title: "Update check failed",
      message: "Could not check for updates.",
      detail: updateState.message ?? "An unknown error occurred. Please try again later.",
      buttons: ["OK"],
    });
  }
}

let keybindingsWatcher: FS.FSWatcher | null = null;

function setupKeybindingsWatcher() {
  if (keybindingsWatcher) return;
  const keybindingsPath = Path.join(
    CODE_OSS_PRIMARY_STATE_DIR,
    "profile",
    "default",
    "keybindings.json",
  );
  const profileDir = Path.dirname(keybindingsPath);
  try {
    FS.mkdirSync(profileDir, { recursive: true });
    let timeout: ReturnType<typeof setTimeout> | null = null;
    keybindingsWatcher = FS.watch(profileDir, (eventType, filename) => {
      if (filename === "keybindings.json") {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          configureApplicationMenu();
          setupKeybindingsWatcher();
        }, 500);
      }
    });
  } catch (e) {
    // ignore
  }
}

function getActiveAccelerator(command: string): string | undefined {
  const keybindingsPath = Path.join(
    CODE_OSS_PRIMARY_STATE_DIR,
    "profile",
    "default",
    "keybindings.json",
  );
  let userBindings: Array<{ key: string; command: string; when?: string }> = [];
  try {
    if (FS.existsSync(keybindingsPath)) {
      userBindings = JSON.parse(FS.readFileSync(keybindingsPath, "utf-8"));
    }
  } catch (e) {
    // ignore
  }

  const binding =
    [...userBindings].reverse().find((b: any) => b.command === command) ||
    DEFAULT_KEYBINDINGS.find((b: any) => b.command === command);

  if (!binding) return undefined;

  const shortcut = parseKeybindingShortcut(binding.key);
  if (!shortcut) return undefined;

  const parts: string[] = [];
  if (shortcut.modKey) parts.push("CmdOrCtrl");
  if (shortcut.metaKey) parts.push("Meta");
  if (shortcut.ctrlKey) parts.push("Control");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");

  if (!shortcut.key) return parts.join("+");

  let key = shortcut.key.toUpperCase();
  if (key === " ") key = "Space";
  else if (key === "ESCAPE") key = "Esc";
  else if (key === "ARROWUP") key = "Up";
  else if (key === "ARROWDOWN") key = "Down";
  else if (key === "ARROWLEFT") key = "Left";
  else if (key === "ARROWRIGHT") key = "Right";

  parts.push(key);
  return parts.join("+");
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: getActiveAccelerator("window.settings") ?? "CmdOrCtrl+,",
          click: () => dispatchMenuAction("open-settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "Workspace",
      submenu: [
        {
          label: "New Tab",
          accelerator: getActiveAccelerator("tab.new") ?? "CmdOrCtrl+Shift+N",
          click: () => dispatchMenuAction("tab-new"),
        },
        ...(process.platform === "darwin"
          ? []
          : [
              {
                label: "Settings...",
                accelerator: getActiveAccelerator("window.settings") ?? "CmdOrCtrl+,",
                click: () => dispatchMenuAction("open-settings"),
              },
              { type: "separator" as const },
            ]),
        { type: "separator" as const },
        process.platform === "darwin"
          ? // cmd+W closes the active tab (see Tabs menu); window close moves to
            // cmd+shift+W, matching the browser convention.
            {
              role: "close" as const,
              accelerator: getActiveAccelerator("window.close") ?? "CmdOrCtrl+Shift+W",
            }
          : { role: "quit" as const },
      ],
    },
    { role: "editMenu" },
    {
      label: "Tabs",
      submenu: [
        {
          label: "Close Tab",
          accelerator: getActiveAccelerator("tab.close") ?? "CmdOrCtrl+W",
          click: () => dispatchMenuAction("tab-close"),
        },
        { type: "separator" },
        {
          label: "Next Tab",
          accelerator: getActiveAccelerator("tab.next") ?? "CmdOrCtrl+Shift+]",
          click: () => dispatchMenuAction("tab-next"),
        },
        {
          label: "Previous Tab",
          accelerator: getActiveAccelerator("tab.prev") ?? "CmdOrCtrl+Shift+[",
          click: () => dispatchMenuAction("tab-prev"),
        },
        // Hidden duplicates so Ctrl+Tab / Ctrl+Shift+Tab also cycle tabs.
        {
          label: "Next Tab",
          accelerator: "Control+Tab",
          visible: false,
          click: () => dispatchMenuAction("tab-next"),
        },
        {
          label: "Previous Tab",
          accelerator: "Control+Shift+Tab",
          visible: false,
          click: () => dispatchMenuAction("tab-prev"),
        },
        { type: "separator" },
        ...Array.from({ length: 9 }, (_, index) => ({
          label: `Go to Tab ${index + 1}`,
          accelerator: `Alt+${index + 1}`,
          click: () => dispatchMenuAction(`tab-go-${index + 1}`),
        })),
      ],
    },
    {
      label: "Tools",
      submenu: [
        ...(
          [
            ["Code", "code"],
            ["Agents", "agents"],
            ["Server", "server"],
            ["Git", "git"],
            ["Browser", "browser"],
            ["Testing", "testing"],
          ] as const
        ).map(([label, kind]) => ({
          label,
          click: () => dispatchMenuAction(`tool-kind-${kind}`),
        })),
        { type: "separator" },
        {
          label: "Switch Tool by Position",
          submenu: Array.from({ length: 9 }, (_, index) => ({
            label: `Tool ${index + 1}`,
            accelerator: `CmdOrCtrl+${index + 1}`,
            click: () => dispatchMenuAction(`tool-go-${index + 1}`),
          })),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        ...(isDevelopment
          ? ([
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ] as MenuItemConstructorOptions[])
          : []),
        { role: "resetZoom" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+Plus", visible: false },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Check for Updates...",
          click: () => handleCheckForUpdatesMenuClick(),
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    Path.join(__dirname, "../resources", fileName),
    Path.join(__dirname, "../prod-resources", fileName),
    Path.join(process.resourcesPath, "resources", fileName),
    Path.join(process.resourcesPath, fileName),
  ];

  for (const candidate of candidates) {
    if (FS.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getSafeIconTheme(rawTheme: unknown): DesktopIconTheme | null {
  return rawTheme === "light" || rawTheme === "dark" ? rawTheme : null;
}

function readDesktopPreferences(): DesktopPreferences {
  try {
    const raw = FS.readFileSync(DESKTOP_PREFERENCES_PATH, "utf8");
    const parsed = JSON.parse(raw) as DesktopPreferences;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeDesktopPreferences(preferences: DesktopPreferences): void {
  FS.mkdirSync(STATE_DIR, { recursive: true });
  FS.writeFileSync(DESKTOP_PREFERENCES_PATH, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
}

function loadDesktopIconThemePreference(): DesktopIconTheme {
  return readDesktopPreferences().iconTheme ?? DEFAULT_DESKTOP_ICON_THEME;
}

function shouldConfirmBeforeQuit(): boolean {
  return readDesktopPreferences().confirmBeforeQuit !== false;
}

function setConfirmBeforeQuit(confirmBeforeQuit: boolean): void {
  writeDesktopPreferences({ ...readDesktopPreferences(), confirmBeforeQuit });
}

function resolveIconPath(
  ext: "ico" | "icns" | "png",
  theme: DesktopIconTheme = currentDesktopIconTheme,
): string | null {
  return resolveResourcePath(`icon-${theme}.${ext}`) ?? resolveResourcePath(`icon.${ext}`);
}

function applyDesktopIconTheme(theme: DesktopIconTheme): void {
  currentDesktopIconTheme = theme;
  writeDesktopPreferences({ ...readDesktopPreferences(), iconTheme: theme });

  if (process.platform === "darwin" && app.dock) {
    const iconPath = resolveIconPath("png", theme);
    if (iconPath) {
      app.dock.setIcon(iconPath);
    }
    return;
  }

  const ext = process.platform === "win32" ? "ico" : "png";
  const iconPath = resolveIconPath(ext, theme);
  if (!iconPath) {
    return;
  }

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.setIcon(iconPath);
  }
}

function isDirectory(pathname: string): boolean {
  return FS.existsSync(pathname) && FS.statSync(pathname).isDirectory();
}

/**
 * Resolve the Electron userData directory path.
 *
 * Electron derives the default userData path from `productName` in
 * package.json, which currently produces directories with spaces and
 * parentheses (e.g. `~/.config/Tabs` on Linux). This is
 * unfriendly for shell usage and violates Linux naming conventions.
 *
 * We override it to a clean lowercase name (`tabs`). If the legacy
 * directory already exists we keep using it so existing users don't
 * lose their Chromium profile data (localStorage, cookies, sessions).
 */
function resolveUserDataPath(): string {
  return resolveUserDataPathWithFs({
    isDevelopment,
    logger: {
      warn: (msg) => writeDesktopLogHeader(msg),
      info: (msg) => writeDesktopLogHeader(msg),
    },
  });
}

function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  const commitHash = resolveAboutCommitHash();
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    version: commitHash ?? "unknown",
  });

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  applyDesktopIconTheme(currentDesktopIconTheme);
}

function clearUpdatePollTimer(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

function emitUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
  }
}

function setUpdateState(patch: Partial<DesktopUpdateState>): void {
  updateState = { ...updateState, ...patch };
  emitUpdateState();
}

function normalizeUpdateReleaseNotes(
  notes: string | ReadonlyArray<{ readonly note?: string | null }> | null | undefined,
): string | null {
  const text = Array.isArray(notes)
    ? notes
        .map((entry) => entry.note?.trim() ?? "")
        .filter(Boolean)
        .join("\n\n")
    : typeof notes === "string"
      ? notes.trim()
      : "";
  return text ? text.slice(0, 50_000) : null;
}

function shouldEnableAutoUpdates(): boolean {
  return (
    getAutoUpdateDisabledReason({
      isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv: process.env.TABS_DISABLE_AUTO_UPDATE === "1",
    }) === null
  );
}

async function checkForUpdates(reason: string): Promise<void> {
  if (isQuitting || !updaterConfigured || updateCheckInFlight) return;
  if (
    updateState.status === "downloading" ||
    updateState.status === "downloaded" ||
    updateState.status === "installing"
  ) {
    console.info(
      `[desktop-updater] Skipping update check (${reason}) while status=${updateState.status}.`,
    );
    return;
  }
  updateCheckInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnCheckStart(updateState, new Date().toISOString()));
  console.info(`[desktop-updater] Checking for updates (${reason})...`);

  try {
    if (macPreviewUpdater) {
      const update = await macPreviewUpdater.checkForUpdates();
      if (update) {
        setUpdateState(
          reduceDesktopUpdateStateOnUpdateAvailable(
            updateState,
            update.version,
            new Date().toISOString(),
            update.releaseNotes,
          ),
        );
      } else {
        setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
      }
    } else {
      await autoUpdater.checkForUpdates();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(
      reduceDesktopUpdateStateOnCheckFailure(updateState, message, new Date().toISOString()),
    );
    console.error(`[desktop-updater] Failed to check for updates: ${message}`);
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAvailableUpdate(): Promise<{
  accepted: boolean;
  completed: boolean;
}> {
  if (!updaterConfigured || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false };
  }
  updateDownloadInFlight = true;
  linuxDownloadedUpdatePath = null;
  windowsDownloadedUpdatePath = null;
  setUpdateState(reduceDesktopUpdateStateOnDownloadStart(updateState));
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  console.info("[desktop-updater] Downloading update...");

  try {
    if (macPreviewUpdater) {
      const version = await macPreviewUpdater.downloadUpdate((percent) => {
        if (shouldBroadcastDownloadProgress(updateState, percent) || updateState.message !== null) {
          setUpdateState(reduceDesktopUpdateStateOnDownloadProgress(updateState, percent));
        }
      });
      setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, version));
    } else {
      const downloadedFiles = await downloadNativeUpdateWithFallback({
        isDifferentialDownloadDisabled: () => autoUpdater.disableDifferentialDownload,
        setDifferentialDownloadDisabled: (disabled) => {
          autoUpdater.disableDifferentialDownload = disabled;
        },
        download: () => autoUpdater.downloadUpdate(),
        log: (message) => console.warn(`[desktop-updater] ${message}`),
      });
      if (process.platform === "linux") {
        linuxDownloadedUpdatePath =
          downloadedFiles.find((file) => file.toLowerCase().endsWith(".appimage")) ?? null;
        if (!linuxDownloadedUpdatePath) {
          throw new Error("The updater did not provide a downloaded AppImage file.");
        }
      } else if (process.platform === "win32") {
        windowsDownloadedUpdatePath =
          downloadedFiles.find((file) => file.toLowerCase().endsWith(".exe")) ?? null;
        assertWindowsInstallerReady(windowsDownloadedUpdatePath);
      }
    }
    return { accepted: true, completed: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState(reduceDesktopUpdateStateOnDownloadFailure(updateState, message));
    console.error(`[desktop-updater] Failed to download update: ${message}`);
    return { accepted: true, completed: false };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDownloadedUpdate(): Promise<{
  accepted: boolean;
  completed: boolean;
}> {
  if (isQuitting || !updaterConfigured || updateState.status !== "downloaded") {
    return { accepted: false, completed: false };
  }

  isQuitting = true;
  updateInstallInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnInstallStart(updateState));
  try {
    if (macPreviewUpdater) {
      await macPreviewUpdater.stageUpdate();
      await macPreviewUpdater.quitAndInstall(process.pid);
    } else {
      assertUpdateInstallEnvironment({
        platform: process.platform,
        appImagePath: process.env.APPIMAGE,
      });
      if (process.platform === "linux") {
        if (!linuxDownloadedUpdatePath || !process.env.APPIMAGE) {
          throw new Error("The downloaded AppImage is unavailable; download the update again.");
        }
        preparedLinuxUpdate = await prepareLinuxAppImageUpdate({
          currentAppImagePath: process.env.APPIMAGE,
          downloadedAppImagePath: linuxDownloadedUpdatePath,
          logPath: Path.join(app.getPath("userData"), "appimage-update.log"),
        });
      } else {
        assertWindowsInstallerReady(windowsDownloadedUpdatePath);
        nativeUpdateInstallPending = true;
      }
    }

    // From here onward the regular before-quit path owns session flushing and
    // backend shutdown. A refused native install must leave the app usable.
    isQuittingConfirmed = true;
    updateInstallHandoffTimer = setTimeout(() => {
      updateInstallHandoffTimer = null;
      if (!updateInstallInFlight || isCleaningUp) return;
      const message = "The update installer did not begin shutdown. Try installing again.";
      recoverFailedUpdateInstall(message);
      console.error(`[desktop-updater] ${message}`);
    }, 15_000);
    updateInstallHandoffTimer.unref();
    // Native quitAndInstall starts the installer before Electron emits
    // before-quit. Begin a normal quit instead, then hand off to the installer
    // after the shared async cleanup path has flushed every session.
    app.quit();
    return { accepted: true, completed: true };
  } catch (error: unknown) {
    const message = formatErrorMessage(error);
    recoverFailedUpdateInstall(message);
    console.error(`[desktop-updater] Failed to install update: ${message}`);
    return { accepted: true, completed: false };
  }
}

function configureAutoUpdater(): void {
  const enabled = shouldEnableAutoUpdates();
  setUpdateState({
    ...createInitialDesktopUpdateState(app.getVersion(), desktopRuntimeInfo),
    enabled,
    status: enabled ? "idle" : "disabled",
  });
  if (!enabled) {
    return;
  }
  updaterConfigured = true;

  const githubToken =
    process.env.TABS_DESKTOP_UPDATE_GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";
  const appUpdateYml = readAppUpdateYml();
  if (process.platform === "darwin") {
    const owner = appUpdateYml?.owner?.trim();
    const repo = appUpdateYml?.repo?.trim();
    if (!owner || !repo) {
      updaterConfigured = false;
      setUpdateState({
        ...updateState,
        enabled: false,
        status: "disabled",
        message: "The macOS preview update repository is not configured.",
      });
      return;
    }
    const appBundlePath = Path.resolve(process.execPath, "..", "..", "..");
    macPreviewUpdater = new MacPreviewUpdater({
      appBundlePath,
      currentVersion: app.getVersion(),
      repository: `${owner}/${repo}`,
      arch: desktopRuntimeInfo.hostArch === "arm64" ? "arm64" : "x64",
      tempDirectory: app.getPath("temp"),
      ...(githubToken ? { requestHeaders: { Authorization: `Bearer ${githubToken}` } } : {}),
    });
    setUpdateState({ ...updateState, distribution: "unsigned-preview" });
    console.info(
      "[desktop-updater] Using Ed25519-verified macOS preview updates. The app remains ad-hoc signed and is not notarized.",
    );
  }
  if (githubToken) {
    // When a token is provided, re-configure the feed with `private: true` so
    // electron-updater uses the GitHub API (api.github.com) instead of the
    // public Atom feed (github.com/…/releases.atom) which rejects Bearer auth.
    if (!macPreviewUpdater && appUpdateYml?.provider === "github") {
      autoUpdater.setFeedURL({
        ...appUpdateYml,
        provider: "github" as const,
        private: true,
        token: githubToken,
      });
    }
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // Keep alpha branding, but force all installs onto the stable update track.
  autoUpdater.channel = DESKTOP_UPDATE_CHANNEL;
  autoUpdater.allowPrerelease = DESKTOP_UPDATE_ALLOW_PRERELEASE;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(desktopRuntimeInfo);
  let lastLoggedDownloadMilestone = -1;

  if (isArm64HostRunningIntelBuild(desktopRuntimeInfo)) {
    console.info(
      "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
    );
  }

  if (!macPreviewUpdater)
    autoUpdater.on("checking-for-update", () => {
      console.info("[desktop-updater] Looking for updates...");
    });
  if (!macPreviewUpdater)
    autoUpdater.on("update-available", (info) => {
      setUpdateState(
        reduceDesktopUpdateStateOnUpdateAvailable(
          updateState,
          info.version,
          new Date().toISOString(),
          normalizeUpdateReleaseNotes(info.releaseNotes),
        ),
      );
      lastLoggedDownloadMilestone = -1;
      console.info(`[desktop-updater] Update available: ${info.version}`);
    });
  if (!macPreviewUpdater)
    autoUpdater.on("update-not-available", () => {
      setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
      lastLoggedDownloadMilestone = -1;
      console.info("[desktop-updater] No updates available.");
    });
  if (!macPreviewUpdater)
    autoUpdater.on("error", (error) => {
      const message = formatErrorMessage(error);
      if (
        !autoUpdater.disableDifferentialDownload &&
        message.toLowerCase().includes("differential")
      ) {
        console.warn(
          "[desktop-updater] Differential download failed, falling back to full download",
        );
        autoUpdater.disableDifferentialDownload = true;
      }
      if (updateInstallInFlight && !isCleaningUp) {
        recoverFailedUpdateInstall(message);
        console.error(`[desktop-updater] Native installer failed to start: ${message}`);
        return;
      }
      if (!updateCheckInFlight && !updateDownloadInFlight) {
        setUpdateState({
          status: "error",
          message,
          checkedAt: new Date().toISOString(),
          downloadPercent: null,
          errorContext: resolveUpdaterErrorContext(),
          canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
        });
      }
      console.error(`[desktop-updater] Updater error: ${message}`);
    });
  if (!macPreviewUpdater)
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.floor(progress.percent);
      if (
        shouldBroadcastDownloadProgress(updateState, progress.percent) ||
        updateState.message !== null
      ) {
        setUpdateState(reduceDesktopUpdateStateOnDownloadProgress(updateState, progress.percent));
      }
      const milestone = percent - (percent % 10);
      if (milestone > lastLoggedDownloadMilestone) {
        lastLoggedDownloadMilestone = milestone;
        console.info(`[desktop-updater] Download progress: ${percent}%`);
      }
    });
  if (!macPreviewUpdater)
    autoUpdater.on("update-downloaded", (info) => {
      setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, info.version));
      console.info(`[desktop-updater] Update downloaded: ${info.version}`);
    });

  clearUpdatePollTimer();

  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref();

  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref();
}
function scheduleBackendRestart(reason: string): void {
  if (isQuitting || restartTimer) return;

  const delayMs = Math.min(500 * 2 ** restartAttempt, 10_000);
  restartAttempt += 1;
  try {
    console.error(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);
  } catch {
    // Ignore EPIPE if pipes are closed during shutdown
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBackend();
  }, delayMs);
}

function startBackend(): void {
  if (isQuitting || backendProcess) return;

  const backendEntry = resolveBackendEntry();
  if (!FS.existsSync(backendEntry)) {
    scheduleBackendRestart(`missing server entry at ${backendEntry}`);
    return;
  }

  const captureBackendLogs = app.isPackaged && backendLogSink !== null;
  const child = ChildProcess.spawn(process.execPath, [backendEntry, "--bootstrap-fd", "3"], {
    cwd: resolveBackendCwd(),
    // In Electron main, process.execPath points to the Electron binary.
    // Run the child in Node mode so this backend process does not become a GUI app instance.
    env: {
      ...backendChildEnv(),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: captureBackendLogs
      ? ["ignore", "pipe", "pipe", "pipe"]
      : ["ignore", "inherit", "inherit", "pipe"],
  });
  const bootstrapStream = child.stdio[3];
  if (bootstrapStream && "write" in bootstrapStream) {
    bootstrapStream.write(
      `${JSON.stringify({
        mode: "desktop",
        noBrowser: true,
        port: backendPort,
        tabsHome: BASE_DIR,
        authToken: backendAuthToken,
        ...(extensionAiBrokerConfig ? { desktopExtensionBroker: extensionAiBrokerConfig } : {}),
      })}\n`,
    );
    bootstrapStream.end();
  } else {
    child.kill("SIGTERM");
    scheduleBackendRestart("missing desktop bootstrap pipe");
    return;
  }
  backendProcess = child;
  let backendSessionClosed = false;
  const closeBackendSession = (details: string) => {
    if (backendSessionClosed) return;
    backendSessionClosed = true;
    writeBackendSessionBoundary("END", details);
  };
  writeBackendSessionBoundary(
    "START",
    `pid=${child.pid ?? "unknown"} port=${backendPort} cwd=${resolveBackendCwd()}`,
  );
  captureBackendOutput(child);

  child.once("spawn", () => {
    restartAttempt = 0;
  });

  child.on("error", (error) => {
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
    scheduleBackendRestart(error.message);
  });

  child.on("exit", (code, signal) => {
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(
      `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    if (isQuitting) return;
    const reason = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    scheduleBackendRestart(reason);
  });
}

function stopBackend(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000).unref();
  }
}

async function stopBackendProcessAndWait(
  child: ChildProcess.ChildProcess,
  timeoutMs = 5_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function settle(): void {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (exitTimeoutTimer) {
        clearTimeout(exitTimeoutTimer);
      }
      resolve();
    }

    function onExit(): void {
      settle();
    }

    child.once("exit", onExit);

    if (process.platform === "win32" && typeof child.pid === "number") {
      try {
        const killer = ChildProcess.spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.once("error", (error) => {
          writeDesktopLogHeader(`Could not stop backend process tree: ${error.message}`);
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        });
        killer.once("close", (code) => {
          if (code !== 0 && child.exitCode === null && child.signalCode === null) {
            writeDesktopLogHeader(`taskkill exited with code ${code}; stopping backend directly`);
            child.kill("SIGKILL");
          }
        });
      } catch (error) {
        writeDesktopLogHeader(`Could not launch taskkill: ${String(error)}`);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    } else {
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 2_000);
      forceKillTimer.unref();
    }

    exitTimeoutTimer = setTimeout(() => {
      settle();
    }, timeoutMs);
    exitTimeoutTimer.unref();
  });
}

async function stopBackendAndWaitForExit(timeoutMs = 5_000): Promise<void> {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  await stopBackendProcessAndWait(child, timeoutMs);
}

const resolvedShutdown = Effect.runSync(
  Effect.service(DesktopShutdown).pipe(Effect.provide(shutdownLayer)),
);

const performShutdownEffect = Effect.gen(function* () {
  const shutdown = yield* DesktopShutdown;

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      writeDesktopLogHeader("shutdown finalizer running: stopping active backends");
      const activeInstances = backendProcess ? [backendProcess] : [];
      yield* Effect.forEach(
        activeInstances,
        (child) =>
          Effect.tryPromise({
            try: () => stopBackendProcessAndWait(child, 5000),
            catch: (error) => error,
          }).pipe(Effect.catch(() => Effect.void)),
        { concurrency: "unbounded" },
      );
      backendProcess = null;
      writeDesktopLogHeader("shutdown finalizer finished: backends stopped");
    }).pipe(Effect.ensuring(shutdown.markComplete)),
  );

  yield* shutdown.awaitRequest;
}).pipe(Effect.provideService(DesktopShutdown, resolvedShutdown), Effect.scoped);

const shutdownPromise = Effect.runPromise(
  performShutdownEffect.pipe(Effect.catch(() => Effect.void)),
);

function registerIpcHandlers(): void {
  const requireMainRenderer = (event: Electron.IpcMainInvokeEvent): void => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error("Extension management is available only to the Tabs window.");
    }
  };
  ipcMain.removeHandler(EXTENSION_LIST_CHANNEL);
  ipcMain.handle(EXTENSION_LIST_CHANNEL, async (event) => {
    requireMainRenderer(event);
    return extensionViewManager.list().map((entry) => {
      const availableUpdate = exchangeUpdateMonitor.availableFor(entry);
      return availableUpdate ? { ...entry, availableUpdate } : entry;
    });
  });
  ipcMain.removeHandler(EXTENSION_DISCOVER_CHANNEL);
  ipcMain.handle(EXTENSION_DISCOVER_CHANNEL, async (event, query: unknown, cursor: unknown) => {
    requireMainRenderer(event);
    if (typeof query !== "string") throw new Error("Invalid Exchange search query.");
    if (cursor !== undefined && typeof cursor !== "string")
      throw new Error("Invalid Exchange search cursor.");
    const origin = configuredExchangeOrigin(process.env.TABS_EXCHANGE_ORIGIN, !app.isPackaged);
    if (!origin) return null;
    return discoverExchangePage(origin, app.getVersion(), query, cursor ?? null);
  });
  ipcMain.removeHandler(EXTENSION_CHECK_UPDATE_CHANNEL);
  ipcMain.handle(EXTENSION_CHECK_UPDATE_CHANNEL, async (event, id: unknown) => {
    requireMainRenderer(event);
    if (typeof id !== "string" || !/^[a-z][a-z0-9-]{1,62}\.[a-z][a-z0-9-]{1,62}$/.test(id)) {
      throw new Error("Invalid extension identity.");
    }
    const installed = extensionViewManager.list().find((entry) => entry.id === id);
    if (!installed) throw new Error("Extension is not installed.");
    return requireExchangeInstallService().availableUpdate(installed);
  });
  ipcMain.removeHandler(EXTENSION_EXCHANGE_AVAILABLE_CHANNEL);
  ipcMain.handle(EXTENSION_EXCHANGE_AVAILABLE_CHANNEL, (event) => {
    requireMainRenderer(event);
    const origin = configuredExchangeOrigin(process.env.TABS_EXCHANGE_ORIGIN, !app.isPackaged);
    return configuredExchangeTrust(process.env, origin) !== null;
  });
  ipcMain.removeHandler(EXTENSION_EXCHANGE_PREPARE_CHANNEL);
  ipcMain.handle(EXTENSION_EXCHANGE_PREPARE_CHANNEL, async (event, listing: unknown) => {
    requireMainRenderer(event);
    if (!listing || typeof listing !== "object" || Array.isArray(listing)) {
      throw new Error("Invalid Exchange listing.");
    }
    return requireExchangeInstallService().prepare(listing as DesktopExchangeListing);
  });
  ipcMain.removeHandler(EXTENSION_EXCHANGE_CONFIRM_CHANNEL);
  ipcMain.handle(EXTENSION_EXCHANGE_CONFIRM_CHANNEL, async (event, token: unknown) => {
    requireMainRenderer(event);
    if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) {
      throw new Error("Invalid Exchange install token.");
    }
    return requireExchangeInstallService().confirm(token);
  });
  ipcMain.removeHandler(EXTENSION_EXCHANGE_CANCEL_CHANNEL);
  ipcMain.handle(EXTENSION_EXCHANGE_CANCEL_CHANNEL, (event, token: unknown) => {
    requireMainRenderer(event);
    if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) {
      throw new Error("Invalid Exchange install token.");
    }
    exchangeInstallService?.cancel(token);
  });
  ipcMain.removeHandler(EXTENSION_UNINSTALL_CHANNEL);
  ipcMain.handle(EXTENSION_UNINSTALL_CHANNEL, async (event, id: unknown, deleteData: unknown) => {
    requireMainRenderer(event);
    if (
      typeof id !== "string" ||
      !/^[a-z][a-z0-9-]{1,62}\.[a-z][a-z0-9-]{1,62}$/.test(id) ||
      typeof deleteData !== "boolean"
    ) {
      throw new Error("Invalid extension identity.");
    }
    try {
      if (deleteData) await extensionViewManager.uninstallAndDeleteData(id);
      else extensionViewManager.uninstall(id);
    } finally {
      if (
        !extensionViewManager.list().some((entry) => entry.id === id) &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        mainWindow.webContents.send(EXTENSION_CHANGED_CHANNEL);
      }
    }
  });
  ipcMain.removeHandler(EXTENSION_SET_DISABLED_CHANNEL);
  ipcMain.handle(EXTENSION_SET_DISABLED_CHANNEL, (event, id: unknown, disabled: unknown) => {
    requireMainRenderer(event);
    if (
      typeof id !== "string" ||
      !/^[a-z][a-z0-9-]{1,62}\.[a-z][a-z0-9-]{1,62}$/.test(id) ||
      typeof disabled !== "boolean"
    ) {
      throw new Error("Invalid extension disabled state.");
    }
    extensionViewManager.setDisabled(id, disabled);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(EXTENSION_CHANGED_CHANNEL);
    }
  });
  ipcMain.removeHandler(EXTENSION_SET_UPDATES_PINNED_CHANNEL);
  ipcMain.handle(EXTENSION_SET_UPDATES_PINNED_CHANNEL, (event, id: unknown, pinned: unknown) => {
    requireMainRenderer(event);
    if (
      typeof id !== "string" ||
      !/^[a-z][a-z0-9-]{1,62}\.[a-z][a-z0-9-]{1,62}$/.test(id) ||
      typeof pinned !== "boolean"
    ) {
      throw new Error("Invalid extension update pin.");
    }
    extensionViewManager.setUpdatesPinned(id, pinned);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(EXTENSION_CHANGED_CHANNEL);
    }
  });
  ipcMain.removeHandler(EXTENSION_INSTALL_DEV_CHANNEL);
  ipcMain.handle(EXTENSION_INSTALL_DEV_CHANNEL, async (event, directory: unknown) => {
    requireMainRenderer(event);
    if (app.isPackaged || typeof directory !== "string") {
      throw new Error("Unpacked extensions can only be loaded in development builds.");
    }
    return extensionViewManager.installDevelopment(directory);
  });
  ipcMain.removeHandler(EXTENSION_INSTALL_LOCAL_PACKAGE_CHANNEL);
  ipcMain.handle(EXTENSION_INSTALL_LOCAL_PACKAGE_CHANNEL, async (event, archive: unknown) => {
    requireMainRenderer(event);
    if (app.isPackaged || typeof archive !== "string") {
      throw new Error("Local extension packages can only be loaded in development builds.");
    }
    return extensionViewManager.installLocalPackage(archive);
  });
  ipcMain.removeHandler(EXTENSION_ASSIGN_CHANNEL);
  ipcMain.handle(EXTENSION_ASSIGN_CHANNEL, async (event, id: unknown, assignment: unknown) => {
    requireMainRenderer(event);
    if (typeof id !== "string" || !assignment || typeof assignment !== "object") {
      throw new Error("Invalid extension assignment.");
    }
    extensionViewManager.setAssignment(id, assignment as TabsExtensionAssignment);
  });
  ipcMain.removeHandler(EXTENSION_ADD_PROFILE_CHANNEL);
  ipcMain.handle(
    EXTENSION_ADD_PROFILE_CHANNEL,
    async (event, id: unknown, profile: unknown, label: unknown, scope: unknown) => {
      requireMainRenderer(event);
      if (typeof id !== "string" || typeof profile !== "string" || typeof label !== "string") {
        throw new Error("Invalid extension profile.");
      }
      if (scope !== "shared" && scope !== "project") {
        throw new Error("Invalid extension profile scope.");
      }
      extensionViewManager.addProfile(id, profile, label, scope);
    },
  );
  ipcMain.removeHandler(EXTENSION_CREDENTIALS_LIST_CHANNEL);
  ipcMain.handle(EXTENSION_CREDENTIALS_LIST_CHANNEL, (event, id: unknown) => {
    requireMainRenderer(event);
    if (typeof id !== "string") throw new Error("Invalid extension identity.");
    return extensionViewManager.listCredentialStatuses(id);
  });
  ipcMain.removeHandler(EXTENSION_CREDENTIAL_SET_CHANNEL);
  ipcMain.handle(
    EXTENSION_CREDENTIAL_SET_CHANNEL,
    (event, id: unknown, profileId: unknown, host: unknown, value: unknown, projectId: unknown) => {
      requireMainRenderer(event);
      if (
        typeof id !== "string" ||
        typeof profileId !== "string" ||
        typeof host !== "string" ||
        (value !== null && typeof value !== "string") ||
        (projectId !== undefined && typeof projectId !== "string")
      ) {
        throw new Error("Invalid extension credential request.");
      }
      extensionViewManager.setProfileCredential(id, profileId, host, value, projectId);
      mainWindow?.webContents.send(EXTENSION_CHANGED_CHANNEL);
    },
  );
  ipcMain.removeHandler(EXTENSION_ACTIVATE_CHANNEL);
  ipcMain.handle(EXTENSION_ACTIVATE_CHANNEL, async (event, input: unknown) => {
    requireMainRenderer(event);
    if (!input || typeof input !== "object") throw new Error("Invalid extension view.");
    const value = input as DesktopExtensionViewInput;
    if (
      ![value.extensionId, value.toolId, value.projectId, value.profileId].every(
        (item) => typeof item === "string" && item.length > 0,
      )
    )
      throw new Error("Invalid extension view.");
    const before = extensionViewManager.list().find((entry) => entry.id === value.extensionId);
    if (before?.source === "exchange") {
      if (before.revoked) throw new Error("This extension version has been revoked.");
      await checkInstalledExchangeStatus(before.id);
      const after = extensionViewManager.list().find((entry) => entry.id === value.extensionId);
      if (!after || after.digest !== before.digest || after.revoked) {
        throw new Error("Extension status changed; select the tool again.");
      }
    }
    await extensionViewManager.activate(value);
  });
  ipcMain.removeHandler(EXTENSION_SET_BOUNDS_CHANNEL);
  ipcMain.handle(EXTENSION_SET_BOUNDS_CHANNEL, async (event, input: unknown) => {
    requireMainRenderer(event);
    if (!input || typeof input !== "object") return;
    extensionViewManager.setBounds(input as DesktopExtensionBoundsInput);
  });
  ipcMain.removeHandler(EXTENSION_HIDE_CHANNEL);
  ipcMain.handle(EXTENSION_HIDE_CHANNEL, async (event) => {
    requireMainRenderer(event);
    extensionViewManager.hide();
    applyAvailableExchangeUpdates();
  });
  ipcMain.removeHandler(EXTENSION_STORAGE_CHANNEL);
  ipcMain.handle(EXTENSION_STORAGE_CHANNEL, (event, operation: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Extension storage is available only to the main frame.");
    }
    return extensionViewManager.invokeStorage(
      event.sender,
      operation as Parameters<ExtensionViewManager["invokeStorage"]>[1],
    );
  });
  ipcMain.removeHandler(EXTENSION_WORKSPACE_READ_CHANNEL);
  ipcMain.removeHandler(EXTENSION_GIT_STATUS_CHANNEL);
  ipcMain.removeHandler(EXTENSION_NETWORK_GET_CHANNEL);
  ipcMain.removeHandler(EXTENSION_LOGIC_INVOKE_CHANNEL);
  ipcMain.handle(EXTENSION_LOGIC_INVOKE_CHANNEL, (event, commandId: unknown, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Extension commands are available only to the main frame.");
    }
    return extensionViewManager.invokeLogic(event.sender, commandId as string, input);
  });
  ipcMain.handle(
    EXTENSION_NETWORK_GET_CHANNEL,
    (event, rawUrl: unknown, useCredential: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame) {
        throw new Error("Extension network access is available only to the main frame.");
      }
      if (useCredential !== undefined && typeof useCredential !== "boolean") {
        throw new Error("Invalid network credential option.");
      }
      return extensionViewManager.invokeNetworkGetText(
        event.sender,
        rawUrl as string,
        useCredential === true,
      );
    },
  );
  ipcMain.handle(EXTENSION_WORKSPACE_READ_CHANNEL, async (event, relativePath: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Extension workspace access is available only to the main frame.");
    }
    return extensionViewManager.invokeWorkspaceRead(
      event.sender,
      relativePath as string,
      async (projectId, path) => {
        if (!backendHttpUrl || !backendAuthToken)
          throw new Error("Project backend is unavailable.");
        const response = await fetch(`${backendHttpUrl}/internal/extensions/read-project-file`, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "X-Tabs-Backend-Token": backendAuthToken,
          },
          body: JSON.stringify({ projectId, relativePath: path }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok)
          throw new Error("Project file is unavailable or outside the granted workspace.");
        const value: unknown = await response.json();
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as { contents?: unknown }).contents !== "string"
        ) {
          throw new Error("Invalid project file response.");
        }
        return (value as { contents: string }).contents;
      },
    );
  });
  ipcMain.handle(EXTENSION_GIT_STATUS_CHANNEL, async (event) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Extension Git status is available only to the main frame.");
    }
    return extensionViewManager.invokeGitStatus(event.sender, async (projectId) => {
      if (!backendHttpUrl || !backendAuthToken) throw new Error("Project backend is unavailable.");
      const response = await fetch(`${backendHttpUrl}/internal/extensions/git-status`, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-Tabs-Backend-Token": backendAuthToken,
        },
        body: JSON.stringify({ projectId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Git status is unavailable for this project.");
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        typeof (value as { branch?: unknown }).branch !== "string" ||
        typeof (value as { dirty?: unknown }).dirty !== "boolean"
      ) {
        throw new Error("Invalid Git status response.");
      }
      return value as { branch: string; dirty: boolean };
    });
  });
  ipcMain.removeHandler(HOST_POWER_GET_CHANNEL);
  ipcMain.handle(HOST_POWER_GET_CHANNEL, () => readHostPowerSnapshot());

  ipcMain.removeAllListeners(GET_WS_URL_CHANNEL);
  ipcMain.on(GET_WS_URL_CHANNEL, (event) => {
    event.returnValue = backendWsUrl;
  });

  ipcMain.removeAllListeners(GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL);
  ipcMain.on(GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL, (event) => {
    event.returnValue =
      backendHttpUrl && backendWsUrl
        ? [
            {
              id: "primary",
              label: OS.hostname() || "This Mac",
              httpBaseUrl: backendHttpUrl,
              wsBaseUrl: backendWsUrl,
            },
          ]
        : [];
  });

  const connectionCatalogPath = Path.join(app.getPath("userData"), "connection-catalog.json");
  ipcMain.removeHandler(GET_CONNECTION_CATALOG_CHANNEL);
  ipcMain.handle(GET_CONNECTION_CATALOG_CHANNEL, async () => {
    try {
      return await FS.promises.readFile(connectionCatalogPath, "utf8");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : Promise.reject(error);
    }
  });
  ipcMain.removeHandler(SET_CONNECTION_CATALOG_CHANNEL);
  ipcMain.handle(SET_CONNECTION_CATALOG_CHANNEL, async (_event, catalog: unknown) => {
    if (typeof catalog !== "string") return false;
    await FS.promises.mkdir(Path.dirname(connectionCatalogPath), {
      recursive: true,
    });
    await FS.promises.writeFile(connectionCatalogPath, catalog, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  });
  ipcMain.removeHandler(CLEAR_CONNECTION_CATALOG_CHANNEL);
  ipcMain.handle(CLEAR_CONNECTION_CATALOG_CHANNEL, async () => {
    await FS.promises.rm(connectionCatalogPath, { force: true });
  });

  ipcMain.removeHandler(DISCOVER_SSH_HOSTS_CHANNEL);
  ipcMain.handle(DISCOVER_SSH_HOSTS_CHANNEL, async () =>
    (await getSshEnvironmentBridge()).discoverHosts(),
  );
  ipcMain.removeHandler(ENSURE_SSH_ENVIRONMENT_CHANNEL);
  ipcMain.handle(
    ENSURE_SSH_ENVIRONMENT_CHANNEL,
    async (
      _event,
      input: {
        target: DesktopSshEnvironmentTarget;
        options?: { issuePairingToken?: boolean };
      },
    ) =>
      (await getSshEnvironmentBridge()).ensureEnvironment(
        input.target,
        input.options?.issuePairingToken ?? true,
      ),
  );
  ipcMain.removeHandler(DISCONNECT_SSH_ENVIRONMENT_CHANNEL);
  ipcMain.handle(
    DISCONNECT_SSH_ENVIRONMENT_CHANNEL,
    async (_event, target: DesktopSshEnvironmentTarget) =>
      (await getSshEnvironmentBridge()).disconnectEnvironment(target),
  );
  ipcMain.removeHandler(FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL);
  ipcMain.handle(
    FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL,
    async (_event, input: { httpBaseUrl: string }) =>
      (await getSshEnvironmentBridge()).fetchDescriptor(input.httpBaseUrl),
  );
  ipcMain.removeHandler(BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL);
  ipcMain.handle(
    BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL,
    async (
      _event,
      input: {
        httpBaseUrl: string;
        credential: string;
      },
    ) =>
      (await getSshEnvironmentBridge()).bootstrapBearerSession(input.httpBaseUrl, input.credential),
  );
  ipcMain.removeHandler(FETCH_SSH_SESSION_STATE_CHANNEL);
  ipcMain.handle(
    FETCH_SSH_SESSION_STATE_CHANNEL,
    async (
      _event,
      input: {
        httpBaseUrl: string;
        bearerToken: string;
      },
    ) => (await getSshEnvironmentBridge()).fetchSessionState(input.httpBaseUrl, input.bearerToken),
  );
  ipcMain.removeHandler(ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL);
  ipcMain.handle(
    ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL,
    async (
      _event,
      input: {
        httpBaseUrl: string;
        bearerToken: string;
      },
    ) =>
      (await getSshEnvironmentBridge()).issueWebSocketTicket(input.httpBaseUrl, input.bearerToken),
  );
  ipcMain.removeHandler(RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL);
  ipcMain.handle(
    RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL,
    async (
      _event,
      input: {
        requestId: string;
        password: string | null;
      },
    ) => resolveSshPasswordPrompt(input.requestId, input.password),
  );

  ipcMain.removeHandler(GET_CONFIRM_BEFORE_QUIT_CHANNEL);
  ipcMain.handle(GET_CONFIRM_BEFORE_QUIT_CHANNEL, async () => shouldConfirmBeforeQuit());

  ipcMain.removeHandler(SET_CONFIRM_BEFORE_QUIT_CHANNEL);
  ipcMain.handle(SET_CONFIRM_BEFORE_QUIT_CHANNEL, async (_event, value: unknown) => {
    if (typeof value === "boolean") {
      setConfirmBeforeQuit(value);
    }
  });

  ipcMain.removeAllListeners(QUIT_CONFIRMATION_RESPONSE_CHANNEL);
  ipcMain.on(QUIT_CONFIRMATION_RESPONSE_CHANNEL, (_event, choice: unknown) => {
    if (!isQuitConfirmationOpen) return;
    if (choice === "cancel") {
      isQuitConfirmationOpen = false;
      return;
    }
    if (choice !== "save-and-quit") return;

    isQuitConfirmationOpen = false;
    codeHostManager.saveAllOpenSessions();
    isQuittingConfirmed = true;
    app.quit();
  });

  ipcMain.removeHandler("get-tailscale-status");
  ipcMain.handle("get-tailscale-status", async () => {
    return getTailscaleStatus();
  });

  ipcMain.removeHandler(PICK_FOLDER_CHANNEL);
  ipcMain.handle(PICK_FOLDER_CHANNEL, async (_event, rawOptions?: unknown) => {
    const options = (rawOptions ?? null) as Partial<PickFolderOptions> | null;
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const openOptions: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.removeHandler(PICK_FILE_CHANNEL);
  ipcMain.handle(PICK_FILE_CHANNEL, async (_event, rawOptions?: unknown) => {
    const options = (rawOptions ?? null) as Partial<PickFileOptions> | null;
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const openOptions: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.buttonLabel ? { buttonLabel: options.buttonLabel } : {}),
      ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
      ...(Array.isArray(options?.filters) && options.filters.length > 0
        ? { filters: options.filters }
        : {}),
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.removeHandler(CLONE_REPOSITORY_CHANNEL);
  ipcMain.handle(
    CLONE_REPOSITORY_CHANNEL,
    async (_event, rawInput: unknown): Promise<DesktopCloneRepositoryResult> => {
      const input = (rawInput ?? null) as Partial<DesktopCloneRepositoryInput> | null;
      const url = typeof input?.url === "string" ? input.url.trim() : "";
      const parentDir = typeof input?.parentDir === "string" ? input.parentDir : "";

      // Accept remote URLs git understands: scheme-based (https/http/git/ssh) or
      // scp-like (user@host:path). Local-path "URLs" are rejected on purpose —
      // this surface is for cloning remotes, and it keeps the input unambiguous.
      const isPlausibleGitUrl =
        /^(?:https?|git|ssh):\/\/.+/i.test(url) || /^[^@\s]+@[^:\s]+:.+/.test(url);
      if (!isPlausibleGitUrl) {
        return {
          ok: false,
          error: "Enter a valid git URL (https://…, git@…:…, or ssh://…).",
        };
      }
      if (!parentDir || !isDirectory(parentDir)) {
        return { ok: false, error: "Choose a valid destination folder." };
      }

      // Mirror git's own default: the folder is the last path segment minus .git.
      const dirName = url
        .replace(/[/]+$/, "")
        .replace(/\.git$/i, "")
        .split(/[/:]/)
        .pop()
        ?.replace(/[^A-Za-z0-9._-]/g, "");
      if (!dirName) {
        return {
          ok: false,
          error: "Could not derive a folder name from that URL.",
        };
      }

      const dest = Path.join(parentDir, dirName);
      if (FS.existsSync(dest) && FS.readdirSync(dest).length > 0) {
        return {
          ok: false,
          error: `"${dirName}" already exists and is not empty.`,
        };
      }

      try {
        await new Promise<void>((resolve, reject) => {
          ChildProcess.execFile(
            "git",
            ["clone", "--progress", "--", url, dest],
            {
              cwd: parentDir,
              env: process.env,
              timeout: 10 * 60_000,
              maxBuffer: 32 * 1024 * 1024,
            },
            (error, _stdout, stderr) => {
              if (error) {
                const detail = stderr ? stderr.toString().trim() : "";
                reject(new Error(detail || error.message));
              } else {
                resolve();
              }
            },
          );
        });
        return { ok: true, path: dest };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "git clone failed.",
        };
      }
    },
  );

  ipcMain.removeHandler(CONFIRM_CHANNEL);
  ipcMain.handle(CONFIRM_CHANNEL, async (_event, message: unknown) => {
    if (typeof message !== "string") {
      return false;
    }

    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    return showDesktopConfirmDialog(message, owner);
  });

  ipcMain.removeHandler(SET_THEME_CHANNEL);
  ipcMain.handle(SET_THEME_CHANNEL, async (_event, payload: unknown) => {
    let themeId: string | null = null;
    let preference: string | null = null;
    let customConfig: any = null;

    if (typeof payload === "object" && payload !== null && "themeId" in payload) {
      themeId = getSafeTheme((payload as any).themeId);
      preference = getSafeTheme((payload as any).preference);
      customConfig = (payload as any).customConfig ?? null;
    } else {
      themeId = getSafeTheme(payload);
    }

    if (!themeId) {
      return;
    }

    const isSystem = preference === "system";
    nativeTheme.themeSource = isSystem
      ? "system"
      : isLightDesktopTheme(themeId, customConfig)
        ? "light"
        : "dark";
    savePersistedDesktopTheme({
      themeId,
      preference: preference ?? themeId,
      customConfig,
    });
    codeControlChannel.setTheme(themeId, customConfig);
    codeHostManager.setTheme(themeId, customConfig);
    notificationOverlayManager.setTheme({
      themeId,
      isDark: !isLightDesktopTheme(themeId, customConfig),
    });
  });

  ipcMain.removeHandler(SET_ICON_THEME_CHANNEL);
  ipcMain.handle(SET_ICON_THEME_CHANNEL, async (_event, rawTheme: unknown) => {
    const theme = getSafeIconTheme(rawTheme);
    if (!theme) {
      return;
    }

    applyDesktopIconTheme(theme);
  });

  ipcMain.removeHandler(SET_AI_PROVIDER_CHANNEL);
  ipcMain.handle(SET_AI_PROVIDER_CHANNEL, async (_event, rawProvider: unknown) => {
    if (rawProvider === "tabs" || rawProvider === "copilot") {
      codeHostManager.setAiProvider(rawProvider);
    }
  });

  ipcMain.removeHandler(SET_ZOOM_FACTOR_CHANNEL);
  ipcMain.handle(SET_ZOOM_FACTOR_CHANNEL, async (_event, rawFactor: unknown) => {
    if (typeof rawFactor === "number" && !isNaN(rawFactor) && rawFactor > 0) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setZoomFactor(rawFactor);
      }
    }
  });

  ipcMain.removeHandler(CONTEXT_MENU_CHANNEL);
  ipcMain.handle(
    CONTEXT_MENU_CHANNEL,
    async (_event, items: ContextMenuItem[], position?: { x: number; y: number }) => {
      const normalizedItems = items
        .filter((item) => typeof item.id === "string" && typeof item.label === "string")
        .map((item) => ({
          id: item.id,
          label: item.label,
          destructive: item.destructive === true,
        }));
      if (normalizedItems.length === 0) {
        return null;
      }

      const popupPosition =
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        position.x >= 0 &&
        position.y >= 0
          ? {
              x: Math.floor(position.x),
              y: Math.floor(position.y),
            }
          : null;

      const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!window) return null;

      return new Promise<string | null>((resolve) => {
        const template: MenuItemConstructorOptions[] = [];
        let hasInsertedDestructiveSeparator = false;
        for (const item of normalizedItems) {
          if (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0) {
            template.push({ type: "separator" });
            hasInsertedDestructiveSeparator = true;
          }
          const itemOption: MenuItemConstructorOptions = {
            label: item.label,
            click: () => resolve(item.id),
          };
          if (item.destructive) {
            const destructiveIcon = getDestructiveMenuIcon();
            if (destructiveIcon) {
              itemOption.icon = destructiveIcon;
            }
          }
          template.push(itemOption);
        }

        const menu = Menu.buildFromTemplate(template);
        menu.popup({
          window,
          ...popupPosition,
          callback: () => resolve(null),
        });
      });
    },
  );

  ipcMain.removeHandler(OPEN_EXTERNAL_CHANNEL);
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, rawUrl: unknown) => {
    const externalUrl = getSafeExternalUrl(rawUrl);
    if (!externalUrl) {
      return false;
    }

    try {
      await shell.openExternal(externalUrl);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.removeHandler(OPEN_POPOUT_WINDOW_CHANNEL);
  ipcMain.handle(OPEN_POPOUT_WINDOW_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) return;
    const { url, title, width, height } = input as {
      url?: unknown;
      title?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (typeof url !== "string" || url.trim().length === 0) return;
    createPopoutWindow(url.trim(), {
      title: typeof title === "string" ? title : undefined,
      width: typeof width === "number" ? width : undefined,
      height: typeof height === "number" ? height : undefined,
    });
  });

  ipcMain.removeHandler(UPDATE_GET_STATE_CHANNEL);
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async () => updateState);

  ipcMain.removeHandler(UPDATE_DOWNLOAD_CHANNEL);
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await downloadAvailableUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(UPDATE_INSTALL_CHANNEL);
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async () => {
    if (isQuitting) {
      return {
        accepted: false,
        completed: false,
        state: updateState,
      } satisfies DesktopUpdateActionResult;
    }
    const result = await installDownloadedUpdate();
    return {
      accepted: result.accepted,
      completed: result.completed,
      state: updateState,
    } satisfies DesktopUpdateActionResult;
  });

  ipcMain.removeHandler(CODE_HOST_GET_STATE_CHANNEL);
  ipcMain.handle(CODE_HOST_GET_STATE_CHANNEL, async () => codeHostManager.getState());

  ipcMain.removeHandler(CODE_HOST_ENSURE_SESSION_CHANNEL);
  ipcMain.handle(CODE_HOST_ENSURE_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { workspaceRoot?: unknown }).workspaceRoot !== "string"
    ) {
      return;
    }
    const projectId = (input as { projectId: string }).projectId;
    const workspaceRoot = (input as { workspaceRoot: string }).workspaceRoot;
    try {
      await codeHostManager.ensureSession({ projectId, workspaceRoot });
    } catch (error) {
      console.error(`[code-oss:${projectId}] ensureSession IPC failed`, error);
      throw error;
    }
  });

  ipcMain.removeHandler(CODE_HOST_ACTIVATE_SESSION_CHANNEL);
  ipcMain.handle(CODE_HOST_ACTIVATE_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    const projectId = (input as { projectId: string }).projectId;
    try {
      await codeHostManager.activateSession({ projectId });
    } catch (error) {
      console.error(`[code-oss:${projectId}] activateSession IPC failed`, error);
      throw error;
    }
  });

  ipcMain.removeHandler(CODE_HOST_HIDE_SESSION_CHANNEL);
  ipcMain.handle(CODE_HOST_HIDE_SESSION_CHANNEL, async () => {
    codeHostManager.hideActiveSession();
  });

  ipcMain.removeHandler(CODE_HOST_CAPTURE_SESSION_CHANNEL);
  ipcMain.handle(CODE_HOST_CAPTURE_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid Code-OSS capture request");
    }
    return codeHostManager.captureSession((input as { projectId: string }).projectId);
  });

  ipcMain.removeHandler(CODE_HOST_OPEN_FILE_CHANNEL);
  ipcMain.handle(CODE_HOST_OPEN_FILE_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { relativePath?: unknown }).relativePath !== "string" ||
      typeof (input as { navigationNonce?: unknown }).navigationNonce !== "number"
    ) {
      return;
    }
    await codeHostManager.openFile({
      projectId: (input as { projectId: string }).projectId,
      relativePath: (input as { relativePath: string }).relativePath,
      navigationNonce: (input as { navigationNonce: number }).navigationNonce,
    });
  });

  ipcMain.removeHandler(CODE_HOST_SET_BOUNDS_CHANNEL);
  ipcMain.handle(CODE_HOST_SET_BOUNDS_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { x?: unknown }).x !== "number" ||
      typeof (input as { y?: unknown }).y !== "number" ||
      typeof (input as { width?: unknown }).width !== "number" ||
      typeof (input as { height?: unknown }).height !== "number" ||
      typeof (input as { visible?: unknown }).visible !== "boolean"
    ) {
      return;
    }
    codeHostManager.setBounds({
      projectId: (input as { projectId: string }).projectId,
      x: (input as { x: number }).x,
      y: (input as { y: number }).y,
      width: (input as { width: number }).width,
      height: (input as { height: number }).height,
      visible: (input as { visible: boolean }).visible,
    });
  });

  ipcMain.removeHandler(CODE_HOST_SYNC_SESSIONS_CHANNEL);
  ipcMain.handle(CODE_HOST_SYNC_SESSIONS_CHANNEL, async (_event, projectIds: unknown) => {
    if (
      !Array.isArray(projectIds) ||
      !projectIds.every((projectId) => typeof projectId === "string")
    ) {
      return;
    }
    codeHostManager.syncSessions(projectIds);
  });

  ipcMain.removeHandler(CODE_HOST_RECREATE_SESSION_CHANNEL);
  ipcMain.handle(CODE_HOST_RECREATE_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    await codeHostManager.recreateSession((input as { projectId: string }).projectId);
  });

  ipcMain.removeHandler(CODE_HOST_RUN_COMMAND_CHANNEL);
  ipcMain.handle(CODE_HOST_RUN_COMMAND_CHANNEL, async (_event, input: unknown) => {
    // The control channel re-validates against the allowlist; this is just the
    // shape guard for the IPC boundary.
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { commandId?: unknown }).commandId !== "string"
    ) {
      return false;
    }
    const projectId = (input as { projectId: string }).projectId;
    const commandId = (input as { commandId: string }).commandId;
    codeHostManager.focusSession(projectId);
    return codeControlChannel.runCommand(projectId, commandId);
  });

  ipcMain.removeHandler(CODE_HOST_GET_CHROME_STATE_CHANNEL);
  ipcMain.handle(CODE_HOST_GET_CHROME_STATE_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return DEFAULT_CODE_CHROME_STATE;
    }
    return (
      codeControlChannel.getChromeState((input as { projectId: string }).projectId) ??
      DEFAULT_CODE_CHROME_STATE
    );
  });

  ipcMain.removeHandler(WRITE_CLIPBOARD_TEXT_CHANNEL);
  ipcMain.handle(WRITE_CLIPBOARD_TEXT_CHANNEL, async (_event, value: unknown) => {
    if (typeof value !== "string" || value.length > 1_000_000) {
      throw new Error("Invalid clipboard text payload.");
    }
    clipboard.writeText(value);
  });

  ipcMain.removeHandler(READ_CLIPBOARD_TEXT_CHANNEL);
  ipcMain.handle(READ_CLIPBOARD_TEXT_CHANNEL, async (_event, type: unknown) => {
    const clipboardType = type === "selection" ? "selection" : "clipboard";
    return (clipboard as unknown as { readText: (type?: string) => string }).readText(
      clipboardType,
    );
  });

  ipcMain.removeHandler(NOTIFICATION_OVERLAY_SYNC_CHANNEL);
  ipcMain.handle(NOTIFICATION_OVERLAY_SYNC_CHANNEL, async (event, rawToasts: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    notificationOverlayManager.setToasts(normalizeNotificationToasts(rawToasts));
  });

  ipcMain.removeAllListeners(NOTIFICATION_OVERLAY_REPORT_BOUNDS_CHANNEL);
  ipcMain.on(NOTIFICATION_OVERLAY_REPORT_BOUNDS_CHANNEL, (event, bounds: unknown) => {
    if (!notificationOverlayManager.ownsWebContents(event.sender)) return;
    if (
      bounds &&
      typeof bounds === "object" &&
      typeof (bounds as { width?: unknown }).width === "number" &&
      typeof (bounds as { height?: unknown }).height === "number" &&
      Number.isFinite((bounds as { width: number }).width) &&
      Number.isFinite((bounds as { height: number }).height)
    ) {
      notificationOverlayManager.handleReportBounds({
        width: (bounds as { width: number }).width,
        height: (bounds as { height: number }).height,
      });
    }
  });

  ipcMain.removeAllListeners(NOTIFICATION_OVERLAY_ACTION_CHANNEL);
  ipcMain.on(NOTIFICATION_OVERLAY_ACTION_CHANNEL, (event, payload: unknown) => {
    if (!notificationOverlayManager.ownsWebContents(event.sender)) return;
    if (
      payload &&
      typeof payload === "object" &&
      typeof (payload as { toastId?: unknown }).toastId === "string" &&
      typeof (payload as { actionId?: unknown }).actionId === "string"
    ) {
      notificationOverlayManager.handleAction(
        (payload as { toastId: string }).toastId,
        (payload as { actionId: string }).actionId,
      );
    }
  });

  ipcMain.removeAllListeners(NOTIFICATION_OVERLAY_DISMISS_CHANNEL);
  ipcMain.on(NOTIFICATION_OVERLAY_DISMISS_CHANNEL, (event, payload: unknown) => {
    if (!notificationOverlayManager.ownsWebContents(event.sender)) return;
    if (
      payload &&
      typeof payload === "object" &&
      typeof (payload as { toastId?: unknown }).toastId === "string"
    ) {
      notificationOverlayManager.handleDismiss((payload as { toastId: string }).toastId);
    }
  });

  ipcMain.removeAllListeners(NOTIFICATION_OVERLAY_RESTORE_FOCUS_CHANNEL);
  ipcMain.on(NOTIFICATION_OVERLAY_RESTORE_FOCUS_CHANNEL, (event) => {
    if (!notificationOverlayManager.ownsWebContents(event.sender)) return;
    notificationOverlayManager.restoreFocus();
  });

  ipcMain.removeHandler(DESKTOP_CAPTURE_GET_PERMISSION_CHANNEL);
  ipcMain.handle(DESKTOP_CAPTURE_GET_PERMISSION_CHANNEL, async () =>
    desktopCaptureCoordinator.getPermissionStatus(),
  );

  ipcMain.removeHandler(DESKTOP_CAPTURE_REQUEST_PERMISSION_CHANNEL);
  ipcMain.handle(DESKTOP_CAPTURE_REQUEST_PERMISSION_CHANNEL, async () =>
    desktopCaptureCoordinator.requestPermission(),
  );

  ipcMain.removeHandler(DESKTOP_CAPTURE_SCREEN_CHANNEL);
  ipcMain.handle(DESKTOP_CAPTURE_SCREEN_CHANNEL, async (_event, options: unknown) =>
    desktopCaptureCoordinator.captureScreen((options as DesktopCaptureOptions) ?? {}),
  );

  ipcMain.removeHandler(BROWSER_HOST_GET_STATE_CHANNEL);
  ipcMain.handle(BROWSER_HOST_GET_STATE_CHANNEL, async () => browserHostManager.getState());

  ipcMain.removeHandler(BROWSER_HOST_GET_SESSION_STATE_CHANNEL);
  ipcMain.handle(BROWSER_HOST_GET_SESSION_STATE_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return null;
    }
    return browserHostManager.getSessionState(
      (input as { projectId: string }).projectId,
      readBrowserSessionId(input),
    );
  });

  ipcMain.removeHandler("desktop:browser-readiness");
  ipcMain.handle("desktop:browser-readiness", (_event, input) => {
    if (!input || typeof input.url !== "string") throw new Error("Invalid readiness probe.");
    return probeBrowserReadiness(
      input.url,
      typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
        ? input.timeoutMs
        : 2500,
    );
  });

  for (const [channel, action] of [
    [
      "desktop:browser-comparison:configure",
      (input: BrowserComparisonInput) => browserHostManager.comparisons.configure(input),
    ],
    [
      "desktop:browser-comparison:close",
      (input: BrowserComparisonInput) =>
        browserHostManager.comparisons.close(input.projectId, input.comparisonId),
    ],
    [
      "desktop:browser-comparison:capture",
      (input: BrowserComparisonInput) =>
        browserHostManager.comparisons.capture(input.projectId, input.comparisonId),
    ],
  ] as const) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_event, input) => {
      if (!input || typeof input.projectId !== "string" || typeof input.comparisonId !== "string")
        throw new Error("Invalid comparison request.");
      return action(input);
    });
  }

  ipcMain.removeHandler(BROWSER_HOST_ENSURE_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_ENSURE_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { initialUrl?: unknown }).initialUrl !== "string"
    ) {
      return;
    }
    // Allow an empty initialUrl: create a blank "new tab" view that loads
    // nothing until the user navigates. A non-empty URL must be a safe http(s).
    const rawUrl = (input as { initialUrl: string }).initialUrl;
    const safeUrl = rawUrl.trim().length === 0 ? "" : getSafeExternalUrl(rawUrl);
    if (safeUrl === null) {
      return;
    }
    const partition =
      typeof (input as { partition?: unknown }).partition === "string"
        ? (input as { partition: string }).partition
        : undefined;
    await browserHostManager.ensureSession({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      initialUrl: safeUrl,
      partition,
      profileId:
        typeof (input as { profileId?: unknown }).profileId === "string"
          ? (input as { profileId: string }).profileId
          : undefined,
      taskId:
        typeof (input as { taskId?: unknown }).taskId === "string"
          ? (input as { taskId: string }).taskId
          : undefined,
      temporaryAgentTab: (input as { temporaryAgentTab?: unknown }).temporaryAgentTab === true,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_ACTIVATE_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_ACTIVATE_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    await browserHostManager.activateSession({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_HIDE_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_HIDE_SESSION_CHANNEL, async () => {
    browserHostManager.hideActiveSession();
  });

  ipcMain.removeHandler(BROWSER_HOST_NAVIGATE_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_NAVIGATE_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { url?: unknown }).url !== "string"
    ) {
      return;
    }
    const safeUrl = getSafeExternalUrl((input as { url: string }).url);
    if (!safeUrl) {
      return;
    }
    await browserHostManager.navigate({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      url: safeUrl,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_RELOAD_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_RELOAD_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    await browserHostManager.reload({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      ignoreCache: (input as { ignoreCache?: unknown }).ignoreCache === true,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_SET_ZOOM_CHANNEL);
  ipcMain.handle(BROWSER_HOST_SET_ZOOM_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { zoomFactor?: unknown }).zoomFactor !== "number"
    ) {
      return;
    }
    browserHostManager.setZoomFactor({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      zoomFactor: (input as { zoomFactor: number }).zoomFactor,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_SET_AUDIO_MUTED_CHANNEL);
  ipcMain.handle(BROWSER_HOST_SET_AUDIO_MUTED_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { audioMuted?: unknown }).audioMuted !== "boolean"
    ) {
      return;
    }
    browserHostManager.setAudioMuted({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      audioMuted: (input as { audioMuted: boolean }).audioMuted,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_OPEN_PICTURE_IN_PICTURE_CHANNEL);
  ipcMain.handle(BROWSER_HOST_OPEN_PICTURE_IN_PICTURE_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    browserHostManager.openPictureInPicture({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_CLOSE_PICTURE_IN_PICTURE_CHANNEL);
  ipcMain.handle(BROWSER_HOST_CLOSE_PICTURE_IN_PICTURE_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    browserHostManager.closePictureInPicture({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_SET_COLOR_SCHEME_CHANNEL);
  ipcMain.handle(BROWSER_HOST_SET_COLOR_SCHEME_CHANNEL, async (_event, input: unknown) => {
    const colorScheme =
      typeof input === "object" && input !== null
        ? (input as { colorScheme?: unknown }).colorScheme
        : null;
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      (colorScheme !== "system" && colorScheme !== "light" && colorScheme !== "dark")
    ) {
      return;
    }
    await browserHostManager.setColorScheme({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      colorScheme,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_BACK_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_BACK_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    await browserHostManager.goBack({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_FORWARD_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_FORWARD_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    await browserHostManager.goForward({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_TOGGLE_DEVTOOLS_CHANNEL);
  ipcMain.handle(BROWSER_HOST_TOGGLE_DEVTOOLS_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    await browserHostManager.toggleDevTools({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_SET_BOUNDS_CHANNEL);
  ipcMain.removeHandler(BROWSER_HOST_AUTOMATION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_AUTOMATION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { operation?: unknown }).operation !== "string"
    ) {
      throw new Error("Invalid browser automation request.");
    }
    const request = input as {
      projectId: string;
      sessionId?: string;
      operation: string;
      input?: unknown;
    };
    return browserHostManager.runAutomation(request);
  });

  ipcMain.removeHandler(BROWSER_HOST_CAPTURE_SCREENSHOT_CHANNEL);
  ipcMain.handle(BROWSER_HOST_CAPTURE_SCREENSHOT_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid browser screenshot request.");
    }
    return browserHostManager.captureScreenshot({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_MEDIA_SOURCE_CHANNEL);
  ipcMain.handle(BROWSER_HOST_MEDIA_SOURCE_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid browser media-source request.");
    }
    return browserHostManager.getMediaSourceId({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_SAVE_RECORDING_CHANNEL);
  ipcMain.handle(BROWSER_HOST_SAVE_RECORDING_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { mimeType?: unknown }).mimeType !== "string" ||
      !((input as { data?: unknown }).data instanceof Uint8Array)
    ) {
      throw new Error("Invalid browser recording artifact.");
    }
    return browserHostManager.saveRecording({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      mimeType: (input as { mimeType: string }).mimeType,
      data: (input as { data: Uint8Array }).data,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_PICK_ELEMENT_CHANNEL);
  ipcMain.handle(BROWSER_HOST_PICK_ELEMENT_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid browser element-picker request.");
    }
    return browserHostManager.pickElement({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_REVEAL_ARTIFACT_CHANNEL);
  ipcMain.handle(BROWSER_HOST_REVEAL_ARTIFACT_CHANNEL, async (_event, artifactPath: unknown) => {
    if (typeof artifactPath !== "string") throw new Error("Invalid browser artifact path.");
    browserHostManager.revealArtifact(artifactPath);
  });

  ipcMain.removeHandler(BROWSER_HOST_COPY_ARTIFACT_CHANNEL);
  ipcMain.handle(BROWSER_HOST_COPY_ARTIFACT_CHANNEL, async (_event, artifactPath: unknown) => {
    if (typeof artifactPath !== "string") throw new Error("Invalid browser artifact path.");
    await browserHostManager.copyArtifactToClipboard(artifactPath);
  });

  ipcMain.handle(BROWSER_HOST_SET_BOUNDS_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { x?: unknown }).x !== "number" ||
      typeof (input as { y?: unknown }).y !== "number" ||
      typeof (input as { width?: unknown }).width !== "number" ||
      typeof (input as { height?: unknown }).height !== "number" ||
      typeof (input as { visible?: unknown }).visible !== "boolean"
    ) {
      return;
    }
    browserHostManager.setBounds({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      x: (input as { x: number }).x,
      y: (input as { y: number }).y,
      width: (input as { width: number }).width,
      height: (input as { height: number }).height,
      visible: (input as { visible: boolean }).visible,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_SYNC_SESSIONS_CHANNEL);
  ipcMain.handle(BROWSER_HOST_SYNC_SESSIONS_CHANNEL, async (_event, projectIds: unknown) => {
    if (
      !Array.isArray(projectIds) ||
      !projectIds.every((projectId) => typeof projectId === "string")
    ) {
      return;
    }
    browserHostManager.syncSessions(projectIds);
  });

  ipcMain.removeHandler(BROWSER_HOST_RECREATE_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_RECREATE_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    const partition =
      typeof (input as { partition?: unknown }).partition === "string"
        ? (input as { partition: string }).partition
        : undefined;
    await browserHostManager.recreateSession(
      (input as { projectId: string }).projectId,
      readBrowserSessionId(input),
      partition,
    );
  });

  ipcMain.removeHandler(BROWSER_HOST_CLEAR_PROFILE_DATA_CHANNEL);
  ipcMain.handle(BROWSER_HOST_CLEAR_PROFILE_DATA_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { profileId?: unknown }).profileId !== "string"
    ) {
      return;
    }
    await browserHostManager.clearProfileData((input as { profileId: string }).profileId);
  });

  ipcMain.removeHandler(BROWSER_HOST_CLEAR_SESSION_DATA_CHANNEL);
  ipcMain.handle(BROWSER_HOST_CLEAR_SESSION_DATA_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    ) {
      return;
    }
    await browserHostManager.clearSessionData(
      (input as { projectId: string }).projectId,
      readBrowserSessionId(input),
    );
  });

  ipcMain.removeHandler(BROWSER_HOST_OPEN_PROFILE_LOGIN_WINDOW_CHANNEL);
  ipcMain.handle(BROWSER_HOST_OPEN_PROFILE_LOGIN_WINDOW_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { profileId?: unknown }).profileId !== "string"
    ) {
      return;
    }
    const profileId = (input as { profileId: string }).profileId;
    const url =
      typeof (input as { url?: unknown }).url === "string"
        ? (input as { url: string }).url
        : undefined;
    await browserHostManager.openProfileLoginWindow(profileId, url);
  });

  ipcMain.removeHandler(BROWSER_HOST_GET_PROFILE_DOMAINS_CHANNEL);
  ipcMain.handle(BROWSER_HOST_GET_PROFILE_DOMAINS_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { profileId?: unknown }).profileId !== "string"
    ) {
      throw new Error("Invalid input: profileId is required");
    }
    return await browserHostManager.getProfileDomains((input as { profileId: string }).profileId);
  });

  ipcMain.removeHandler(BROWSER_HOST_INSPECT_PROFILE_CHANNEL);
  ipcMain.handle(BROWSER_HOST_INSPECT_PROFILE_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { profileId?: unknown }).profileId !== "string"
    ) {
      throw new Error("Invalid input: profileId is required");
    }
    return await browserHostManager.inspectProfile((input as { profileId: string }).profileId);
  });

  ipcMain.removeHandler(BROWSER_HOST_CLEAR_PROFILE_DOMAIN_CHANNEL);
  ipcMain.handle(BROWSER_HOST_CLEAR_PROFILE_DOMAIN_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { profileId?: unknown }).profileId !== "string" ||
      typeof (input as { domain?: unknown }).domain !== "string"
    ) {
      return;
    }
    const { profileId, domain } = input as {
      profileId: string;
      domain: string;
    };
    await browserHostManager.clearProfileDomain(profileId, domain);
  });

  ipcMain.removeHandler(BROWSER_HOST_LIST_IMPORT_SOURCES_CHANNEL);
  ipcMain.handle(BROWSER_HOST_LIST_IMPORT_SOURCES_CHANNEL, async () => {
    return await browserHostManager.listBrowserImportSources();
  });

  ipcMain.removeHandler("desktop:browser-host:cancel-import");
  ipcMain.handle("desktop:browser-host:cancel-import", (_event, requestId: unknown) => {
    if (typeof requestId === "string") browserHostManager.cancelBrowserImport(requestId);
  });

  ipcMain.removeHandler(BROWSER_HOST_IMPORT_COOKIES_CHANNEL);
  ipcMain.handle(BROWSER_HOST_IMPORT_COOKIES_CHANNEL, async (_event, input: unknown) => {
    const decoded = Schema.decodeUnknownSync(BrowserImportInput)(input);
    return await browserHostManager.importBrowserCookies(decoded);
  });

  ipcMain.removeHandler(BROWSER_HOST_RESPOND_PERMISSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_RESPOND_PERMISSION_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) return;
    const { requestId, granted, remember } = input as {
      requestId: string;
      granted: boolean;
      remember?: boolean;
    };
    if (typeof requestId !== "string" || typeof granted !== "boolean") return;
    browserHostManager.respondPermission(requestId, granted, remember ?? true);
  });

  ipcMain.removeHandler(BROWSER_HOST_GET_PROFILE_PERMISSIONS_CHANNEL);
  ipcMain.handle(BROWSER_HOST_GET_PROFILE_PERMISSIONS_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) return [];
    const profileId = (input as { profileId?: unknown }).profileId;
    if (typeof profileId !== "string") return [];
    return browserHostManager.getProfilePermissions(profileId);
  });

  ipcMain.removeHandler(BROWSER_HOST_REVOKE_PROFILE_PERMISSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_REVOKE_PROFILE_PERMISSION_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) return;
    const { profileId, origin, permission } = input as {
      profileId: string;
      origin: string;
      permission: string;
    };
    if (
      typeof profileId !== "string" ||
      typeof origin !== "string" ||
      typeof permission !== "string"
    )
      return;
    browserHostManager.revokeProfilePermission(profileId, origin, permission);
  });

  ipcMain.removeHandler(BROWSER_HOST_TAKE_CONTROL_CHANNEL);
  ipcMain.handle(BROWSER_HOST_TAKE_CONTROL_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    )
      return;
    browserHostManager.takeControl({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_RESUME_AGENT_CHANNEL);
  ipcMain.handle(BROWSER_HOST_RESUME_AGENT_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    )
      return;
    const taskId =
      typeof (input as { taskId?: unknown }).taskId === "string"
        ? (input as { taskId: string }).taskId
        : undefined;
    browserHostManager.resumeAgent({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      taskId,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_ASSIGN_TAB_TASK_CHANNEL);
  ipcMain.handle(BROWSER_HOST_ASSIGN_TAB_TASK_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    )
      return;
    const taskId =
      typeof (input as { taskId?: unknown }).taskId === "string"
        ? (input as { taskId: string }).taskId
        : null;
    browserHostManager.assignTabTask({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
      taskId,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_RETAIN_TAB_CHANNEL);
  ipcMain.handle(BROWSER_HOST_RETAIN_TAB_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    )
      return;
    browserHostManager.retainTab({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_CLEANUP_AGENT_TABS_CHANNEL);
  ipcMain.handle(BROWSER_HOST_CLEANUP_AGENT_TABS_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string" ||
      typeof (input as { taskId?: unknown }).taskId !== "string"
    ) {
      return [];
    }
    return browserHostManager.cleanupAgentTabs({
      projectId: (input as { projectId: string }).projectId,
      taskId: (input as { taskId: string }).taskId,
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_DESTROY_SESSION_CHANNEL);
  ipcMain.handle(BROWSER_HOST_DESTROY_SESSION_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    )
      return;
    browserHostManager.destroySession({
      projectId: (input as { projectId: string }).projectId,
      sessionId: readBrowserSessionId(input),
    });
  });

  ipcMain.removeHandler(BROWSER_HOST_GET_RECENTLY_CLOSED_CHANNEL);
  ipcMain.handle(BROWSER_HOST_GET_RECENTLY_CLOSED_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "string") return [];
    return browserHostManager.getRecentlyClosedTabs(input);
  });

  ipcMain.removeHandler(BROWSER_HOST_RESTORE_RECENTLY_CLOSED_CHANNEL);
  ipcMain.handle(BROWSER_HOST_RESTORE_RECENTLY_CLOSED_CHANNEL, async (_event, input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as { projectId?: unknown }).projectId !== "string"
    )
      return null;
    const id =
      typeof (input as { id?: unknown }).id === "string" ? (input as { id: string }).id : undefined;
    return browserHostManager.restoreRecentlyClosedTab(
      (input as { projectId: string }).projectId,
      id,
    );
  });

  ipcMain.removeHandler(VSCODE_FETCH_SHELL_ENV_CHANNEL);
  ipcMain.handle(VSCODE_FETCH_SHELL_ENV_CHANNEL, async () => ({
    ...process.env,
  }));

  ipcMain.removeAllListeners(VSCODE_TOGGLE_DEVTOOLS_CHANNEL);
  ipcMain.on(VSCODE_TOGGLE_DEVTOOLS_CHANNEL, (event) => {
    event.sender.toggleDevTools();
  });

  ipcMain.removeAllListeners(VSCODE_OPEN_DEVTOOLS_CHANNEL);
  ipcMain.on(VSCODE_OPEN_DEVTOOLS_CHANNEL, (event) => {
    event.sender.openDevTools({ mode: "detach" });
  });

  ipcMain.removeAllListeners(VSCODE_RELOAD_WINDOW_CHANNEL);
  ipcMain.on(VSCODE_RELOAD_WINDOW_CHANNEL, (event) => {
    event.sender.reload();
  });

  ipcMain.removeHandler(VSCODE_NOTIFY_ZOOM_LEVEL_CHANNEL);
  ipcMain.handle(VSCODE_NOTIFY_ZOOM_LEVEL_CHANNEL, async () => undefined);
}

function getIconOption(): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = process.platform === "win32" ? "ico" : "png";
  const iconPath = resolveIconPath(ext);
  return iconPath ? { icon: iconPath } : {};
}

const popoutWindows = new Set<BrowserWindow>();

function isInternalTabsUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return false;
  if (rawUrl.includes("popout=true") || rawUrl.includes("section=diagnostics")) {
    return true;
  }
  if (isDevelopment && process.env.VITE_DEV_SERVER_URL) {
    try {
      const devOrigin = new URL(process.env.VITE_DEV_SERVER_URL).origin;
      const targetOrigin = new URL(rawUrl).origin;
      if (devOrigin === targetOrigin) return true;
    } catch {}
  }
  if (rawUrl.startsWith(`${DESKTOP_SCHEME}://app`) || rawUrl.startsWith("/")) {
    return true;
  }
  return false;
}

function resolveInternalTabsUrl(rawUrl: string): string {
  if (
    rawUrl.startsWith("http://") ||
    rawUrl.startsWith("https://") ||
    rawUrl.startsWith(`${DESKTOP_SCHEME}://`)
  ) {
    return rawUrl;
  }
  const cleanPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  if (isDevelopment && process.env.VITE_DEV_SERVER_URL) {
    const devOrigin = new URL(process.env.VITE_DEV_SERVER_URL).origin;
    return `${devOrigin}/#${cleanPath}`;
  }
  return `${DESKTOP_SCHEME}://app/index.html#${cleanPath}`;
}

function createPopoutWindow(
  targetUrl: string,
  options?: {
    title?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
  },
): BrowserWindow {
  for (const existing of popoutWindows) {
    if (!existing.isDestroyed()) {
      if (existing.isMinimized()) {
        existing.restore();
      }
      existing.show();
      existing.focus();
      return existing;
    }
  }

  const resolvedUrl = resolveInternalTabsUrl(targetUrl);
  const width = options?.width ?? 780;
  const height = options?.height ?? 560;

  const window = new BrowserWindow({
    width,
    height,
    minWidth: 540,
    minHeight: 380,
    fullscreen: false,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141414" : "#f8f8f8",
    autoHideMenuBar: true,
    ...getIconOption(),
    title: options?.title || "Resources Explorer",
    ...resolveTitleBarOptions(),
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: { x: 14, y: 14 },
        }
      : {}),
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ["--tabs-popout-window"],
    },
  });

  popoutWindows.add(window);
  window.on("closed", () => {
    popoutWindows.delete(window);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalTabsUrl(url)) {
      createPopoutWindow(url);
      return { action: "deny" };
    }
    const externalUrl = getSafeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, navUrl) => {
    if (!isInternalTabsUrl(navUrl)) {
      event.preventDefault();
      const externalUrl = getSafeExternalUrl(navUrl);
      if (externalUrl) {
        void shell.openExternal(externalUrl);
      }
    }
  });

  window.once("ready-to-show", () => {
    window.center();
    window.show();
    window.focus();
  });

  void window.loadURL(resolvedUrl);
  return window;
}

function createTabsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141414" : "#f8f8f8",
    autoHideMenuBar: true,
    ...getIconOption(),
    title: APP_DISPLAY_NAME,
    ...resolveTitleBarOptions(),
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("context-menu", (event, params) => {
    event.preventDefault();

    const menuTemplate: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuTemplate.push({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        menuTemplate.push({ label: "No suggestions", enabled: false });
      }
      menuTemplate.push({ type: "separator" });
    }

    menuTemplate.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(menuTemplate).popup({ window });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalTabsUrl(url)) {
      createPopoutWindow(url);
      return { action: "deny" };
    }
    const externalUrl = getSafeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_DISPLAY_NAME);
  });
  window.webContents.on("did-finish-load", () => {
    window.setTitle(APP_DISPLAY_NAME);
    emitUpdateState();
  });
  window.once("ready-to-show", () => {
    if (process.env.TABS_DEV_RESTART === "1") {
      window.showInactive();
    } else {
      window.show();
    }
  });

  if (isDevelopment && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadURL(`${DESKTOP_SCHEME}://app/index.html`);
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
      notificationOverlayManager.destroy();
      nativeViewCoordinator.destroy();
      for (const popout of popoutWindows) {
        if (!popout.isDestroyed()) {
          popout.close();
        }
      }
      popoutWindows.clear();
    }
  });

  window.webContents.on(
    "did-fail-load",
    (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame && !window.isVisible()) {
        window.show();
      }
    },
  );

  return window;
}

function createWindow(): BrowserWindow {
  const window = createTabsWindow();
  window.on("close", (event) => {
    const nonPopoutWindowsCount = BrowserWindow.getAllWindows().filter(
      (w) => !popoutWindows.has(w),
    ).length;
    if (isQuittingConfirmed || !shouldConfirmBeforeQuit() || nonPopoutWindowsCount > 1) {
      return;
    }
    event.preventDefault();
    requestQuitConfirmation();
  });
  return window;
}

// Override Electron's userData path before the `ready` event so that
// Chromium session data uses a filesystem-friendly directory name.
// Must be called synchronously at the top level — before `app.whenReady()`.
app.setPath("userData", resolveUserDataPath());

configureAppIdentity();

// Clerk owns the single-instance lock so OAuth callbacks are forwarded to the
// running process on Windows and Linux. Re-acquiring it here would make the
// primary instance reject itself.
const clerkBridge = createClerkBridge({
  storage: clerkStorage({ path: STATE_DIR }),
  passkeys: true,
  renderer: { scheme: DESKTOP_SCHEME, host: "app" },
});
// Clerk registers its renderer scheme while constructing the bridge. Electron
// materializes the most recent privileged-scheme registration into command-line
// switches, so register the complete set afterwards or Clerk's `tabs` entry can
// leave embedded Code-OSS without secure `vscode-file`/`vscode-webview` origins.
registerPrivilegedSchemes();
if (!clerkBridge.isPrimaryInstance) {
  app.quit();
}
app.once("will-quit", () => clerkBridge.cleanup());

app.on("open-url", (_event, rawUrl) => forwardNativeCodeHostURL(rawUrl));

app.on("second-instance", (_event, commandLine) => {
  for (const rawUrl of findNativeCodeHostURLs(commandLine, DESKTOP_SCHEME)) {
    forwardNativeCodeHostURL(rawUrl);
  }
  const targetWindow = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!targetWindow) {
    return;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }
  if (!targetWindow.isVisible()) {
    targetWindow.show();
  }
  targetWindow.focus();
});

const getAppVersion = () =>
  app.isPackaged ? app.getVersion() : process.env.npm_package_version || app.getVersion();

function formatRuntimeDownloadStatus(progress: RuntimeInstallProgress): string {
  if (progress.phase === "downloading") {
    if (progress.totalBytes && progress.receivedBytes) {
      const pct = Math.floor((progress.receivedBytes / progress.totalBytes) * 100);
      const mb = Math.round(progress.totalBytes / 1_000_000);
      return `Preparing the editor… downloading runtime (${pct}% of ~${mb} MB).`;
    }
    return "Preparing the editor… downloading runtime.";
  }
  if (progress.phase === "verifying") return "Preparing the editor… verifying download.";
  if (progress.phase === "extracting") return "Preparing the editor… installing runtime.";
  return "Editor runtime ready.";
}

let codeOssRuntimeDownloadStarted = false;

/**
 * Level B (thin installer): when no runtime is bundled or already downloaded,
 * fetch it on demand and adopt it once ready. Download progress is reflected in
 * the Code-OSS state `reason` (surfaced in the Code tab). No-op for fat/dev
 * builds where a runtime is already resolvable.
 */
function ensureDownloadedCodeOssRuntime(): void {
  // In development, the editor runtime must come from the local checkout (../tabs-code-main
  // or TABS_CODE_OSS_BUILD_DIR). Never attempt to download release zips from GitHub in dev.
  if (isDevelopment) {
    return;
  }
  // If the app was built as a bundled (fat) desktop app, tabs-code-main is in resourcesPath.
  // On-demand download is only for thin installers where tabs-code-main was deliberately excluded.
  if (process.resourcesPath && FS.existsSync(Path.join(process.resourcesPath, "tabs-code-main"))) {
    return;
  }
  if (codeOssRuntimeDownloadStarted || codeHostConfig.state.available) {
    return;
  }
  const appVersion = getAppVersion();
  if (isRuntimeInstalled(appVersion)) {
    return; // already resolved synchronously at startup
  }
  codeOssRuntimeDownloadStarted = true;
  codeHostConfig.state.available = false;
  codeHostConfig.state.reason = "Preparing the editor… downloading runtime.";

  void ensureRuntimeInstalled({
    version: appVersion,
    onProgress: (progress) => {
      codeHostConfig.state.reason = formatRuntimeDownloadStatus(progress);
    },
  })
    .then(() => {
      process.env.TABS_CODE_OSS_BUILD_DIR = resolveInstalledRuntimeDir(appVersion);
      const next = resolveCodeHostConfig({
        rootDir: ROOT_DIR,
        env: process.env,
      });
      if (next.state.available) {
        codeHostManager.reconfigure(next);
        writeDesktopLogHeader("code-oss runtime downloaded and activated");
      } else {
        codeHostManager.disableEmbeddedHost(
          next.state.reason ?? "Downloaded editor runtime could not be resolved.",
        );
      }
    })
    .catch((error: unknown) => {
      codeOssRuntimeDownloadStarted = false; // allow a retry on next launch
      codeHostManager.disableEmbeddedHost(
        `Could not download the editor runtime: ${formatErrorMessage(error)}. It will retry next launch.`,
      );
    });
}

async function bootstrap(): Promise<void> {
  const bootstrapStartedAt = performance.now();
  writeDesktopLogHeader("bootstrap start");
  // Code-OSS main-process compatibility services and the Tabs loopback
  // backend are independent. Start the expensive compatibility imports now
  // and overlap them with port/control-channel initialization.
  const nativeCodeHostBackendPromise = codeHostConfig.runtime
    ? createNativeCodeHostMainBackend(
        codeHostConfig.runtime.vscodeRoot,
        codeHostConfig.runtime.stateDir,
        {
          openFile(projectId, path) {
            if (!codeControlChannel.openFile(projectId, path, { pinned: true })) {
              throw new Error(`Code-OSS is not ready to open ${path}`);
            }
          },
          openFolder(path) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(
                MENU_ACTION_CHANNEL,
                path ? `code-open-folder:${encodeURIComponent(path)}` : "tab-new",
              );
            }
          },
          dispatchTabAction(action) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(MENU_ACTION_CHANNEL, action);
            }
          },
        },
      )
    : Promise.resolve(null);
  ensureDownloadedCodeOssRuntime();
  backendPort = await Effect.service(NetService).pipe(
    Effect.flatMap((net) => net.reserveLoopbackPort()),
    Effect.provide(netServiceLayer),
    Effect.runPromise,
  );
  writeDesktopLogHeader(`reserved backend port via NetService port=${backendPort}`);
  backendAuthToken = Crypto.randomBytes(24).toString("hex");
  const wsBaseUrl = `ws://127.0.0.1:${backendPort}`;
  backendWsUrl = `${wsBaseUrl}/?token=${encodeURIComponent(backendAuthToken)}`;
  backendHttpUrl = `http://127.0.0.1:${backendPort}`;
  writeDesktopLogHeader(`bootstrap resolved websocket endpoint baseUrl=${wsBaseUrl}`);
  try {
    extensionAiBrokerConfig = await extensionAiBrokerServer.start();
    writeDesktopLogHeader("bootstrap extension AI broker started");
  } catch (error) {
    writeDesktopLogHeader(
      `bootstrap extension AI broker unavailable: ${formatErrorMessage(error)}`,
    );
  }

  if (codeHostConfig.runtime) {
    // Do not hold first paint behind Code-OSS's large compatibility imports.
    // The shell and agent workspace are useful before the editor is opened;
    // attach the native workbench registrar as soon as its backend is ready.
    void nativeCodeHostBackendPromise
      .then((backend) => {
        nativeCodeHostMainBackend = backend;
        for (const rawUrl of pendingNativeCodeHostURLs.splice(0)) {
          forwardNativeCodeHostURL(rawUrl);
        }
        codeHostManager.setNativeWebContentsRegistrar((webContents, getBounds, projectId) => {
          nativeCodeHostMainBackend?.registerWebContents(
            webContents,
            getBounds,
            mainWindow ?? undefined,
            projectId,
          );
        });
        writeDesktopLogHeader("bootstrap native Code-OSS main-process backend started");
      })
      .catch((error: unknown) => {
        const reason = `Embedded editor services failed to start: ${formatErrorMessage(error)}`;
        codeHostManager.disableEmbeddedHost(reason);
        writeDesktopLogHeader(`bootstrap native Code-OSS backend failed: ${reason}`);
      });
  }

  // Start the loopback control channel and expose its URL to the embedded
  // Code-OSS extension host via env (inherited by the spawned REH server). Done
  // before startBackend so the env is in place when the code session later
  // spawns its server. Non-fatal if it fails — the chrome simply can't drive
  // the workbench (clicks become no-ops) but the editor still works.
  try {
    // Deterministic path (stable across restarts) so a reused/long-lived
    // workbench can re-read the current URL after a main-process restart.
    const controlUrlFile = Path.join(STATE_DIR, "code-control.json");
    const control = await codeControlChannel.start(controlUrlFile);
    process.env.TABS_CODE_CONTROL_URL = control.url;
    process.env.TABS_CODE_CONTROL_FILE = controlUrlFile;
    codeControlChannel.onChromeState((projectId: string, state: CodeChromeState) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(CODE_HOST_CHROME_STATE_CHANNEL, {
          projectId,
          state,
        });
      }
    });
    codeControlChannel.onOpenTabsProjectTab(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(MENU_ACTION_CHANNEL, "tab-new");
      }
    });
    writeDesktopLogHeader("bootstrap code control channel started");
  } catch (error) {
    writeDesktopLogHeader(`bootstrap code control channel failed: ${formatErrorMessage(error)}`);
  }

  registerIpcHandlers();
  writeDesktopLogHeader("bootstrap ipc handlers registered");
  startBackend();
  writeDesktopLogHeader("bootstrap backend start requested");
  mainWindow = createWindow();
  void checkAllInstalledExchangeStatuses();
  if (process.env.TABS_EXCHANGE_TRUST_ROOT_PATH && process.env.TABS_EXCHANGE_ORIGIN) {
    try {
      const hintOrigin = configuredExchangeOrigin(
        process.env.TABS_EXCHANGE_ORIGIN,
        !app.isPackaged,
      );
      if (!hintOrigin) throw new Error("Exchange registry origin is unavailable.");
      exchangeSignedMetadataHints = new ExchangeSignedMetadataHints(
        hintOrigin,
        () => {
          void checkAllInstalledExchangeStatuses();
          checkAllInstalledExchangeUpdates();
        },
        (error) => {
          writeDesktopLogHeader(
            `Exchange signed-metadata hints failed: ${formatErrorMessage(error)}`,
          );
        },
      );
      exchangeSignedMetadataHints.start();
    } catch (error) {
      writeDesktopLogHeader(
        `Exchange signed-metadata hints unavailable: ${formatErrorMessage(error)}`,
      );
    }
  }
  exchangeStatusTimer = setInterval(() => {
    void checkAllInstalledExchangeStatuses();
  }, 60_000);
  exchangeStatusTimer.unref();
  exchangeUpdateStartupTimer = setTimeout(() => {
    exchangeUpdateStartupTimer = null;
    checkAllInstalledExchangeUpdates();
  }, 30_000);
  exchangeUpdateStartupTimer.unref();
  exchangeUpdateTimer = setInterval(checkAllInstalledExchangeUpdates, 6 * 60 * 60_000);
  exchangeUpdateTimer.unref();
  writeDesktopLogHeader(
    `bootstrap main window created durationMs=${Math.round(performance.now() - bootstrapStartedAt)}`,
  );
}

let isCleanupFinished = false;
let isCleaningUp = false;

function requestQuitConfirmation(): void {
  if (isQuitConfirmationOpen || isQuittingConfirmed) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  isQuitConfirmationOpen = true;
  const sendRequest = () => {
    if (isQuitConfirmationOpen && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(QUIT_CONFIRMATION_REQUEST_CHANNEL);
    }
  };
  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once("did-finish-load", sendRequest);
  } else {
    sendRequest();
  }
}

app.on("before-quit", (event) => {
  clearUpdateInstallHandoffTimer();
  if (
    !isCleanupFinished &&
    !isQuittingConfirmed &&
    shouldConfirmBeforeQuit() &&
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    event.preventDefault();
    requestQuitConfirmation();
    return;
  }
  if (isCleanupFinished) {
    return;
  }
  if (isCleaningUp) {
    event.preventDefault();
    return;
  }

  isCleaningUp = true;
  event.preventDefault(); // Hold the quit to perform async cleanup
  isQuitting = true;
  writeDesktopLogHeader("before-quit received, performing async cleanup");

  const rendererSettingsFlush =
    mainWindow && !mainWindow.isDestroyed()
      ? new Promise<void>((resolve) => {
          const handleFlushDone = () => {
            clearTimeout(timeoutId);
            resolve();
          };
          const timeoutId = setTimeout(() => {
            ipcMain.removeListener(APP_SETTINGS_FLUSH_DONE_CHANNEL, handleFlushDone);
            writeDesktopLogHeader("renderer settings flush timed out after 2000ms");
            resolve();
          }, 2000);
          ipcMain.once(APP_SETTINGS_FLUSH_DONE_CHANNEL, handleFlushDone);
        })
      : Promise.resolve();

  // Notify the renderer to show the close animation and flush pending settings.
  mainWindow?.webContents.send(APP_CLOSING_CHANNEL);

  clearUpdatePollTimer();
  codeControlChannel.dispose();

  void (async () => {
    await rendererSettingsFlush;

    try {
      writeDesktopLogHeader("flushing Browser session storage to disk...");
      await browserHostManager.flushAndShutdownSessions();
    } catch (err: any) {
      writeDesktopLogHeader(`Browser session flush failed: ${err?.message}`);
    }

    try {
      writeDesktopLogHeader("flushing Code-OSS session storage to disk...");
      await codeHostManager.flushAndShutdownSessions();
    } catch (err: any) {
      writeDesktopLogHeader(`Code-OSS session flush failed: ${err?.message}`);
    }

    nativeCodeHostMainBackend?.dispose();
    nativeCodeHostMainBackend = null;
    codeHostManager.setNativeWebContentsRegistrar(null);

    try {
      await sshEnvironmentBridgePromise?.then((bridge) => bridge.close());
      sshEnvironmentBridgePromise = null;
    } catch (error) {
      writeDesktopLogHeader(`SSH environment shutdown failed: ${error}`);
    }

    try {
      await Effect.runPromise(resolvedShutdown.request);
      await Promise.race([
        (async () => {
          await shutdownPromise;
          await Effect.runPromise(resolvedShutdown.awaitComplete);
        })(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("App shutdown timed out after 10 seconds")), 10000),
        ),
      ]);
    } catch (error) {
      writeDesktopLogHeader(`shutdown failed or timed out: ${error}`);
    } finally {
      isCleanupFinished = true;
      restoreStdIoCapture?.();
      writeDesktopLogHeader("cleanup finished, notifying renderer to finalize close animation");

      // Tell renderer that cleanup is done so it can trigger the squash/drain
      mainWindow?.webContents.send("desktop:app-cleanup-done");

      // Wait for renderer to signal that animation is finished
      try {
        await Promise.race([
          new Promise<void>((resolve) => {
            ipcMain.once("desktop:app-ready-to-exit", () => resolve());
          }),
          new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error("Renderer close animation timed out after 5 seconds")),
              5000,
            ),
          ),
        ]);
        writeDesktopLogHeader("renderer animation done, exiting app");
      } catch (err: any) {
        writeDesktopLogHeader(err.message);
      }

      // Flush storage to ensure localStorage and IndexedDB writes from the renderer are saved to disk
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          writeDesktopLogHeader("flushing storage data to disk");
          mainWindow.webContents.session.flushStorageData();
          await withTimeout(
            mainWindow.webContents.session.cookies.flushStore(),
            5000,
            "Default cookie flush timed out after 5000ms",
          );
        } else {
          writeDesktopLogHeader("flushing default session storage data to disk");
          session.defaultSession.flushStorageData();
          await withTimeout(
            session.defaultSession.cookies.flushStore(),
            5000,
            "Default cookie flush timed out after 5000ms",
          );
        }
      } catch (err: any) {
        writeDesktopLogHeader(`flush storage failed: ${err.message}`);
      }

      const quitWithFailsafe = (): void => {
        app.quit();
        setTimeout(() => {
          app.exit(0);
        }, 4000).unref();
      };

      if (preparedLinuxUpdate) {
        const prepared = preparedLinuxUpdate;
        preparedLinuxUpdate = null;
        writeDesktopLogHeader("cleanup finished, starting Linux AppImage update helper");
        app.releaseSingleInstanceLock();
        void prepared
          .launch(process.pid)
          .catch((error) => {
            writeDesktopLogHeader(
              `Linux update helper failed to start: ${formatErrorMessage(error)}`,
            );
            void prepared.dispose();
          })
          .finally(() => quitWithFailsafe());
      } else if (nativeUpdateInstallPending) {
        // Release the lock before Windows launches the updated app.
        nativeUpdateInstallPending = false;
        writeDesktopLogHeader("cleanup finished, starting native update installer");
        handOffNativeUpdateAfterCleanup({
          releaseSingleInstanceLock: () => app.releaseSingleInstanceLock(),
          updater: autoUpdater,
          quit: () => quitWithFailsafe(),
        });
      } else {
        quitWithFailsafe();
      }
    }
  })();
});

if (clerkBridge.isPrimaryInstance) {
  app
    .whenReady()
    .then(() => {
      writeDesktopLogHeader("app ready");
      configureAppIdentity();
      configureApplicationMenu();
      registerDesktopProtocol();
      configureAutoUpdater();

      powerMonitor.on("resume", () => {
        hostSuspended = false;
        void checkAllInstalledExchangeStatuses();
        const window = mainWindow;
        if (!window || window.isDestroyed()) return;
        window.webContents.send(SYSTEM_RESUME_CHANNEL);
        broadcastHostPowerSnapshot();
      });
      powerMonitor.on("suspend", () => {
        hostSuspended = true;
        broadcastHostPowerSnapshot();
      });
      powerMonitor.on("lock-screen", broadcastHostPowerSnapshot);
      powerMonitor.on("unlock-screen", broadcastHostPowerSnapshot);
      powerMonitor.on("on-ac", broadcastHostPowerSnapshot);
      powerMonitor.on("on-battery", broadcastHostPowerSnapshot);
      powerMonitor.on("thermal-state-change", broadcastHostPowerSnapshot);

      const allowedPermissions = new Set([
        "clipboard-read",
        "clipboard-write",
        "clipboard-sanitized-write",
        "pointerLock",
        "notifications",
      ]);
      session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback(allowedPermissions.has(permission));
      });
      session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
        return allowedPermissions.has(permission);
      });

      void bootstrap().catch((error) => {
        handleFatalStartupError("bootstrap", error);
      });

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createWindow();
        }
      });
    })
    .catch((error) => {
      handleFatalStartupError("whenReady", error);
    });
}

// Window-all-closed unconditionally calls app.quit() on all platforms (including darwin).
// This is intentional IDE behavior (exits the app when the main editor window is closed,
// rather than leaving a headless backend process running).
app.on("window-all-closed", () => {
  writeDesktopLogHeader("window-all-closed emitted, calling app.quit()");
  app.quit();
});

if (process.platform !== "win32") {
  process.on("SIGINT", () => {
    writeDesktopLogHeader("SIGINT received");
    app.quit();
  });

  process.on("SIGTERM", () => {
    writeDesktopLogHeader("SIGTERM received");
    app.quit();
  });
}
