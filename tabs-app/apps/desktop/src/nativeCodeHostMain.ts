import { createNativeCodeHostShutdown } from "./nativeCodeHostShutdown";
import {
  app,
  BrowserWindow,
  clipboard,
  contentTracing,
  dialog,
  nativeImage,
  nativeTheme,
  Notification,
  net,
  powerMonitor,
  powerSaveBlocker,
  screen,
  shell,
  systemPreferences,
  type WebContents,
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { pathToFileURL } from "node:url";
import * as Path from "node:path";
import * as OS from "node:os";

import { loadNativeCodeHostStorage, saveNativeCodeHostStorage } from "./nativeCodeHostStorage";
import { handleNativeCodeHostCommand } from "./nativeCodeHostCommand";
import {
  getNativeCodeOpenTargets,
  parseNativeAgentsWindowOptions,
  type NativeAgentsWindowPayload,
} from "./nativeCodeHostOpen";
import { parseElectronProxyResult, readProxyEnvironment } from "./nativeCodeHostProxy";
import { uploadFileViaGitHubMobileApi } from "./nativeCodeHostUpload";
import { createNativeCodeZip } from "./nativeCodeHostZip";

type NativeCodeHostModules = {
  registerContextMenuListener(
    resolvePopupContext?: (event: { sender: WebContents }) =>
      | {
          window?: BrowserWindow;
          offsetX?: number;
          offsetY?: number;
        }
      | undefined,
  ): void;
  ElectronIPCServer: new () => {
    registerChannel(name: string, channel: unknown): void;
    readonly connections: Array<{ readonly ctx: string }>;
    getChannel(
      name: string,
      clientFilter: (client: { readonly ctx: string }) => boolean,
    ): { call(command: string, arg?: unknown): Promise<unknown> };
    dispose(): void;
  };
  ProxyChannel: {
    fromService(service: unknown, disposables: unknown): unknown;
  };
  DisposableStore: new () => {
    add<T>(value: T): T;
    dispose(): void;
  };
  Emitter: new () => {
    event: unknown;
    fire(value: unknown): void;
    dispose(): void;
  };
  EventNone: unknown;
  VSBuffer: {
    wrap(value: Uint8Array): unknown;
  };
  isPortFree(port: number, timeout: number): Promise<boolean>;
  findFreePort(
    startPort: number,
    giveUpAfter: number,
    timeout: number,
    stride?: number,
  ): Promise<number>;
  zip(zipPath: string, files: unknown[]): Promise<string>;
  NullLogService: new () => unknown;
  NullLoggerService: new () => unknown;
  NullTelemetryService: unknown;
  ElectronAgentHostStarter: new (...args: unknown[]) => { dispose(): void };
  AgentHostProcessManager: new (...args: unknown[]) => { dispose(): void };
  ConfigurationService: new (...args: unknown[]) => {
    initialize(): Promise<void>;
    dispose(): void;
  };
  NullPolicyService: new () => unknown;
  ExtensionHostStarter: new (...args: unknown[]) => {
    dispose(): void;
  };
  DiskFileSystemProvider: new (...args: unknown[]) => {
    dispose(): void;
  };
  DiskFileSystemProviderChannel: new (...args: unknown[]) => {
    dispose(): void;
  };
  FileService: new (...args: unknown[]) => {
    registerProvider(scheme: string, provider: unknown): { dispose(): void };
    dispose(): void;
  };
  WebviewMainService: new (...args: unknown[]) => {
    dispose(): void;
  };
  UtilityProcessWorkerMainService: new (...args: unknown[]) => {
    dispose(): void;
  };
  extensionHostChannelName: string;
  localFileSystemChannelName: string;
  utilityProcessWorkerChannelName: string;
  ElectronPtyHostStarter: new (...args: unknown[]) => { dispose(): void };
  PtyHostService: new (...args: unknown[]) => { dispose(): void };
  TerminalLocalPtyChannelName: string;
  ExternalTerminalService: new () => unknown;
  NativeMcpDiscoveryHelperService: new () => unknown;
  NativeMcpDiscoveryHelperChannelName: string;
  URI: {
    file(path: string): unknown;
    parse(value: string): { toJSON(): unknown };
  };
  SharedProcess: new (...args: unknown[]) => {
    connect(payload?: unknown): Promise<unknown>;
    dispose(): void;
  };
  MessagePortClient: new (
    port: unknown,
    id: string,
  ) => {
    registerChannel(name: string, channel: unknown): void;
    dispose(): void;
  };
  EncryptionMainService: new (...args: unknown[]) => unknown;
  ServiceCollection: new () => { set(id: unknown, service: unknown): unknown };
  InstantiationService: new (...args: unknown[]) => {
    createInstance<T>(ctor: new (...args: never[]) => T, ...args: unknown[]): T;
    dispose(): void;
  };
  BrowserViewMainService: new (...args: never[]) => {
    tryGetBrowserView(id: string): { readonly hostWindowId: number } | undefined;
    layout(id: string, bounds: Electron.Rectangle): Promise<void>;
    dispose(): void;
  };
  BrowserViewGroupMainService: new (...args: never[]) => { dispose(): void };
  IBrowserViewMainService: unknown;
  ipcBrowserViewChannelName: string;
  ipcBrowserViewGroupChannelName: string;
  IEnvironmentMainService: unknown;
  IWindowsMainService: unknown;
  IAuxiliaryWindowsMainService: unknown;
  ITelemetryService: unknown;
  INativeHostMainService: unknown;
  IApplicationStorageMainService: unknown;
  ILogService: unknown;
  IProductService: unknown;
  IAgentNetworkFilterService: unknown;
};

type ServerChannel = {
  listen(context: unknown, event: string, arg?: unknown): unknown;
  call(context: unknown, command: string, arg?: unknown): Promise<unknown>;
};

type NativeCodeWindow = {
  readonly id: number;
  readonly win: BrowserWindow;
  readonly webContents: WebContents;
  readonly openedWorkspace?: { readonly id: string };
  readonly onDidClose: unknown;
  readonly onDidDestroy: unknown;
  isDestroyed(): boolean;
};

type ExtensionHostWindow = {
  readonly webContents: WebContents;
  isDestroyed(): boolean;
  on(event: string, listener: () => void): unknown;
};

function passiveChannel(
  eventNone: unknown,
  call: (command: string, arg: unknown) => unknown,
): ServerChannel {
  return {
    listen() {
      return eventNone;
    },
    async call(_context, command, arg) {
      return call(command, arg);
    },
  };
}

export interface NativeCodeHostMainBackend {
  registerWindow(window: BrowserWindow): void;
  registerWebContents(
    webContents: WebContents,
    getBounds?: () => Electron.Rectangle | null,
    ownerWindow?: BrowserWindow,
    projectId?: string,
  ): void;
  unregisterWindow(windowId: number): void;
  handleURL(url: string): Promise<boolean>;
  dispose(): Promise<void>;
}

function moduleUrl(vscodeRoot: string, relativePath: string): string {
  return pathToFileURL(Path.join(vscodeRoot, "out", relativePath)).href;
}

async function loadNativeCodeHostModules(vscodeRoot: string): Promise<NativeCodeHostModules> {
  const [
    electronIpc,
    contextMenu,
    ipc,
    lifecycle,
    events,
    log,
    telemetry,
    extensionHostStarter,
    extensionHostStarterContract,
    diskProvider,
    diskProviderChannel,
    diskProviderClient,
    fileService,
    webviewMainService,
    utilityProcessWorker,
    utilityProcessWorkerContract,
    electronPtyHostStarter,
    ptyHostService,
    terminalContract,
    externalTerminal,
    nativeMcpDiscoveryHelper,
    nativeMcpDiscoveryContract,
    uri,
    sharedProcess,
    messagePortIpc,
    encryptionMain,
    instantiationService,
    serviceCollection,
    browserViewMainService,
    browserViewGroupMainService,
    browserViewContract,
    browserViewGroupContract,
    environmentMainContract,
    windowsMainContract,
    auxiliaryWindowsMainContract,
    telemetryContract,
    nativeHostMainContract,
    storageMainContract,
    productContract,
    networkFilterContract,
    buffer,
    ports,
    zip,
    agentHostStarter,
    agentHostService,
    configuration,
    policy,
  ] = await Promise.all([
    import(moduleUrl(vscodeRoot, "vs/base/parts/ipc/electron-main/ipc.electron.js")),
    import(moduleUrl(vscodeRoot, "vs/base/parts/contextmenu/electron-main/contextmenu.js")),
    import(moduleUrl(vscodeRoot, "vs/base/parts/ipc/common/ipc.js")),
    import(moduleUrl(vscodeRoot, "vs/base/common/lifecycle.js")),
    import(moduleUrl(vscodeRoot, "vs/base/common/event.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/log/common/log.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/telemetry/common/telemetryUtils.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/extensions/electron-main/extensionHostStarter.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/extensions/common/extensionHostStarter.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/files/node/diskFileSystemProvider.js")),
    import(
      moduleUrl(vscodeRoot, "vs/platform/files/electron-main/diskFileSystemProviderServer.js")
    ),
    import(moduleUrl(vscodeRoot, "vs/platform/files/common/diskFileSystemProviderClient.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/files/common/fileService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/webview/electron-main/webviewMainService.js")),
    import(
      moduleUrl(
        vscodeRoot,
        "vs/platform/utilityProcess/electron-main/utilityProcessWorkerMainService.js",
      )
    ),
    import(
      moduleUrl(vscodeRoot, "vs/platform/utilityProcess/common/utilityProcessWorkerService.js")
    ),
    import(moduleUrl(vscodeRoot, "vs/platform/terminal/electron-main/electronPtyHostStarter.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/terminal/node/ptyHostService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/terminal/common/terminal.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/externalTerminal/node/externalTerminalService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/mcp/node/nativeMcpDiscoveryHelperService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/mcp/common/nativeMcpDiscoveryHelper.js")),
    import(moduleUrl(vscodeRoot, "vs/base/common/uri.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/sharedProcess/electron-main/sharedProcess.js")),
    import(moduleUrl(vscodeRoot, "vs/base/parts/ipc/electron-main/ipc.mp.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/encryption/electron-main/encryptionMainService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/instantiation/common/instantiationService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/instantiation/common/serviceCollection.js")),
    import(
      moduleUrl(vscodeRoot, "vs/platform/browserView/electron-main/browserViewMainService.js")
    ),
    import(
      moduleUrl(vscodeRoot, "vs/platform/browserView/electron-main/browserViewGroupMainService.js")
    ),
    import(moduleUrl(vscodeRoot, "vs/platform/browserView/common/browserView.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/browserView/common/browserViewGroup.js")),
    import(
      moduleUrl(vscodeRoot, "vs/platform/environment/electron-main/environmentMainService.js")
    ),
    import(moduleUrl(vscodeRoot, "vs/platform/windows/electron-main/windows.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/auxiliaryWindow/electron-main/auxiliaryWindows.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/telemetry/common/telemetry.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/native/electron-main/nativeHostMainService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/storage/electron-main/storageMainService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/product/common/productService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/networkFilter/common/networkFilterService.js")),
    import(moduleUrl(vscodeRoot, "vs/base/common/buffer.js")),
    import(moduleUrl(vscodeRoot, "vs/base/node/ports.js")),
    import(moduleUrl(vscodeRoot, "vs/base/node/zip.js")),
    import(
      moduleUrl(vscodeRoot, "vs/platform/agentHost/electron-main/electronAgentHostStarter.js")
    ),
    import(moduleUrl(vscodeRoot, "vs/platform/agentHost/node/agentHostService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/configuration/common/configurationService.js")),
    import(moduleUrl(vscodeRoot, "vs/platform/policy/common/policy.js")),
  ]);

  return {
    registerContextMenuListener: contextMenu.registerContextMenuListener,
    ElectronIPCServer: electronIpc.Server,
    ProxyChannel: ipc.ProxyChannel,
    DisposableStore: lifecycle.DisposableStore,
    Emitter: events.Emitter,
    EventNone: events.Event.None,
    NullLogService: log.NullLogService,
    NullLoggerService: log.NullLoggerService,
    NullTelemetryService: telemetry.NullTelemetryService,
    ExtensionHostStarter: extensionHostStarter.ExtensionHostStarter,
    DiskFileSystemProvider: diskProvider.DiskFileSystemProvider,
    DiskFileSystemProviderChannel: diskProviderChannel.DiskFileSystemProviderChannel,
    FileService: fileService.FileService,
    WebviewMainService: webviewMainService.WebviewMainService,
    UtilityProcessWorkerMainService: utilityProcessWorker.UtilityProcessWorkerMainService,
    extensionHostChannelName: extensionHostStarterContract.ipcExtensionHostStarterChannelName,
    localFileSystemChannelName: diskProviderClient.LOCAL_FILE_SYSTEM_CHANNEL_NAME,
    utilityProcessWorkerChannelName:
      utilityProcessWorkerContract.ipcUtilityProcessWorkerChannelName,
    ElectronPtyHostStarter: electronPtyHostStarter.ElectronPtyHostStarter,
    PtyHostService: ptyHostService.PtyHostService,
    TerminalLocalPtyChannelName: terminalContract.TerminalIpcChannels.LocalPty,
    ExternalTerminalService:
      process.platform === "win32"
        ? externalTerminal.WindowsExternalTerminalService
        : process.platform === "darwin"
          ? externalTerminal.MacExternalTerminalService
          : externalTerminal.LinuxExternalTerminalService,
    NativeMcpDiscoveryHelperService: nativeMcpDiscoveryHelper.NativeMcpDiscoveryHelperService,
    NativeMcpDiscoveryHelperChannelName:
      nativeMcpDiscoveryContract.NativeMcpDiscoveryHelperChannelName,
    URI: uri.URI,
    SharedProcess: sharedProcess.SharedProcess,
    MessagePortClient: messagePortIpc.Client,
    EncryptionMainService: encryptionMain.EncryptionMainService,
    ServiceCollection: serviceCollection.ServiceCollection,
    InstantiationService: instantiationService.InstantiationService,
    BrowserViewMainService: browserViewMainService.BrowserViewMainService,
    BrowserViewGroupMainService: browserViewGroupMainService.BrowserViewGroupMainService,
    IBrowserViewMainService: browserViewMainService.IBrowserViewMainService,
    ipcBrowserViewChannelName: browserViewContract.ipcBrowserViewChannelName,
    ipcBrowserViewGroupChannelName: browserViewGroupContract.ipcBrowserViewGroupChannelName,
    IEnvironmentMainService: environmentMainContract.IEnvironmentMainService,
    IWindowsMainService: windowsMainContract.IWindowsMainService,
    IAuxiliaryWindowsMainService: auxiliaryWindowsMainContract.IAuxiliaryWindowsMainService,
    ITelemetryService: telemetryContract.ITelemetryService,
    INativeHostMainService: nativeHostMainContract.INativeHostMainService,
    IApplicationStorageMainService: storageMainContract.IApplicationStorageMainService,
    ILogService: log.ILogService,
    IProductService: productContract.IProductService,
    IAgentNetworkFilterService: networkFilterContract.IAgentNetworkFilterService,
    VSBuffer: buffer.VSBuffer,
    isPortFree: ports.isPortFree,
    findFreePort: ports.findFreePort,
    zip: zip.zip,
    ElectronAgentHostStarter: agentHostStarter.ElectronAgentHostStarter,
    AgentHostProcessManager: agentHostService.AgentHostProcessManager,
    ConfigurationService: configuration.ConfigurationService,
    NullPolicyService: policy.NullPolicyService,
  };
}

function createSharedProcessProfile(modules: NativeCodeHostModules, stateDir: string) {
  const profileRoot = Path.join(stateDir, "code-oss-desktop", "shared-profile");
  const location = Path.join(profileRoot, "default");
  const resource = (name: string) => modules.URI.file(Path.join(location, name));
  return {
    home: modules.URI.file(Path.join(profileRoot, "profiles")),
    profile: {
      id: "default",
      isDefault: true,
      name: "Default",
      location: modules.URI.file(location),
      globalStorageHome: resource("globalStorage"),
      settingsResource: resource("settings.json"),
      keybindingsResource: resource("keybindings.json"),
      tasksResource: resource("tasks.json"),
      snippetsHome: resource("snippets"),
      promptsHome: resource("prompts"),
      extensionsResource: resource("extensions.json"),
      mcpResource: resource("mcp.json"),
      languageModelsResource: resource("chatLanguageModels.json"),
      agentPluginsHome: resource("agent-plugins"),
      cacheHome: modules.URI.file(Path.join(profileRoot, "cache")),
    },
  };
}

export async function createNativeCodeHostMainBackend(
  vscodeRoot: string,
  stateDir: string,
  callbacks?: {
    openFile?(projectId: string, path: string): void;
    openFolder?(path?: string): void;
    openAgentsWindow?(payload: NativeAgentsWindowPayload): Promise<void>;
    onWindowReady?(webContents: WebContents): void;
    dispatchTabAction?(action: "tab-new" | "tab-next" | "tab-prev"): void;
  },
): Promise<NativeCodeHostMainBackend> {
  const vsceSignEntry = [
    Path.join(vscodeRoot, "node_modules", "@vscode", "vsce-sign", "src", "main.js"),
    Path.join(vscodeRoot, "build", "node_modules", "@vscode", "vsce-sign", "src", "main.js"),
  ].find((candidate) => existsSync(candidate));
  if (!process.env.TABS_VSCE_SIGN_MODULE_PATH && vsceSignEntry) {
    process.env.TABS_VSCE_SIGN_MODULE_PATH = pathToFileURL(vsceSignEntry).href;
  }

  const modules = await loadNativeCodeHostModules(vscodeRoot);
  const disposables = new modules.DisposableStore();
  const ipcServer = new modules.ElectronIPCServer();
  const logService = new modules.NullLogService();
  const onWillShutdown = new modules.Emitter();
  const onWillLoadWindow = new modules.Emitter();
  // Extension/utility processes must reply to the embedded WebContents. Native
  // browser views, however, need the owning BrowserWindow so Electron can host
  // a WebContentsView. These IDs are intentionally the same, but the values
  // must remain separate.
  const windows = new Map<number, ExtensionHostWindow>();
  const browserWindows = new Map<number, NativeCodeWindow>();
  const projectIdsByWindow = new Map<number, string>();
  const embeddedBounds = new Map<number, () => Electron.Rectangle | null>();
  const reportedUnsupportedNativeHostCommands = new Set<string>();
  const activeToasts = new Map<
    string,
    {
      notification: Notification;
      finish(result: {
        supported: boolean;
        clicked: boolean;
        actionIndex?: number;
        suppressed?: boolean;
      }): void;
    }
  >();
  const activeToastDedupeKeys = new Map<string, string>();
  const clearToast = (id: string) => {
    const active = activeToasts.get(id);
    if (!active) return;
    active.finish({ supported: true, clicked: false });
  };
  const nativeHostEventNames = [
    "onDidOpenMainWindow",
    "onDidMaximizeWindow",
    "onDidUnmaximizeWindow",
    "onDidFocusMainWindow",
    "onDidBlurMainWindow",
    "onDidChangeWindowFullScreen",
    "onDidChangeWindowAlwaysOnTop",
    "onDidFocusMainOrAuxiliaryWindow",
    "onDidBlurMainOrAuxiliaryWindow",
    "onDidChangeDisplay",
    "onDidSuspendOS",
    "onDidResumeOS",
    "onDidChangeOnBatteryPower",
    "onDidChangeThermalState",
    "onDidChangeSpeedLimit",
    "onWillShutdownOS",
    "onDidLockScreen",
    "onDidUnlockScreen",
    "onDidChangeColorScheme",
  ] as const;
  const nativeHostEvents = new Map(
    nativeHostEventNames.map((name) => [name, new modules.Emitter()] as const),
  );
  const fireNativeHostEvent = (name: (typeof nativeHostEventNames)[number], value?: unknown) =>
    nativeHostEvents.get(name)?.fire(value);

  const nativeThemeUpdated = () =>
    fireNativeHostEvent("onDidChangeColorScheme", {
      dark: nativeTheme.shouldUseDarkColors,
      highContrast: nativeTheme.shouldUseHighContrastColors,
    });
  nativeTheme.on("updated", nativeThemeUpdated);

  const displayChanged = () => fireNativeHostEvent("onDidChangeDisplay", undefined);
  screen.on("display-added", displayChanged);
  screen.on("display-removed", displayChanged);
  screen.on("display-metrics-changed", displayChanged);

  const powerListeners: Array<[string, (...args: unknown[]) => void]> = [
    ["suspend", () => fireNativeHostEvent("onDidSuspendOS", undefined)],
    ["resume", () => fireNativeHostEvent("onDidResumeOS", undefined)],
    ["on-ac", () => fireNativeHostEvent("onDidChangeOnBatteryPower", false)],
    ["on-battery", () => fireNativeHostEvent("onDidChangeOnBatteryPower", true)],
    [
      "thermal-state-change",
      (_event, state) => fireNativeHostEvent("onDidChangeThermalState", state),
    ],
    ["speed-limit-change", (_event, limit) => fireNativeHostEvent("onDidChangeSpeedLimit", limit)],
    ["shutdown", () => fireNativeHostEvent("onWillShutdownOS", undefined)],
    ["lock-screen", () => fireNativeHostEvent("onDidLockScreen", undefined)],
    ["unlock-screen", () => fireNativeHostEvent("onDidUnlockScreen", undefined)],
  ];
  const powerMonitorEmitter = powerMonitor as unknown as EventEmitter;
  for (const [event, listener] of powerListeners) powerMonitorEmitter.on(event, listener);

  disposables.add({
    dispose() {
      nativeTheme.removeListener("updated", nativeThemeUpdated);
      screen.removeListener("display-added", displayChanged);
      screen.removeListener("display-removed", displayChanged);
      screen.removeListener("display-metrics-changed", displayChanged);
      for (const [event, listener] of powerListeners) {
        powerMonitorEmitter.removeListener(event, listener);
      }
      for (const emitter of nativeHostEvents.values()) emitter.dispose();
      for (const id of Array.from(activeToasts.keys())) clearToast(id);
    },
  });

  // The stock Code-OSS main process installs this application-level IPC
  // listener during startup. Tabs replaces that main process, so embedded
  // workbenches otherwise send native menu requests into an unhandled channel.
  // Code-OSS reports coordinates relative to its WebContentsView; native menus
  // need coordinates relative to the owning Tabs window.
  modules.registerContextMenuListener((event) => {
    const bounds = embeddedBounds.get(event.sender.id)?.();
    if (!bounds) return undefined;
    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();

    return {
      ...(ownerWindow ? { window: ownerWindow } : null),
      offsetX: bounds.x,
      offsetY: bounds.y,
    };
  });

  Object.assign(globalThis, {
    _VSCODE_FILE_ROOT: pathToFileURL(Path.join(vscodeRoot, "out") + Path.sep).href,
  });

  const lifecycleService = {
    onWillShutdown: onWillShutdown.event,
    onWillLoadWindow: onWillLoadWindow.event,
  };
  const windowsService = {
    getWindowById(windowId: number) {
      const win = windows.get(windowId);
      return win ? { id: windowId, win } : undefined;
    },
  };
  const browserWindowsService = {
    getWindowById(windowId: number) {
      return browserWindows.get(windowId);
    },
  };
  const configurationService = {
    onDidChangeConfiguration: modules.EventNone,
    getValue(key?: string) {
      if (key === "terminal.integrated.persistentSessionScrollback") return 100;
      // PtyHostService forwards this setting to the utility-process pty service
      // as soon as the first terminal starts. The full Code main process gets
      // the registered default (`[]`) from ConfigurationService; this embedded
      // main-process shim must preserve that contract instead of returning
      // undefined, which makes PtyService spread a non-iterable value.
      if (key === "terminal.integrated.ignoreProcessNames") return [];
      return undefined;
    },
  };
  const environmentService = {
    args: {
      _: [],
      "disable-telemetry": true,
      "disable-updates": true,
      "extensions-dir": Path.join(stateDir, "code-oss-desktop", "extensions"),
      "user-data-dir": Path.join(stateDir, "code-oss-desktop", "shared-process"),
    },
    isBuilt: false,
    userDataPath: Path.join(stateDir, "code-oss-desktop", "shared-process"),
    codeCachePath: Path.join(stateDir, "code-oss-desktop", "shared-process", "cache"),
    logsHome: modules.URI.file(Path.join(OS.tmpdir(), "tabs-code-oss-logs")),
    unsetSnapExportedVariables() {},
    restoreSnapExportedVariables() {},
  };

  const extensionHostStarter = new modules.ExtensionHostStarter(
    logService,
    lifecycleService,
    windowsService,
    modules.NullTelemetryService,
    configurationService,
  );
  const diskFileSystemProvider = new modules.DiskFileSystemProvider(logService);
  const fileService = new modules.FileService(logService);
  const fileProviderRegistration = fileService.registerProvider("file", diskFileSystemProvider);
  const diskFileSystemProviderChannel = new modules.DiskFileSystemProviderChannel(
    diskFileSystemProvider,
    logService,
    environmentService,
  );
  const utilityProcessWorkerService = new modules.UtilityProcessWorkerMainService(
    logService,
    windowsService,
    modules.NullTelemetryService,
    lifecycleService,
  );
  const loggerService = new modules.NullLoggerService();
  const agentHostConfiguration = new modules.ConfigurationService(
    modules.URI.file(
      Path.join(stateDir, "code-oss-desktop", "shared-profile", "default", "settings.json"),
    ),
    fileService,
    new modules.NullPolicyService(),
    logService,
  );
  await agentHostConfiguration.initialize();
  // Keep these identifiers consistent with CodeHostManager's renderer configuration.
  const agentHostTelemetryIds = {
    machineId: createHash("sha256").update(`machine:${vscodeRoot}`).digest("hex"),
    sqmId: createHash("sha256").update(`sqm:${vscodeRoot}`).digest("hex"),
    devDeviceId: createHash("sha256").update(`dev:${vscodeRoot}`).digest("hex"),
  };
  const agentHostStarter = new modules.ElectronAgentHostStarter(
    agentHostTelemetryIds,
    agentHostConfiguration,
    environmentService,
    lifecycleService,
    logService,
    modules.NullTelemetryService,
  );
  const agentHostProcessManager = new modules.AgentHostProcessManager(
    agentHostStarter,
    process.platform,
    logService,
    loggerService,
    modules.NullTelemetryService,
  );
  const ptyHostStarter = new modules.ElectronPtyHostStarter(
    { graceTime: 60_000, shortGraceTime: 6_000, scrollback: 100 },
    configurationService,
    environmentService,
    lifecycleService,
    logService,
  );
  const ptyHostService = new modules.PtyHostService(
    ptyHostStarter,
    configurationService,
    logService,
    loggerService,
  );
  const externalTerminalService = new modules.ExternalTerminalService();
  const nativeMcpDiscoveryHelperService = new modules.NativeMcpDiscoveryHelperService();
  const encryptionService = new modules.EncryptionMainService(logService);
  const webviewMainService = new modules.WebviewMainService(fileService, windowsService);
  const sharedProfile = createSharedProcessProfile(modules, stateDir);
  const storagePath = Path.join(
    stateDir,
    "code-oss-desktop",
    "shared-profile",
    "default",
    "globalStorage",
    "storage.json",
  );
  const storage = loadNativeCodeHostStorage(storagePath);
  const storageChannel = passiveChannel(modules.EventNone, (command, arg) => {
    if (command === "getItems") {
      return Array.from(storage.entries());
    }
    if (command === "updateItems" && arg && typeof arg === "object") {
      const update = arg as {
        insert?: Array<[string, string]>;
        delete?: string[];
      };
      for (const [key, value] of update.insert ?? []) storage.set(key, value);
      for (const key of update.delete ?? []) storage.delete(key);
      saveNativeCodeHostStorage(storagePath, storage);
    }
    if (command === "isUsed") return false;
    return undefined;
  });
  const loggerChannel = passiveChannel(modules.EventNone, (command, arg) => {
    if (command === "consoleLog" && Array.isArray(arg)) {
      const values = Array.isArray(arg[1]) ? arg[1] : [];
      console.log("[code-oss]", ...values);
    }
    return undefined;
  });

  const applicationStorageService = {
    get(key: string) {
      return storage.get(key);
    },
    store(key: string, value: string) {
      storage.set(key, value);
      saveNativeCodeHostStorage(storagePath, storage);
    },
    remove(key: string) {
      storage.delete(key);
      saveNativeCodeHostStorage(storagePath, storage);
    },
  };
  const browserServices = new modules.ServiceCollection();
  browserServices.set(modules.IEnvironmentMainService, {
    ...environmentService,
    workspaceStorageHome: modules.URI.file(
      Path.join(stateDir, "code-oss-desktop", "browser-workspaces"),
    ),
  });
  browserServices.set(modules.IWindowsMainService, browserWindowsService);
  browserServices.set(modules.IAuxiliaryWindowsMainService, {
    getWindowByWebContents() {
      return undefined;
    },
  });
  browserServices.set(modules.ITelemetryService, modules.NullTelemetryService);
  browserServices.set(modules.INativeHostMainService, {
    async openExternal(_windowId: number | undefined, url: string) {
      await shell.openExternal(url);
    },
  });
  browserServices.set(modules.IApplicationStorageMainService, applicationStorageService);
  browserServices.set(modules.ILogService, logService);
  browserServices.set(modules.IProductService, {
    nameShort: "Tabs",
    nameLong: "Tabs",
    version: process.env.npm_package_version ?? "0.0.0",
    commit: "",
    urlProtocol: "tabs",
  });
  browserServices.set(modules.IAgentNetworkFilterService, {
    _serviceBrand: undefined,
    isUriAllowed: () => true,
    isEnabled: () => false,
    formatError: (uri: unknown) => `Blocked: ${uri}`,
    onDidChange: modules.EventNone as (...args: unknown[]) => { dispose(): void },
  });
  const browserInstantiationService = new modules.InstantiationService(browserServices, true);
  const browserViewMainService = browserInstantiationService.createInstance(
    modules.BrowserViewMainService,
  );
  const layoutBrowserView = browserViewMainService.layout.bind(browserViewMainService);
  browserViewMainService.layout = (id, bounds) => {
    const hostWindowId = browserViewMainService.tryGetBrowserView(id)?.hostWindowId;
    const hostBounds =
      hostWindowId === undefined ? undefined : embeddedBounds.get(hostWindowId)?.();
    return layoutBrowserView(
      id,
      hostBounds ? { ...bounds, x: bounds.x + hostBounds.x, y: bounds.y + hostBounds.y } : bounds,
    );
  };
  browserServices.set(modules.IBrowserViewMainService, browserViewMainService);
  const browserViewGroupMainService = browserInstantiationService.createInstance(
    modules.BrowserViewGroupMainService,
  );

  for (const pathname of [
    environmentService.args["extensions-dir"],
    environmentService.args["user-data-dir"],
    environmentService.codeCachePath,
    Path.join(stateDir, "code-oss-desktop", "shared-profile", "default", "agent-plugins"),
  ]) {
    await import("node:fs/promises").then((fs) => fs.mkdir(pathname, { recursive: true }));
  }

  ipcServer.registerChannel(
    modules.extensionHostChannelName,
    modules.ProxyChannel.fromService(extensionHostStarter, disposables),
  );

  const userDataProfilesChannel = modules.ProxyChannel.fromService(
    {
      onDidChangeProfiles: modules.EventNone,
      onDidResetWorkspaces: modules.EventNone,
      profilesHome: sharedProfile.home,
      profiles: [sharedProfile.profile],
      defaultProfile: sharedProfile.profile,
      async createProfile() {
        return sharedProfile.profile;
      },
      async updateProfile() {
        return sharedProfile.profile;
      },
      async removeProfile() {},
      async setProfileForWorkspace() {},
      async unsetWorkspace() {},
      async resetWorkspaces() {},
      async cleanUp() {},
      async cleanUpTransientProfiles() {},
    },
    disposables,
  );
  ipcServer.registerChannel("userDataProfiles", userDataProfilesChannel);
  ipcServer.registerChannel(
    "encryption",
    modules.ProxyChannel.fromService(encryptionService, disposables),
  );
  ipcServer.registerChannel(
    "extensionhostdebugservice",
    passiveChannel(modules.EventNone, () => undefined),
  );
  ipcServer.registerChannel(
    "nativeManagedSettings",
    passiveChannel(modules.EventNone, (command) => {
      if (command === "getManagedSettings" || command === "updatePolicyDefinitions") {
        return {};
      }
      return undefined;
    }),
  );
  ipcServer.registerChannel(
    "fileManagedSettings",
    passiveChannel(modules.EventNone, (command) => {
      if (command === "getRawManagedSettings" || command === "getManagedSettings") {
        return {};
      }
      return undefined;
    }),
  );

  const sharedProcess = new modules.SharedProcess(
    "tabs-machine",
    "tabs-sqm",
    "tabs-device",
    environmentService,
    {
      profilesHome: sharedProfile.home,
      profiles: [sharedProfile.profile],
    },
    lifecycleService,
    logService,
    {
      getLogLevel: () => 2,
      getGlobalLoggers: () => [],
    },
    { serialize: () => ({}) },
  );

  let shuttingDown = false;
  const sharedProcessMainClient = sharedProcess.connect().then((port) => {
    const client = new modules.MessagePortClient(port, "main");
    client.registerChannel(modules.localFileSystemChannelName, diskFileSystemProviderChannel);
    client.registerChannel("userDataProfiles", userDataProfilesChannel);
    client.registerChannel("logger", loggerChannel);
    client.registerChannel(
      "policy",
      passiveChannel(modules.EventNone, () => ({})),
    );
    client.registerChannel(
      "nativeHost",
      passiveChannel(modules.EventNone, () => undefined),
    );
    client.registerChannel("storage", storageChannel);
    client.registerChannel(
      "meteredConnection",
      passiveChannel(modules.EventNone, () => false),
    );
    client.registerChannel(
      "browserElements",
      passiveChannel(modules.EventNone, () => undefined),
    );
    return client;
  });
  ipcServer.registerChannel(modules.localFileSystemChannelName, diskFileSystemProviderChannel);
  ipcServer.registerChannel(
    modules.utilityProcessWorkerChannelName,
    modules.ProxyChannel.fromService(utilityProcessWorkerService, disposables),
  );
  ipcServer.registerChannel(
    modules.TerminalLocalPtyChannelName,
    modules.ProxyChannel.fromService(ptyHostService, disposables),
  );
  ipcServer.registerChannel(
    "externalTerminal",
    modules.ProxyChannel.fromService(externalTerminalService, disposables),
  );
  ipcServer.registerChannel(
    modules.NativeMcpDiscoveryHelperChannelName,
    modules.ProxyChannel.fromService(nativeMcpDiscoveryHelperService, disposables),
  );

  // These channels are always present in the stock Electron main process. The
  // embedded workbench does not own a second application window or native
  // menubar, so Tabs provides the subset that is meaningful inside a tool.
  const recentWorkspaces: unknown[] = [];
  ipcServer.registerChannel(
    "workspaces",
    modules.ProxyChannel.fromService(
      {
        onDidChangeRecentlyOpened: modules.EventNone,
        async enterWorkspace() {
          return undefined;
        },
        async createUntitledWorkspace(folders: unknown[] = []) {
          const configPath = modules.URI.file(
            Path.join(OS.tmpdir(), "tabs-code-workspaces", `${randomUUID()}.code-workspace`),
          );
          return { id: randomUUID(), configPath, folders };
        },
        async deleteUntitledWorkspace() {},
        async getWorkspaceIdentifier(workspaceUri: { toString(): string }) {
          return {
            id: createHash("md5").update(workspaceUri.toString()).digest("hex"),
            configPath: workspaceUri,
          };
        },
        async addRecentlyOpened(recents: unknown[]) {
          recentWorkspaces.push(...recents);
        },
        async removeRecentlyOpened() {},
        async clearRecentlyOpened() {
          recentWorkspaces.length = 0;
        },
        async getRecentlyOpened() {
          return { workspaces: recentWorkspaces, files: [] };
        },
        async getDirtyWorkspaces() {
          return [];
        },
      },
      disposables,
    ),
  );
  ipcServer.registerChannel(
    "menubar",
    modules.ProxyChannel.fromService({ async updateMenubar() {} }, disposables),
  );
  ipcServer.registerChannel(
    "webview",
    modules.ProxyChannel.fromService(webviewMainService, disposables),
  );
  const browserViewChannel = modules.ProxyChannel.fromService(browserViewMainService, disposables);
  const browserViewGroupChannel = modules.ProxyChannel.fromService(
    browserViewGroupMainService,
    disposables,
  );
  ipcServer.registerChannel(modules.ipcBrowserViewChannelName, browserViewChannel);
  ipcServer.registerChannel(modules.ipcBrowserViewGroupChannelName, browserViewGroupChannel);
  void sharedProcessMainClient
    .then((client) => {
      client.registerChannel(modules.ipcBrowserViewChannelName, browserViewChannel);
      client.registerChannel(modules.ipcBrowserViewGroupChannelName, browserViewGroupChannel);
    })
    .catch((error: unknown) => {
      if (!shuttingDown) {
        console.error("[code-oss] Shared process connection failed", error);
      }
    });

  ipcServer.registerChannel("logger", loggerChannel);
  ipcServer.registerChannel("storage", storageChannel);
  ipcServer.registerChannel(
    "keyboardLayout",
    passiveChannel(modules.EventNone, (command) =>
      command === "getKeyboardLayoutData"
        ? { keyboardLayoutInfo: null, keyboardMapping: null }
        : undefined,
    ),
  );
  ipcServer.registerChannel(
    "policy",
    passiveChannel(modules.EventNone, (command) =>
      command === "updatePolicyDefinitions" ? {} : undefined,
    ),
  );
  ipcServer.registerChannel(
    "update",
    passiveChannel(modules.EventNone, (command) => {
      if (command === "_getInitialState") return { type: "disabled", reason: "disabled" };
      if (command === "isLatestVersion") return true;
      return undefined;
    }),
  );
  const nativeHostChannel: ServerChannel = {
    listen(_context, event) {
      return (
        nativeHostEvents.get(event as (typeof nativeHostEventNames)[number])?.event ??
        modules.EventNone
      );
    },
    async call(_context, command, arg) {
      const args = Array.isArray(arg) ? arg : [];
      const windowId = typeof args[0] === "number" ? args[0] : undefined;
      const embeddedWindow = windowId === undefined ? undefined : browserWindows.get(windowId);
      const webContents = embeddedWindow?.webContents;
      const projectId = windowId === undefined ? undefined : projectIdsByWindow.get(windowId);
      const routeOpenTargets = async (openables: unknown) => {
        for (const target of getNativeCodeOpenTargets(openables)) {
          if (target.kind === "file") {
            if (!projectId) throw new Error("Cannot identify the Tabs project for the Code window");
            callbacks?.openFile?.(projectId, target.path);
          } else if (target.kind === "folder") {
            callbacks?.openFolder?.(target.path);
          } else {
            const options: Electron.MessageBoxOptions = {
              type: "info",
              message: "Multi-root Code workspaces are not supported in Tabs yet.",
              detail: `Open one of the folders from ${target.path} as a Tabs project instead.`,
              buttons: ["OK"],
            };
            if (embeddedWindow) await dialog.showMessageBox(embeddedWindow.win, options);
            else await dialog.showMessageBox(options);
          }
        }
      };
      // Electron's newer W3C clipboard typings omit the legacy native methods
      // that the Code-OSS desktop contract still uses. Electron 40 exposes them
      // at runtime, so keep the compatibility cast localized to this boundary
      // and retain safe fallbacks for runtimes that remove them.
      const nativeClipboard = clipboard as typeof clipboard & {
        readFindText?: () => string;
        writeFindText?: (text: string) => void;
        readBuffer?: (format: string) => Buffer;
        writeBuffer?: (format: string, buffer: Buffer, type?: "selection" | "clipboard") => void;
        readImage?: () => { toPNG(): Buffer };
      };
      const osCommand = await handleNativeCodeHostCommand(command, args, {
        clipboard,
        shell,
        ...(webContents && !webContents.isDestroyed() ? { webContents } : null),
      });
      if (osCommand.handled) return osCommand.value;
      if (command === "openWindow") {
        const targets = getNativeCodeOpenTargets(args[1]);
        if (targets.length === 0) callbacks?.openFolder?.();
        else await routeOpenTargets(args[1]);
        return undefined;
      }
      if (command === "openAgentsWindow") {
        if (!callbacks?.openAgentsWindow) throw new Error("Agents window host is unavailable");
        await callbacks.openAgentsWindow(parseNativeAgentsWindowOptions(args[1]));
        return undefined;
      }
      if (command === "notifyReady") {
        if (webContents) callbacks?.onWindowReady?.(webContents);
        return undefined;
      }
      if (command === "getWindowCount") return windows.size;
      if (command === "getWindows") {
        return Array.from(windows.keys(), (id) => ({ id, pid: process.pid }));
      }
      if (command === "getActiveWindowId") {
        const focused = Array.from(browserWindows.values()).find(
          (candidate) => !candidate.webContents.isDestroyed() && candidate.webContents.isFocused(),
        );
        return focused?.id;
      }
      if (command === "getActiveWindowPosition") {
        const focused = Array.from(browserWindows.values()).find(
          (candidate) => !candidate.webContents.isDestroyed() && candidate.webContents.isFocused(),
        );
        return focused?.win.getBounds();
      }
      if (command === "getNativeWindowHandle") {
        const requestedId = typeof args[1] === "number" ? args[1] : windowId;
        const requestedWindow =
          requestedId === undefined ? undefined : browserWindows.get(requestedId);
        return requestedWindow
          ? modules.VSBuffer.wrap(requestedWindow.win.getNativeWindowHandle())
          : undefined;
      }
      if (command === "getProcessId") return webContents?.getOSProcessId();
      if (command === "killProcess") {
        if (typeof args[1] === "number" && typeof args[2] === "string") {
          process.kill(args[1], args[2] as NodeJS.Signals);
        }
        return undefined;
      }
      if (command === "isFullScreen") return embeddedWindow?.win.isFullScreen() ?? false;
      if (command === "toggleFullScreen") {
        embeddedWindow?.win.setFullScreen(!(embeddedWindow.win.isFullScreen() ?? false));
        return undefined;
      }
      if (command === "getCursorScreenPoint") {
        const point = screen.getCursorScreenPoint();
        return { point, display: screen.getDisplayNearestPoint(point).bounds };
      }
      if (command === "isMaximized") return embeddedWindow?.win.isMaximized() ?? false;
      if (command === "focusWindow") {
        embeddedWindow?.webContents.focus();
        return undefined;
      }
      if (command === "maximizeWindow") return embeddedWindow?.win.maximize();
      if (command === "unmaximizeWindow") return embeddedWindow?.win.unmaximize();
      if (command === "minimizeWindow") return embeddedWindow?.win.minimize();
      if (command === "moveWindowTop") return embeddedWindow?.win.moveTop();
      if (command === "positionWindow") {
        const position = args[1] as Electron.Rectangle | undefined;
        if (position) embeddedWindow?.win.setBounds(position);
        return undefined;
      }
      if (command === "isWindowAlwaysOnTop") return embeddedWindow?.win.isAlwaysOnTop() ?? false;
      if (command === "toggleWindowAlwaysOnTop") {
        if (embeddedWindow) embeddedWindow.win.setAlwaysOnTop(!embeddedWindow.win.isAlwaysOnTop());
        return undefined;
      }
      if (command === "setWindowAlwaysOnTop") {
        embeddedWindow?.win.setAlwaysOnTop(Boolean(args[1]));
        return undefined;
      }
      if (command === "setMinimumSize") {
        if (!embeddedWindow) return undefined;
        const [currentWidth, currentHeight] = embeddedWindow.win.getMinimumSize();
        const width = typeof args[1] === "number" ? args[1] : currentWidth;
        const height = typeof args[2] === "number" ? args[2] : currentHeight;
        embeddedWindow.win.setMinimumSize(width ?? 0, height ?? 0);
        return undefined;
      }
      if (command === "setBackgroundThrottling") {
        webContents?.setBackgroundThrottling(Boolean(args[1]));
        return undefined;
      }
      if (command === "updateWindowAccentColor") {
        if (process.platform === "win32" && embeddedWindow) {
          const accentColor = typeof args[1] === "string" ? args[1] : undefined;
          embeddedWindow.win.setAccentColor(accentColor || false);
        }
        return undefined;
      }
      if (command === "updateWindowControls") {
        // Code's custom title-bar controls belong to its standalone window.
        // Tabs renders and owns the outer window chrome.
        return undefined;
      }
      if (command === "showMessageBox") {
        const owner = embeddedWindow?.win;
        return owner
          ? dialog.showMessageBox(owner, args[1] as Electron.MessageBoxOptions)
          : dialog.showMessageBox(args[1] as Electron.MessageBoxOptions);
      }
      if (command === "showSaveDialog") {
        const owner = embeddedWindow?.win;
        return owner
          ? dialog.showSaveDialog(owner, args[1] as Electron.SaveDialogOptions)
          : dialog.showSaveDialog(args[1] as Electron.SaveDialogOptions);
      }
      if (command === "showOpenDialog") {
        const owner = embeddedWindow?.win;
        return owner
          ? dialog.showOpenDialog(owner, args[1] as Electron.OpenDialogOptions)
          : dialog.showOpenDialog(args[1] as Electron.OpenDialogOptions);
      }
      if (
        command === "pickFileFolderAndOpen" ||
        command === "pickFileAndOpen" ||
        command === "pickFolderAndOpen" ||
        command === "pickWorkspaceAndOpen"
      ) {
        const options = (args[1] ?? {}) as Electron.OpenDialogOptions;
        const properties: Electron.OpenDialogOptions["properties"] = [
          command === "pickFileAndOpen" || command === "pickWorkspaceAndOpen"
            ? "openFile"
            : command === "pickFolderAndOpen"
              ? "openDirectory"
              : "openFile",
        ];
        if (command === "pickFileFolderAndOpen") properties.push("openDirectory");
        if ((options as { canSelectMany?: boolean }).canSelectMany)
          properties.push("multiSelections");
        const filters =
          command === "pickWorkspaceAndOpen"
            ? [{ name: "Code Workspace", extensions: ["code-workspace"] }]
            : options.filters;
        const dialogOptions: Electron.OpenDialogOptions = {
          ...options,
          properties,
          ...(filters ? { filters } : null),
        };
        const result = embeddedWindow?.win
          ? await dialog.showOpenDialog(embeddedWindow.win, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions);
        if (!result.canceled) {
          const openables = await Promise.all(
            result.filePaths.map(async (path) => {
              if (command === "pickWorkspaceAndOpen") {
                return { workspaceUri: { fsPath: path } };
              }
              if (command === "pickFolderAndOpen") return { folderUri: { fsPath: path } };
              if (command === "pickFileAndOpen") return { fileUri: { fsPath: path } };
              try {
                return (await import("node:fs/promises"))
                  .stat(path)
                  .then((stat) =>
                    stat.isDirectory()
                      ? { folderUri: { fsPath: path } }
                      : { fileUri: { fsPath: path } },
                  );
              } catch {
                return { fileUri: { fsPath: path } };
              }
            }),
          );
          await routeOpenTargets(openables);
        }
        return undefined;
      }
      if (command === "getOSStatistics") {
        return {
          totalmem: OS.totalmem(),
          freemem: OS.freemem(),
          loadavg: OS.loadavg(),
        };
      }
      if (command === "getOSProperties") {
        return {
          type: OS.type(),
          release: OS.release(),
          arch: OS.arch(),
          cpus: OS.cpus(),
        };
      }
      if (command === "getOSVirtualMachineHint") return 0;
      if (command === "getOSColorScheme") {
        return {
          dark: nativeTheme.shouldUseDarkColors,
          highContrast: nativeTheme.shouldUseHighContrastColors,
        };
      }
      if (command === "isAdmin") return false;
      if (command === "isRunningUnderARM64Translation") return app.runningUnderARM64Translation;
      if (command === "hasWSLFeatureInstalled") return false;
      if (command === "getMediaAccessStatus") {
        const mediaType = args[1];
        return process.platform === "darwin" &&
          (mediaType === "microphone" || mediaType === "camera" || mediaType === "screen")
          ? systemPreferences.getMediaAccessStatus(mediaType)
          : "unknown";
      }
      if (command === "writeElevated") {
        throw new Error(
          "Elevated file writes are not available in the embedded editor because Tabs does not ship the Code CLI privilege helper.",
        );
      }
      if (command === "setRepresentedFilename") {
        embeddedWindow?.win.setRepresentedFilename(typeof args[1] === "string" ? args[1] : "");
        return undefined;
      }
      if (command === "setDocumentEdited") {
        embeddedWindow?.win.setDocumentEdited(Boolean(args[1]));
        return undefined;
      }
      if (command === "setApplicationBadge") {
        const badge = args[1] as
          | { count?: number; description?: string; iconDataURL?: string }
          | undefined;
        const count = badge && typeof badge.count === "number" && badge.count > 0 ? badge.count : 0;
        if (process.platform === "win32") {
          if (count === 0 || !badge?.iconDataURL) {
            embeddedWindow?.win.setOverlayIcon(null, "");
          } else {
            embeddedWindow?.win.setOverlayIcon(
              nativeImage.createFromDataURL(badge.iconDataURL),
              badge.description ?? "",
            );
          }
        } else if (process.platform === "darwin") {
          app.dock?.setBadge(count > 0 ? String(count) : "");
        } else if (typeof app.setBadgeCount === "function") {
          app.setBadgeCount(count);
        }
        return undefined;
      }
      if (command === "hasClipboard") {
        return typeof args[1] === "string" ? clipboard.has(args[1]) : false;
      }
      if (command === "readClipboardFindText") {
        return nativeClipboard.readFindText?.() ?? clipboard.readText();
      }
      if (command === "writeClipboardFindText") {
        if (typeof args[1] === "string") {
          if (nativeClipboard.writeFindText) nativeClipboard.writeFindText(args[1]);
          else clipboard.writeText(args[1]);
        }
        return undefined;
      }
      if (command === "readClipboardBuffer") {
        return typeof args[1] === "string" && nativeClipboard.readBuffer
          ? modules.VSBuffer.wrap(nativeClipboard.readBuffer(args[1]))
          : modules.VSBuffer.wrap(new Uint8Array());
      }
      if (command === "writeClipboardBuffer") {
        const value = args[2] as { buffer?: Uint8Array } | Uint8Array | undefined;
        const bytes = value instanceof Uint8Array ? value : value?.buffer;
        if (typeof args[1] === "string" && bytes) {
          nativeClipboard.writeBuffer?.(
            args[1],
            Buffer.from(bytes),
            args[3] === "selection" ? "selection" : "clipboard",
          );
        }
        return undefined;
      }
      if (command === "readImage") {
        return nativeClipboard.readImage?.().toPNG() ?? new Uint8Array();
      }
      if (command === "getSystemIdleTime") return powerMonitor.getSystemIdleTime();
      if (command === "getSystemIdleState") {
        return powerMonitor.getSystemIdleState(typeof args[1] === "number" ? args[1] : 60);
      }
      if (command === "getCurrentThermalState") return powerMonitor.getCurrentThermalState();
      if (command === "isOnBatteryPower") return powerMonitor.isOnBatteryPower();
      if (command === "startPowerSaveBlocker") {
        return powerSaveBlocker.start(
          args[1] === "prevent-display-sleep" ? "prevent-display-sleep" : "prevent-app-suspension",
        );
      }
      if (command === "stopPowerSaveBlocker") {
        return typeof args[1] === "number" ? powerSaveBlocker.stop(args[1]) : false;
      }
      if (command === "isPowerSaveBlockerStarted") {
        return typeof args[1] === "number" ? powerSaveBlocker.isStarted(args[1]) : false;
      }
      if (command === "reload") return webContents?.reload();
      if (command === "relaunch") {
        const options = args[1] as { addArgs?: string[]; removeArgs?: string[] } | undefined;
        let nextArgs = process.argv.slice(1);
        if (options?.removeArgs?.length) {
          const removed = new Set(options.removeArgs);
          nextArgs = nextArgs.filter((value) => !removed.has(value));
        }
        if (options?.addArgs?.length) nextArgs.push(...options.addArgs);
        app.relaunch({ args: nextArgs });
        app.exit(0);
        return undefined;
      }
      if (command === "closeWindow") return embeddedWindow?.win.close();
      if (command === "quit") return app.quit();
      if (command === "exit") return app.exit(typeof args[1] === "number" ? args[1] : 0);
      if (command === "openDevTools") {
        webContents?.openDevTools(args[1] as Electron.OpenDevToolsOptions | undefined);
        return undefined;
      }
      if (command === "toggleDevTools") {
        webContents?.toggleDevTools();
        return undefined;
      }
      if (command === "openGPUInfoWindow") {
        const gpuWindow = new BrowserWindow({
          width: 900,
          height: 700,
          ...(embeddedWindow ? { parent: embeddedWindow.win } : null),
          title: "Tabs GPU Information",
        });
        await gpuWindow.loadURL("chrome://gpu");
        return undefined;
      }
      if (command === "openDevToolsWindow") {
        if (typeof args[1] !== "string") throw new Error("A DevTools URL is required");
        const devToolsWindow = new BrowserWindow({
          width: 1000,
          height: 800,
          ...(embeddedWindow ? { parent: embeddedWindow.win } : null),
        });
        await devToolsWindow.loadURL(args[1]);
        return undefined;
      }
      if (command === "openContentTracingWindow") {
        const tracingWindow = new BrowserWindow({ width: 1000, height: 800 });
        await tracingWindow.loadURL("chrome://tracing");
        return undefined;
      }
      if (command === "profileRenderer") {
        throw new Error("Renderer CPU profiling is not available in the embedded editor.");
      }
      if (command === "startTracing") {
        const categories = typeof args[1] === "string" ? args[1] : "";
        const options = args[2] as { enableHeapProfiling?: boolean } | undefined;
        await contentTracing.startRecording(
          options?.enableHeapProfiling
            ? {
                recording_mode: "record-until-full",
                included_categories: categories.split(",").filter(Boolean),
              }
            : { categoryFilter: categories, traceOptions: "record-until-full,enable-sampling" },
        );
        return undefined;
      }
      if (command === "stopTracing") {
        const tracePath = await contentTracing.stopRecording(
          Path.join(OS.tmpdir(), `tabs-${Date.now()}.trace.json`),
        );
        const options: Electron.MessageBoxOptions = {
          type: "info",
          message: "Successfully created the trace file",
          detail: tracePath,
          buttons: ["OK"],
        };
        if (embeddedWindow) await dialog.showMessageBox(embeddedWindow.win, options);
        else await dialog.showMessageBox(options);
        return undefined;
      }
      if (command === "getScreenshot") {
        if (!webContents || webContents.isDestroyed()) return undefined;
        const rect = args[1] as Electron.Rectangle | undefined;
        const captured = await webContents.capturePage(rect);
        return modules.VSBuffer.wrap(captured.toJPEG(95));
      }
      if (command === "uploadFileViaMobileApi") {
        const value = args[4] as { buffer?: Uint8Array } | Uint8Array | undefined;
        const bytes = value instanceof Uint8Array ? value : value?.buffer;
        if (
          typeof args[1] !== "string" ||
          typeof args[2] !== "string" ||
          typeof args[3] !== "string" ||
          !bytes ||
          typeof args[5] !== "string"
        ) {
          throw new Error("Invalid GitHub mobile upload arguments");
        }
        return uploadFileViaGitHubMobileApi(net.fetch, args[1], args[2], args[3], bytes, args[5]);
      }
      if (command === "showToast") {
        const options = args[1] as
          | {
              id?: string;
              dedupeKey?: string;
              title?: string;
              body?: string;
              actions?: string[];
              silent?: boolean;
            }
          | undefined;
        if (!Notification.isSupported() || !options?.id || !options.title) {
          return { supported: false, clicked: false };
        }
        if (options.dedupeKey && activeToastDedupeKeys.has(options.dedupeKey)) {
          return { supported: true, suppressed: true, clicked: false };
        }
        clearToast(options.id);
        const notification = new Notification({
          title: options.title,
          ...(options.body !== undefined ? { body: options.body } : null),
          ...(options.silent !== undefined ? { silent: options.silent } : null),
          ...(options.actions
            ? { actions: options.actions.map((text) => ({ type: "button" as const, text })) }
            : null),
        });
        return new Promise((resolve) => {
          let finished = false;
          const finish = (result: {
            supported: boolean;
            clicked: boolean;
            actionIndex?: number;
            suppressed?: boolean;
          }) => {
            if (finished) return;
            finished = true;
            activeToasts.delete(options.id!);
            if (options.dedupeKey && activeToastDedupeKeys.get(options.dedupeKey) === options.id) {
              activeToastDedupeKeys.delete(options.dedupeKey);
            }
            notification.removeAllListeners();
            notification.close();
            resolve(result);
          };
          activeToasts.set(options.id!, { notification, finish });
          if (options.dedupeKey) {
            activeToastDedupeKeys.set(options.dedupeKey, options.id!);
          }
          notification.on("click", () => finish({ supported: true, clicked: true }));
          notification.on("action", (_event, actionIndex) =>
            finish({ supported: true, clicked: true, actionIndex }),
          );
          notification.on("close", () => finish({ supported: true, clicked: false }));
          notification.on("failed", () => finish({ supported: false, clicked: false }));
          notification.show();
        });
      }
      if (command === "clearToast") {
        if (typeof args[1] === "string") clearToast(args[1]);
        return undefined;
      }
      if (command === "clearToasts") {
        for (const id of Array.from(activeToasts.keys())) clearToast(id);
        return undefined;
      }
      if (
        command === "notifyReady" ||
        command === "saveWindowSplash" ||
        // Code's Touch Bar actions target a standalone VS Code BrowserWindow.
        // Tabs embeds the workbench in a shared outer window, so installing that
        // command surface would target the wrong application command router.
        command === "updateTouchBar"
      ) {
        return undefined;
      }
      if (command === "newWindowTab") {
        callbacks?.dispatchTabAction?.("tab-new");
        return undefined;
      }
      if (command === "showPreviousWindowTab") {
        callbacks?.dispatchTabAction?.("tab-prev");
        return undefined;
      }
      if (command === "showNextWindowTab") {
        callbacks?.dispatchTabAction?.("tab-next");
        return undefined;
      }
      if (
        command === "moveWindowTabToNewWindow" ||
        command === "mergeAllWindowTabs" ||
        command === "toggleWindowTabsBar"
      ) {
        // Tabs owns one cross-platform tab strip inside its application window;
        // Electron's macOS native window-tab operations do not apply to it.
        return undefined;
      }
      if (command === "installShellCommand" || command === "uninstallShellCommand") {
        throw new Error(
          "The Code shell command is unavailable because Tabs does not ship a standalone Code CLI.",
        );
      }
      if (command === "syncSystemWideKeybindings") return { failed: [] };
      if (command === "resolveProxy") {
        const url = typeof args[1] === "string" ? args[1] : undefined;
        return url && webContents && !webContents.isDestroyed()
          ? webContents.session.resolveProxy(url)
          : undefined;
      }
      if (command === "resolveProxyWithPackage") {
        const url = typeof args[1] === "string" ? args[1] : undefined;
        if (!url || !webContents || webContents.isDestroyed()) return [{ kind: "direct" }];
        return parseElectronProxyResult(await webContents.session.resolveProxy(url));
      }
      if (command === "readProxyConfigWithPackage") {
        return {
          environment: readProxyEnvironment(process.env),
          autoDetect: true,
          wpadDhcp: { state: "unknown" },
          wpadDns: { state: "unknown" },
          configuredPac: { state: "unknown" },
          platform: {
            kind:
              process.platform === "darwin"
                ? "macos"
                : process.platform === "linux"
                  ? "linux"
                  : process.platform === "win32"
                    ? "windows"
                    : "unknown",
            ...(process.platform === "darwin"
              ? { exceptions: [], excludeSimpleHostnames: false }
              : process.platform === "linux"
                ? { ignoreHosts: [] }
                : null),
          },
        };
      }
      if (command === "isPortFree") {
        return typeof args[1] === "number" ? modules.isPortFree(args[1], 1_000) : false;
      }
      if (command === "findFreePort") {
        return modules.findFreePort(
          typeof args[1] === "number" ? args[1] : 0,
          typeof args[2] === "number" ? args[2] : 100,
          typeof args[3] === "number" ? args[3] : 1_000,
          typeof args[4] === "number" ? args[4] : 1,
        );
      }
      if (command === "loadCertificates") return [...rootCertificates];
      if (command === "windowsGetStringRegKey") {
        if (process.platform !== "win32") return undefined;
        if (
          typeof args[1] !== "string" ||
          typeof args[2] !== "string" ||
          typeof args[3] !== "string"
        ) {
          return undefined;
        }
        const registry = (await import(
          pathToFileURL(
            Path.join(
              vscodeRoot,
              "node_modules",
              "@vscode",
              "windows-registry",
              "dist",
              "index.js",
            ),
          ).href
        )) as {
          GetStringRegKey(hive: string, path: string, name: string): string | undefined;
        };
        try {
          return registry.GetStringRegKey(args[1], args[2], args[3]);
        } catch {
          return undefined;
        }
      }
      if (command === "createZipFile") {
        const files = Array.isArray(args[2]) ? args[2] : [];
        await createNativeCodeZip(
          modules.zip,
          args[1],
          files as never[],
          args[3] as { maxSize?: number; maxEntries?: number } | undefined,
        );
        return undefined;
      }
      if (command === "lookupAuthorization" || command === "lookupKerberosAuthorization") {
        return undefined;
      }
      if (!reportedUnsupportedNativeHostCommands.has(command)) {
        reportedUnsupportedNativeHostCommands.add(command);
        console.warn(`[code-oss] unsupported nativeHost command: ${command}`);
      }
      return undefined;
    },
  };
  ipcServer.registerChannel("nativeHost", nativeHostChannel);
  ipcServer.registerChannel(
    "meteredConnection",
    passiveChannel(modules.EventNone, (command) =>
      command === "IsConnectionMetered" ? false : undefined,
    ),
  );

  return {
    registerWindow(window) {
      const onDidClose = new modules.Emitter();
      const onDidDestroy = new modules.Emitter();
      const windowId = window.webContents.id;
      windows.set(windowId, window);
      browserWindows.set(windowId, {
        id: windowId,
        win: window,
        webContents: window.webContents,
        onDidClose: onDidClose.event,
        onDidDestroy: onDidDestroy.event,
        isDestroyed: () => window.isDestroyed(),
      });
      window.once("closed", () => {
        onDidClose.fire(undefined);
        onDidDestroy.fire(undefined);
        onDidClose.dispose();
        onDidDestroy.dispose();
        windows.delete(windowId);
        browserWindows.delete(windowId);
      });
    },
    registerWebContents(webContents, getBounds, ownerWindow, projectId) {
      const window = ownerWindow ?? BrowserWindow.fromWebContents(webContents);
      if (!window) {
        throw new Error("An owning BrowserWindow is required for embedded Code browser views.");
      }
      const onDidClose = new modules.Emitter();
      const onDidDestroy = new modules.Emitter();
      const extensionHostWindow = Object.assign(new EventEmitter(), {
        webContents,
        isDestroyed: () => webContents.isDestroyed(),
      });
      const embeddedWindow = {
        id: webContents.id,
        win: window,
        webContents,
        onDidClose: onDidClose.event,
        onDidDestroy: onDidDestroy.event,
        isDestroyed: () => webContents.isDestroyed(),
      } satisfies NativeCodeWindow;
      windows.set(webContents.id, extensionHostWindow);
      browserWindows.set(webContents.id, embeddedWindow);
      if (projectId) projectIdsByWindow.set(webContents.id, projectId);
      if (getBounds) embeddedBounds.set(webContents.id, getBounds);
      const webContentsListeners: Array<[string, (...args: unknown[]) => void]> = [
        [
          "focus",
          () => {
            fireNativeHostEvent("onDidFocusMainWindow", webContents.id);
            fireNativeHostEvent("onDidFocusMainOrAuxiliaryWindow", webContents.id);
          },
        ],
        [
          "blur",
          () => {
            fireNativeHostEvent("onDidBlurMainWindow", webContents.id);
            fireNativeHostEvent("onDidBlurMainOrAuxiliaryWindow", webContents.id);
          },
        ],
      ];
      const nativeWindowListeners: Array<[string, (...args: unknown[]) => void]> = [
        ["maximize", () => fireNativeHostEvent("onDidMaximizeWindow", webContents.id)],
        ["unmaximize", () => fireNativeHostEvent("onDidUnmaximizeWindow", webContents.id)],
        [
          "enter-full-screen",
          () =>
            fireNativeHostEvent("onDidChangeWindowFullScreen", {
              windowId: webContents.id,
              fullscreen: true,
            }),
        ],
        [
          "leave-full-screen",
          () =>
            fireNativeHostEvent("onDidChangeWindowFullScreen", {
              windowId: webContents.id,
              fullscreen: false,
            }),
        ],
        [
          "always-on-top-changed",
          (_event, alwaysOnTop) =>
            fireNativeHostEvent("onDidChangeWindowAlwaysOnTop", {
              windowId: webContents.id,
              alwaysOnTop,
            }),
        ],
      ];
      const windowEmitter = window as unknown as EventEmitter;
      const webContentsEmitter = webContents as unknown as EventEmitter;
      for (const [event, listener] of webContentsListeners) {
        webContentsEmitter.on(event, listener);
      }
      for (const [event, listener] of nativeWindowListeners) windowEmitter.on(event, listener);
      fireNativeHostEvent("onDidOpenMainWindow", webContents.id);
      webContents.once("destroyed", () => {
        for (const [event, listener] of webContentsListeners) {
          webContentsEmitter.removeListener(event, listener);
        }
        for (const [event, listener] of nativeWindowListeners) {
          windowEmitter.removeListener(event, listener);
        }
        extensionHostWindow.emit("closed");
        onDidClose.fire(undefined);
        onDidDestroy.fire(undefined);
        onDidClose.dispose();
        onDidDestroy.dispose();
        windows.delete(webContents.id);
        browserWindows.delete(webContents.id);
        projectIdsByWindow.delete(webContents.id);
        embeddedBounds.delete(webContents.id);
      });
    },
    unregisterWindow(windowId) {
      windows.delete(windowId);
      browserWindows.delete(windowId);
      projectIdsByWindow.delete(windowId);
    },
    async handleURL(url) {
      const uri = modules.URI.parse(url);
      const requestedWindowId = /(?:^|&)windowId=(\d+)(?:&|$)/.exec(
        new URL(url).search.slice(1),
      )?.[1];
      const candidateIds = requestedWindowId
        ? [Number(requestedWindowId)]
        : Array.from(windows.keys()).reverse();

      for (const windowId of candidateIds) {
        const clientPattern = new RegExp(`(?:^|,)window:${windowId}(?:,|$)`);
        if (!ipcServer.connections.some((connection) => clientPattern.test(connection.ctx))) {
          continue;
        }
        const channel = ipcServer.getChannel("urlHandler", (client) =>
          clientPattern.test(client.ctx),
        );
        return Boolean(await channel.call("handleURL", [uri.toJSON(), { originalUrl: url }]));
      }

      return false;
    },
    dispose: createNativeCodeHostShutdown(
      (event) => {
        shuttingDown = true;
        onWillShutdown.fire(event);
      },
      () => {
        windows.clear();
        browserWindows.clear();
        projectIdsByWindow.clear();
        embeddedBounds.clear();
        agentHostProcessManager.dispose();
        agentHostConfiguration.dispose();
        ptyHostService.dispose();
        (loggerService as { dispose(): void }).dispose();
        utilityProcessWorkerService.dispose();
        browserViewGroupMainService.dispose();
        browserViewMainService.dispose();
        browserInstantiationService.dispose();
        webviewMainService.dispose();
        fileProviderRegistration.dispose();
        fileService.dispose();
        diskFileSystemProviderChannel.dispose();
        diskFileSystemProvider.dispose();
        extensionHostStarter.dispose();
        void sharedProcessMainClient.then((client) => client.dispose()).catch(() => undefined);
        sharedProcess.dispose();
        disposables.dispose();
        ipcServer.dispose();
        onWillLoadWindow.dispose();
        onWillShutdown.dispose();
      },
    ),
  };
}
