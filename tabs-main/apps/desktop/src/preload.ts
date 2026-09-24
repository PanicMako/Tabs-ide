import { contextBridge, ipcRenderer } from "electron";
import { exposeClerkBridge } from "@clerk/electron/preload";
import type { DesktopBridge } from "@tabs/contracts";

exposeClerkBridge({ passkeys: true });

const isPopoutProcess = process.argv.includes("--tabs-popout-window");
if (isPopoutProcess) {
  try {
    contextBridge.exposeInMainWorld("__TABS_IS_POPOUT__", true);
  } catch {}
}

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
const APP_CLEANUP_DONE_CHANNEL = "desktop:app-cleanup-done";
const APP_READY_TO_EXIT_CHANNEL = "desktop:app-ready-to-exit";
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
const SSH_PASSWORD_PROMPT_CHANNEL = "desktop:ssh-password-prompt";
const RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL = "desktop:resolve-ssh-password-prompt";
const SYSTEM_RESUME_CHANNEL = "desktop:system-resume";
const WRITE_CLIPBOARD_TEXT_CHANNEL = "desktop:clipboard:write-text";
const READ_CLIPBOARD_TEXT_CHANNEL = "desktop:clipboard:read-text";
const DESKTOP_CAPTURE_SCREEN_CHANNEL = "desktop:capture:screen";
const DESKTOP_CAPTURE_GET_PERMISSION_CHANNEL = "desktop:capture:get-permission";
const DESKTOP_CAPTURE_REQUEST_PERMISSION_CHANNEL = "desktop:capture:request-permission";
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
const CODE_HOST_RUN_COMMAND_CHANNEL = "vscode:tabs-code-host:run-command";
const CODE_HOST_GET_CHROME_STATE_CHANNEL = "desktop:code-host:get-chrome-state";
const CODE_HOST_CHROME_STATE_CHANNEL = "desktop:code-host:chrome-state";
const BROWSER_HOST_GET_STATE_CHANNEL = "desktop:browser-host:get-state";
const EXTENSION_LIST_CHANNEL = "desktop:extension:list";
const EXTENSION_CHANGED_CHANNEL = "desktop:extension:changed";
const EXTENSION_DISCOVER_CHANNEL = "desktop:extension:discover";
const EXTENSION_EXCHANGE_AVAILABLE_CHANNEL = "desktop:extension:exchange-available";
const EXTENSION_EXCHANGE_PREPARE_CHANNEL = "desktop:extension:exchange-prepare";
const EXTENSION_EXCHANGE_CONFIRM_CHANNEL = "desktop:extension:exchange-confirm";
const EXTENSION_EXCHANGE_CANCEL_CHANNEL = "desktop:extension:exchange-cancel";
const EXTENSION_INSTALL_DEV_CHANNEL = "desktop:extension:install-dev";
const EXTENSION_INSTALL_LOCAL_PACKAGE_CHANNEL = "desktop:extension:install-local-package";
const EXTENSION_ASSIGN_CHANNEL = "desktop:extension:assign";
const EXTENSION_ADD_PROFILE_CHANNEL = "desktop:extension:add-profile";
const EXTENSION_ACTIVATE_CHANNEL = "desktop:extension:activate";
const EXTENSION_SET_BOUNDS_CHANNEL = "desktop:extension:set-bounds";
const EXTENSION_HIDE_CHANNEL = "desktop:extension:hide";
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
const BROWSER_HOST_SESSION_STATE_CHANNEL = "desktop:browser-host:session-state";
const CODE_HOST_RECREATE_SESSION_CHANNEL = "desktop:code-host:recreate-session";
const BROWSER_HOST_RECREATE_SESSION_CHANNEL = "desktop:browser-host:recreate-session";
const BROWSER_HOST_CLEAR_SESSION_DATA_CHANNEL = "desktop:browser-host:clear-session-data";
const BROWSER_HOST_CLEAR_PROFILE_DATA_CHANNEL = "desktop:browser-host:clear-profile-data";
const BROWSER_HOST_OPEN_PROFILE_LOGIN_WINDOW_CHANNEL =
  "desktop:browser-host:open-profile-login-window";
const BROWSER_HOST_GET_PROFILE_DOMAINS_CHANNEL = "desktop:browser-host:get-profile-domains";
const BROWSER_HOST_INSPECT_PROFILE_CHANNEL = "desktop:browser-host:inspect-profile";
const BROWSER_HOST_CLEAR_PROFILE_DOMAIN_CHANNEL = "desktop:browser-host:clear-profile-domain";
const BROWSER_HOST_PROFILE_DATA_CHANGED_CHANNEL = "desktop:browser-host:profile-data-changed";
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

// Persistence channels
const GET_PERSISTED_ITEM_CHANNEL = "desktop:get-persisted-item";
const SET_PERSISTED_ITEM_CHANNEL = "desktop:set-persisted-item";
const REMOVE_PERSISTED_ITEM_CHANNEL = "desktop:remove-persisted-item";

// Notification overlay channels
const NOTIFICATION_OVERLAY_SYNC_CHANNEL = "desktop:notification-overlay:sync";
const NOTIFICATION_OVERLAY_ACTION_CHANNEL = "desktop:notification-overlay:action";
const NOTIFICATION_OVERLAY_DISMISS_CHANNEL = "desktop:notification-overlay:dismiss";

contextBridge.exposeInMainWorld("desktopBridge", {
  writeClipboardText: (text) => ipcRenderer.invoke(WRITE_CLIPBOARD_TEXT_CHANNEL, text),
  readClipboardText: (type) => ipcRenderer.invoke(READ_CLIPBOARD_TEXT_CHANNEL, type),
  getDesktopCapturePermissionStatus: () =>
    ipcRenderer.invoke(DESKTOP_CAPTURE_GET_PERMISSION_CHANNEL),
  requestDesktopCapturePermission: () =>
    ipcRenderer.invoke(DESKTOP_CAPTURE_REQUEST_PERMISSION_CHANNEL),
  captureDesktopScreen: (options) => ipcRenderer.invoke(DESKTOP_CAPTURE_SCREEN_CHANNEL, options),
  getClientPlatform: () => process.platform,
  getLocalEnvironmentBootstraps: () => {
    const result = ipcRenderer.sendSync(GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL);
    return Array.isArray(result) ? result : [];
  },
  getConnectionCatalog: () => ipcRenderer.invoke(GET_CONNECTION_CATALOG_CHANNEL),
  setConnectionCatalog: (catalog: string) =>
    ipcRenderer.invoke(SET_CONNECTION_CATALOG_CHANNEL, catalog),
  clearConnectionCatalog: () => ipcRenderer.invoke(CLEAR_CONNECTION_CATALOG_CHANNEL),
  discoverSshHosts: () => ipcRenderer.invoke(DISCOVER_SSH_HOSTS_CHANNEL),
  ensureSshEnvironment: async (target, options) => {
    const result = await ipcRenderer.invoke(ENSURE_SSH_ENVIRONMENT_CHANNEL, {
      target,
      options,
    });
    if (result?.type === "ssh-password-prompt-cancelled") {
      throw new Error(result.message ?? "SSH authentication cancelled.");
    }
    return result;
  },
  disconnectSshEnvironment: (target) =>
    ipcRenderer.invoke(DISCONNECT_SSH_ENVIRONMENT_CHANNEL, target),
  fetchSshEnvironmentDescriptor: (httpBaseUrl) =>
    ipcRenderer.invoke(FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL, {
      httpBaseUrl,
    }),
  bootstrapSshBearerSession: (httpBaseUrl, credential) =>
    ipcRenderer.invoke(BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL, {
      httpBaseUrl,
      credential,
    }),
  fetchSshSessionState: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(FETCH_SSH_SESSION_STATE_CHANNEL, {
      httpBaseUrl,
      bearerToken,
    }),
  issueSshWebSocketTicket: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL, {
      httpBaseUrl,
      bearerToken,
    }),
  onSshPasswordPrompt: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, request: unknown) => {
      if (typeof request === "object" && request !== null) {
        listener(request as Parameters<typeof listener>[0]);
      }
    };
    ipcRenderer.on(SSH_PASSWORD_PROMPT_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(SSH_PASSWORD_PROMPT_CHANNEL, wrapped);
  },
  resolveSshPasswordPrompt: (requestId, password) =>
    ipcRenderer.invoke(RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL, {
      requestId,
      password,
    }),
  onSystemResume: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on(SYSTEM_RESUME_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(SYSTEM_RESUME_CHANNEL, wrapped);
  },
  getHostPowerSnapshot: () => ipcRenderer.invoke(HOST_POWER_GET_CHANNEL),
  onHostPowerSnapshot: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: unknown) =>
      listener(snapshot as Parameters<typeof listener>[0]);
    ipcRenderer.on(HOST_POWER_CHANGED_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(HOST_POWER_CHANGED_CHANNEL, wrapped);
  },
  getWsUrl: () => {
    const result = ipcRenderer.sendSync(GET_WS_URL_CHANNEL);
    return typeof result === "string" ? result : null;
  },
  pickFolder: (options) => ipcRenderer.invoke(PICK_FOLDER_CHANNEL, options),
  cloneRepository: (input) => ipcRenderer.invoke(CLONE_REPOSITORY_CHANNEL, input),
  pickFile: (options) => ipcRenderer.invoke(PICK_FILE_CHANNEL, options),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  setIconTheme: (theme) => ipcRenderer.invoke(SET_ICON_THEME_CHANNEL, theme),
  setAiProvider: (provider) => ipcRenderer.invoke(SET_AI_PROVIDER_CHANNEL, provider),
  setZoomFactor: (factor) => ipcRenderer.invoke(SET_ZOOM_FACTOR_CHANNEL, factor),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  isPopout: isPopoutProcess,
  openPopoutWindow: (options: { url: string; title?: string; width?: number; height?: number }) =>
    ipcRenderer.invoke(OPEN_POPOUT_WINDOW_CHANNEL, options),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  getCodeHostState: () => ipcRenderer.invoke(CODE_HOST_GET_STATE_CHANNEL),
  ensureCodeSession: (input) => ipcRenderer.invoke(CODE_HOST_ENSURE_SESSION_CHANNEL, input),
  activateCodeSession: (input) => ipcRenderer.invoke(CODE_HOST_ACTIVATE_SESSION_CHANNEL, input),
  hideCodeSession: () => ipcRenderer.invoke(CODE_HOST_HIDE_SESSION_CHANNEL),
  captureCodeSession: (input) => ipcRenderer.invoke(CODE_HOST_CAPTURE_SESSION_CHANNEL, input),
  openCodeFile: (input) => ipcRenderer.invoke(CODE_HOST_OPEN_FILE_CHANNEL, input),
  setCodeBounds: (input) => ipcRenderer.invoke(CODE_HOST_SET_BOUNDS_CHANNEL, input),
  syncCodeSessions: (projectIds) => ipcRenderer.invoke(CODE_HOST_SYNC_SESSIONS_CHANNEL, projectIds),
  recreateCodeSession: (input) => ipcRenderer.invoke(CODE_HOST_RECREATE_SESSION_CHANNEL, input),
  runCodeCommand: (projectId: string, commandId: string) =>
    ipcRenderer.invoke(CODE_HOST_RUN_COMMAND_CHANNEL, { projectId, commandId }),
  getCodeChromeState: (input: { projectId: string }) =>
    ipcRenderer.invoke(CODE_HOST_GET_CHROME_STATE_CHANNEL, input),
  onCodeChromeState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(CODE_HOST_CHROME_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(CODE_HOST_CHROME_STATE_CHANNEL, wrappedListener);
    };
  },
  probeBrowserReadiness: (input) => ipcRenderer.invoke("desktop:browser-readiness", input),
  configureBrowserComparison: (input) =>
    ipcRenderer.invoke("desktop:browser-comparison:configure", input),
  closeBrowserComparison: (input) => ipcRenderer.invoke("desktop:browser-comparison:close", input),
  captureBrowserComparison: (input) =>
    ipcRenderer.invoke("desktop:browser-comparison:capture", input),
  getBrowserHostState: () => ipcRenderer.invoke(BROWSER_HOST_GET_STATE_CHANNEL),
  listExtensions: () => ipcRenderer.invoke(EXTENSION_LIST_CHANNEL),
  onExtensionsChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(EXTENSION_CHANGED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(EXTENSION_CHANGED_CHANNEL, handler);
  },
  discoverExchangeExtensions: (query) => ipcRenderer.invoke(EXTENSION_DISCOVER_CHANNEL, query),
  exchangeInstallAvailable: () => ipcRenderer.invoke(EXTENSION_EXCHANGE_AVAILABLE_CHANNEL),
  prepareExchangeInstall: (listing) =>
    ipcRenderer.invoke(EXTENSION_EXCHANGE_PREPARE_CHANNEL, listing),
  confirmExchangeInstall: (token) => ipcRenderer.invoke(EXTENSION_EXCHANGE_CONFIRM_CHANNEL, token),
  cancelExchangeInstall: (token) => ipcRenderer.invoke(EXTENSION_EXCHANGE_CANCEL_CHANNEL, token),
  installDevelopmentExtension: (directory) =>
    ipcRenderer.invoke(EXTENSION_INSTALL_DEV_CHANNEL, directory),
  installLocalExtensionPackage: (archive) =>
    ipcRenderer.invoke(EXTENSION_INSTALL_LOCAL_PACKAGE_CHANNEL, archive),
  setExtensionAssignment: (extensionId, assignment) =>
    ipcRenderer.invoke(EXTENSION_ASSIGN_CHANNEL, extensionId, assignment),
  addExtensionProfile: (extensionId, id, label, scope) =>
    ipcRenderer.invoke(EXTENSION_ADD_PROFILE_CHANNEL, extensionId, id, label, scope),
  activateExtensionTool: (input) => ipcRenderer.invoke(EXTENSION_ACTIVATE_CHANNEL, input),
  setExtensionBounds: (input) => ipcRenderer.invoke(EXTENSION_SET_BOUNDS_CHANNEL, input),
  hideExtensionTool: () => ipcRenderer.invoke(EXTENSION_HIDE_CHANNEL),
  getBrowserSessionState: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_GET_SESSION_STATE_CHANNEL, input),
  ensureBrowserSession: (input) => ipcRenderer.invoke(BROWSER_HOST_ENSURE_SESSION_CHANNEL, input),
  activateBrowserSession: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_ACTIVATE_SESSION_CHANNEL, input),
  hideBrowserSession: () => ipcRenderer.invoke(BROWSER_HOST_HIDE_SESSION_CHANNEL),
  navigateBrowserSession: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_NAVIGATE_SESSION_CHANNEL, input),
  reloadBrowserSession: (input) => ipcRenderer.invoke(BROWSER_HOST_RELOAD_SESSION_CHANNEL, input),
  setBrowserZoomFactor: (input) => ipcRenderer.invoke(BROWSER_HOST_SET_ZOOM_CHANNEL, input),
  setBrowserAudioMuted: (input) => ipcRenderer.invoke(BROWSER_HOST_SET_AUDIO_MUTED_CHANNEL, input),
  openBrowserPictureInPicture: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_OPEN_PICTURE_IN_PICTURE_CHANNEL, input),
  closeBrowserPictureInPicture: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_CLOSE_PICTURE_IN_PICTURE_CHANNEL, input),
  setBrowserColorScheme: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_SET_COLOR_SCHEME_CHANNEL, input),
  goBackBrowserSession: (input) => ipcRenderer.invoke(BROWSER_HOST_BACK_SESSION_CHANNEL, input),
  goForwardBrowserSession: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_FORWARD_SESSION_CHANNEL, input),
  toggleBrowserDevTools: (input) => ipcRenderer.invoke(BROWSER_HOST_TOGGLE_DEVTOOLS_CHANNEL, input),
  runBrowserAutomation: (input) => ipcRenderer.invoke(BROWSER_HOST_AUTOMATION_CHANNEL, input),
  captureBrowserScreenshot: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_CAPTURE_SCREENSHOT_CHANNEL, input),
  getBrowserMediaSourceId: (input) => ipcRenderer.invoke(BROWSER_HOST_MEDIA_SOURCE_CHANNEL, input),
  saveBrowserRecording: (input) => ipcRenderer.invoke(BROWSER_HOST_SAVE_RECORDING_CHANNEL, input),
  pickBrowserElement: (input) => ipcRenderer.invoke(BROWSER_HOST_PICK_ELEMENT_CHANNEL, input),
  revealBrowserArtifact: (path) => ipcRenderer.invoke(BROWSER_HOST_REVEAL_ARTIFACT_CHANNEL, path),
  copyBrowserArtifactToClipboard: (path) =>
    ipcRenderer.invoke(BROWSER_HOST_COPY_ARTIFACT_CHANNEL, path),
  setBrowserBounds: (input) => ipcRenderer.invoke(BROWSER_HOST_SET_BOUNDS_CHANNEL, input),
  syncBrowserSessions: (projectIds) =>
    ipcRenderer.invoke(BROWSER_HOST_SYNC_SESSIONS_CHANNEL, projectIds),
  recreateBrowserSession: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_RECREATE_SESSION_CHANNEL, input),
  clearBrowserSessionData: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_CLEAR_SESSION_DATA_CHANNEL, input),
  clearBrowserProfileData: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_CLEAR_PROFILE_DATA_CHANNEL, input),
  openBrowserProfileLoginWindow: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_OPEN_PROFILE_LOGIN_WINDOW_CHANNEL, input),
  getBrowserProfileDomains: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_GET_PROFILE_DOMAINS_CHANNEL, input),
  inspectBrowserProfile: (input) => ipcRenderer.invoke(BROWSER_HOST_INSPECT_PROFILE_CHANNEL, input),
  clearBrowserProfileDomain: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_CLEAR_PROFILE_DOMAIN_CHANNEL, input),
  listBrowserImportSources: () => ipcRenderer.invoke(BROWSER_HOST_LIST_IMPORT_SOURCES_CHANNEL),
  cancelBrowserImport: (requestId) =>
    ipcRenderer.invoke("desktop:browser-host:cancel-import", requestId),
  importBrowserCookies: (input) => ipcRenderer.invoke(BROWSER_HOST_IMPORT_COOKIES_CHANNEL, input),
  respondBrowserPermission: (response) =>
    ipcRenderer.invoke(BROWSER_HOST_RESPOND_PERMISSION_CHANNEL, response),
  getBrowserProfilePermissions: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_GET_PROFILE_PERMISSIONS_CHANNEL, input),
  revokeBrowserProfilePermission: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_REVOKE_PROFILE_PERMISSION_CHANNEL, input),
  takeBrowserControl: (input) => ipcRenderer.invoke(BROWSER_HOST_TAKE_CONTROL_CHANNEL, input),
  resumeBrowserAgent: (input) => ipcRenderer.invoke(BROWSER_HOST_RESUME_AGENT_CHANNEL, input),
  assignBrowserTabTask: (input) => ipcRenderer.invoke(BROWSER_HOST_ASSIGN_TAB_TASK_CHANNEL, input),
  retainBrowserTab: (input) => ipcRenderer.invoke(BROWSER_HOST_RETAIN_TAB_CHANNEL, input),
  cleanupAgentBrowserTabs: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_CLEANUP_AGENT_TABS_CHANNEL, input),
  destroyBrowserSession: (input) => ipcRenderer.invoke(BROWSER_HOST_DESTROY_SESSION_CHANNEL, input),
  getRecentlyClosedBrowserTabs: (projectId) =>
    ipcRenderer.invoke(BROWSER_HOST_GET_RECENTLY_CLOSED_CHANNEL, projectId),
  restoreRecentlyClosedBrowserTab: (input) =>
    ipcRenderer.invoke(BROWSER_HOST_RESTORE_RECENTLY_CLOSED_CHANNEL, input),
  onBrowserProfileDataChanged: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, profileId: unknown) => {
      if (typeof profileId === "string") listener(profileId);
    };
    ipcRenderer.on(BROWSER_HOST_PROFILE_DATA_CHANGED_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(BROWSER_HOST_PROFILE_DATA_CHANGED_CHANNEL, wrappedListener);
    };
  },
  onBrowserSessionState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(BROWSER_HOST_SESSION_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(BROWSER_HOST_SESSION_STATE_CHANNEL, wrappedListener);
    };
  },
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },

  // Persistence methods
  getPersistedItem: (key: string) => {
    return ipcRenderer.invoke(GET_PERSISTED_ITEM_CHANNEL, key);
  },

  setPersistedItem: (key: string, value: string) => {
    return ipcRenderer.invoke(SET_PERSISTED_ITEM_CHANNEL, key, value);
  },

  removePersistedItem: (key: string) => {
    return ipcRenderer.invoke(REMOVE_PERSISTED_ITEM_CHANNEL, key);
  },

  getTailscaleStatus: () => {
    return ipcRenderer.invoke("get-tailscale-status");
  },
  onAppClosing: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on(APP_CLOSING_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(APP_CLOSING_CHANNEL, wrapped);
    };
  },
  notifySettingsFlushDone: () => {
    ipcRenderer.send(APP_SETTINGS_FLUSH_DONE_CHANNEL);
  },
  getConfirmBeforeQuit: () => ipcRenderer.invoke(GET_CONFIRM_BEFORE_QUIT_CHANNEL),
  setConfirmBeforeQuit: (value: boolean) =>
    ipcRenderer.invoke(SET_CONFIRM_BEFORE_QUIT_CHANNEL, value),
  onQuitConfirmationRequested: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on(QUIT_CONFIRMATION_REQUEST_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(QUIT_CONFIRMATION_REQUEST_CHANNEL, wrapped);
    };
  },
  respondToQuitConfirmation: (choice) => {
    ipcRenderer.send(QUIT_CONFIRMATION_RESPONSE_CHANNEL, choice);
  },
  onAppCleanupDone: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on(APP_CLEANUP_DONE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(APP_CLEANUP_DONE_CHANNEL, wrapped);
    };
  },
  notifyReadyToExit: () => {
    ipcRenderer.send(APP_READY_TO_EXIT_CHANNEL);
    return Promise.resolve();
  },
  syncNotificationOverlay: (toasts) => {
    return ipcRenderer.invoke(NOTIFICATION_OVERLAY_SYNC_CHANNEL, toasts);
  },
  onNotificationOverlayAction: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      action: { toastId: string; actionId: string },
    ) => {
      if (action && typeof action.toastId === "string" && typeof action.actionId === "string") {
        listener(action);
      }
    };
    ipcRenderer.on(NOTIFICATION_OVERLAY_ACTION_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(NOTIFICATION_OVERLAY_ACTION_CHANNEL, handler);
    };
  },
  onNotificationOverlayDismiss: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, dismiss: { toastId: string }) => {
      if (dismiss && typeof dismiss.toastId === "string") {
        listener(dismiss);
      }
    };
    ipcRenderer.on(NOTIFICATION_OVERLAY_DISMISS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(NOTIFICATION_OVERLAY_DISMISS_CHANNEL, handler);
    };
  },
} satisfies DesktopBridge);
