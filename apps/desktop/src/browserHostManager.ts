import { BrowserInputGuard } from "./browserInputGuard";
import { BrowserComparisonController } from "./browserComparisonController";
import { runBrowserReproduction } from "./browserReproductionRunner";
import type { BrowserReproductionStep } from "@tabs/contracts";
import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { JourneyRecorder } from "./journeyRecorder";
import { BrowserSessionImporter } from "./browserImport/BrowserSessionImporter";
import {
  classifyAuthNavigation,
  sanitizeAuthUrl,
  hasSameRegistrableOrigin,
  isLoopbackHostname,
  type AuthClassificationKind,
  type AuthClassificationResult,
  type AuthNavigationRequest,
} from "./authClassifier";
import { openHardenedAuthWindow, type AuthWindowResult } from "./authWindow";
import {
  deriveBrowserPartition,
  extractProfileIdFromPartition,
  isPersistentPartition,
  isProfilePartition,
  normalizeProfileIdentifier,
} from "./profileStorage";
import { decideWindowOpenAction, configureChildPopupWindow } from "./popupHandoff";
import {
  PermissionMediator,
  checkWebAuthnContext,
  categorizePermission,
} from "./permissionMediator";
import { buildSecurityContext } from "./browserSecurityContext";
import { detectGoogleRejection } from "./googleAuthHandler";
import {
  BrowserAuthDiagnostics,
  type AuthDiagnosticEntry,
  sanitizeDiagnosticOrigin,
} from "./browserDiagnostics";

export const defaultPermissionMediator = new PermissionMediator();
const EXTERNAL_OAUTH_REQUIRED_MESSAGE =
  "This provider does not permit sign-in inside embedded browsers. Open the page in your system browser, but note that its login session cannot be transferred automatically back into this Tabs browser profile.";

import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  Menu,
  nativeImage,
  WebContentsView,
  session as electronSession,
  shell,
  type MenuItemConstructorOptions,
  type Rectangle,
  type Session,
} from "electron";
import type { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";
import type {
  DesktopBrowserHostActivateSessionInput,
  DesktopBrowserHostControlInput,
  DesktopBrowserHostEnsureSessionInput,
  DesktopBrowserHostNavigateInput,
  DesktopBrowserHostSetBoundsInput,
  DesktopBrowserHostState,
  DesktopBrowserSessionState,
  BrowserProfileDomainInfo,
  BrowserProfileInspection,
  BrowserImportInput,
  BrowserImportResult,
  BrowserImportSource,
  BrowserPermissionRequest,
  BrowserProfilePermissionInfo,
  DesktopPreviewScreenshotArtifact,
  DesktopPreviewRecordingArtifact,
  PreviewAnnotationPayload,
  PickedElementPayload,
} from "@tabs/contracts";

const DEFAULT_BROWSER_HOST_STATE: DesktopBrowserHostState = {
  available: true,
  reason: null,
};
const DOCKED_DEVTOOLS_MODE = "bottom";

const DEFAULT_SESSION_ID = "browser";
const configuredSessions = new WeakSet<Session>();

export function normalizeBrowserProfileId(profileId: string): string {
  return normalizeProfileIdentifier(profileId);
}

export function normalizeRemoteBrowserUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Browser profiles only support HTTP and HTTPS URLs.");
  }
  return parsed.toString();
}

export {
  classifyAuthNavigation,
  sanitizeAuthUrl,
  hasSameRegistrableOrigin,
  isLoopbackHostname,
  deriveBrowserPartition,
  extractProfileIdFromPartition,
  isPersistentPartition,
  isProfilePartition,
  normalizeProfileIdentifier,
  checkWebAuthnContext,
  categorizePermission,
  PermissionMediator,
  type AuthClassificationKind,
  type AuthClassificationResult,
  type AuthNavigationRequest,
};

const AUTHENTICATION_HOST_PREFIXES = ["accounts.", "auth.", "id.", "login.", "sso."];
const AUTHENTICATION_PATH_SEGMENTS = new Set([
  "auth",
  "authorize",
  "login",
  "oauth",
  "signin",
  "sso",
]);

function normalizeAuthenticationHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./u, "");
}

export function isLikelyAuthenticationUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const hostname = parsed.hostname.toLowerCase();
  if (AUTHENTICATION_HOST_PREFIXES.some((prefix) => hostname.startsWith(prefix))) return true;

  const pathSegments = parsed.pathname.toLowerCase().split("/").filter(Boolean);
  return pathSegments.some((segment) => AUTHENTICATION_PATH_SEGMENTS.has(segment));
}

export function hasReturnedToAuthenticationOrigin(
  candidateUrl: string,
  originatingUrl: string,
): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const originating = new URL(originatingUrl);
    return (
      (candidate.protocol === "https:" || candidate.protocol === "http:") &&
      normalizeAuthenticationHostname(candidate.hostname) ===
        normalizeAuthenticationHostname(originating.hostname) &&
      !isLikelyAuthenticationUrl(candidate.toString())
    );
  } catch {
    return false;
  }
}

export function normalizeBrowserCookieDomain(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^\./u, "");
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes("..") ||
    !/^[a-z0-9.-]+$/u.test(normalized)
  ) {
    throw new Error("Invalid browser cookie domain.");
  }
  return normalized;
}

export function getCleanDesktopUserAgent(): string {
  const chromeVersion = process.versions.chrome ?? "140.0.0.0";
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
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

let activeBrowserHostManager: BrowserHostManager | null = null;

export function configurePartitionSession(s: Session): void {
  if (configuredSessions.has(s)) return;
  configuredSessions.add(s);
  try {
    // Retain native Electron User-Agent string across partition sessions.
    // Avoid making the declared identity disagree with the runtime. Provider
    // acceptance still requires real login testing; this is not a Chrome spoof.
    s.cookies.on("changed", () => {
      void s.cookies.flushStore().catch((err) => {
        console.error("[browserHostManager] Failed to persist browser cookies:", err);
      });
    });
    s.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const session = activeBrowserHostManager?.sessionForWebContentsId(webContents?.id);
      const profileId = session
        ? extractProfileIdFromPartition(session.partition) || "default"
        : "default";
      defaultPermissionMediator.handlePermissionRequest({
        webContentsId: webContents?.id,
        permission,
        requestingUrl: details?.requestingUrl,
        details,
        profileId,
        callback,
      });
    });
    s.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const session = activeBrowserHostManager?.sessionForWebContentsId(webContents?.id);
      const profileId = session
        ? extractProfileIdFromPartition(session.partition) || "default"
        : "default";
      return defaultPermissionMediator.evaluateCheck(permission, requestingOrigin, profileId);
    });
  } catch (err) {
    console.error("[browserHostManager] Failed to configure partition session:", err);
  }
}

export function sanitizeEmbeddedBrowserUserAgent(userAgent: string): string {
  return userAgent.replace(/ Electron\/[^ ]+/g, "").replace(/ [^ /]+\/[^ ]+ Chrome\//, " Chrome/");
}

export const BROWSER_CRASH_RECOVERY_WINDOW_MS = 30_000;
const BROWSER_CRASH_RECOVERY_MAX_ATTEMPTS = 3;
const BROWSER_CRASH_RECOVERY_BASE_DELAY_MS = 250;

export function planBrowserCrashRecovery(
  attempts: number,
  windowStartedAt: number | null,
  now: number,
): { attempts: number; windowStartedAt: number; delayMs: number } | null {
  const startsNewWindow =
    windowStartedAt === null || now - windowStartedAt >= BROWSER_CRASH_RECOVERY_WINDOW_MS;
  const attemptsInWindow = startsNewWindow ? 0 : attempts;
  if (attemptsInWindow >= BROWSER_CRASH_RECOVERY_MAX_ATTEMPTS) return null;
  return {
    attempts: attemptsInWindow + 1,
    windowStartedAt: startsNewWindow ? now : windowStartedAt,
    delayMs: BROWSER_CRASH_RECOVERY_BASE_DELAY_MS * 2 ** attemptsInWindow,
  };
}

import { BrowserCdpCoordinator } from "./browserCdpCoordinator";

export interface RecentlyClosedTab {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly url: string;
  readonly title: string;
  readonly profileId?: string | undefined;
  readonly closedAt: string;
}

type BrowserSession = {
  projectId: string;
  sessionId: string;
  partition: string;
  profileId?: string | undefined;
  key: string;
  view: WebContentsView;
  bounds: Rectangle | null;
  currentUrl: string | null;
  pageTitle: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  devToolsOpen: boolean;
  zoomFactor: number;
  audioMuted: boolean;
  pictureInPictureWindow: BrowserWindow | null;
  colorScheme: "system" | "light" | "dark";
  lastError: string | null;
  /** Transient error set when ERR_CONNECTION_REFUSED fires (dev server not ready yet).
   * Cleared as soon as any successful navigation or page load occurs. */
  transientError: string | null;
  certificateError: string | null;
  consoleEntries: BrowserConsoleEntry[];
  networkEntries: BrowserNetworkEntry[];
  actionTimeline: BrowserActionEvent[];
  controller: "human" | "agent" | "none";
  controlEpoch: number;
  humanControlLocked: boolean;
  verificationLease?: symbol | undefined;
  assignedTaskId: string | null;
  temporaryAgentTab: boolean;
  userRetained: boolean;
  dispatchingAgentInput: boolean;
  inputGuard?: BrowserInputGuard;
  humanControlTimer: ReturnType<typeof setTimeout> | null;
  crashRecoveryAttempts: number;
  crashRecoveryWindowStartedAt: number | null;
  crashRecoveryTimer: ReturnType<typeof setTimeout> | null;
  pendingPermission?: BrowserPermissionRequest | null;
  automationTail: Promise<void>;
  journeyRecorder?: JourneyRecorder | undefined;
  cdpCoordinator: BrowserCdpCoordinator;
};

interface BrowserConsoleEntry {
  readonly level: string;
  readonly text: string;
  readonly timestamp: string;
  readonly source?: string;
}

interface BrowserNetworkEntry {
  readonly url: string;
  readonly method: string;
  readonly status: number | null;
  readonly failed: boolean;
  readonly errorText?: string;
  readonly timestamp: string;
}

interface BrowserActionEvent {
  readonly id: string;
  readonly action: string;
  status: "running" | "succeeded" | "failed" | "interrupted" | "cancelled";
  readonly startedAt: string;
  completedAt?: string;
  error?: string;
}

const AUTOMATION_OBSERVATION_LIMIT = 200;

function appendBounded<T>(entries: T[], entry: T): void {
  entries.push(entry);
  if (entries.length > AUTOMATION_OBSERVATION_LIMIT) {
    entries.splice(0, entries.length - AUTOMATION_OBSERVATION_LIMIT);
  }
}

interface BrowserAutomationRequest {
  readonly source?: "human" | "agent";
  readonly projectId: string;
  readonly sessionId?: string;
  readonly taskId?: string | undefined;
  readonly operation: string;
  readonly input?: unknown;
}

function automationInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

function pageTargetExpression(input: Record<string, unknown>): string {
  const selector = typeof input.selector === "string" ? input.selector : null;
  const locator = typeof input.locator === "string" ? input.locator : null;
  const encodedSelector = JSON.stringify(selector);
  const encodedLocator = JSON.stringify(locator);
  return `(() => {
    const selector = ${encodedSelector};
    const locator = ${encodedLocator};
    if (selector) return document.querySelector(selector);
    if (!locator) return document.activeElement;
    if (locator.startsWith("text=")) {
      const text = locator.slice(5);
      return [...document.querySelectorAll("*")].find((element) =>
        element instanceof HTMLElement && element.innerText.trim().includes(text)
      ) ?? null;
    }
    const roleMatch = /^role=([^\\[]+)(?:\\[name=['"]?(.+?)['"]?\\])?$/.exec(locator);
    if (roleMatch) {
      const role = roleMatch[1];
      const name = roleMatch[2];
      return [...document.querySelectorAll('[role="' + CSS.escape(role) + '"], ' + role)].find(
        (element) => !name || ((element.getAttribute("aria-label") || element.textContent || "").trim() === name)
      ) ?? null;
    }
    return document.querySelector(locator);
  })()`;
}

export class BrowserHostManager {
  // Keyed by `${projectId}::${sessionId}` so each browser tab keeps its own
  // WebContentsView alive — switching tabs shows/hides instead of reloading.
  private readonly sessions = new Map<string, BrowserSession>();
  private activeKey: string | null = null;
  private readonly observedProfileSessions = new WeakSet<Session>();
  private readonly observedAutomationSessions = new WeakSet<Session>();
  private readonly recentlyClosedTabs = new Map<string, RecentlyClosedTab[]>();
  private readonly knownPartitions = new Set<string>();
  private shutdownPromise: Promise<void> | null = null;
  readonly diagnostics = new BrowserAuthDiagnostics();
  readonly comparisons: BrowserComparisonController;

  private recordPartition(partition?: string | null): void {
    if (partition) {
      this.knownPartitions.add(partition);
    }
  }

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly stackCoordinator?: NativeViewStackCoordinator,
  ) {
    activeBrowserHostManager = this;
    this.comparisons = new BrowserComparisonController({
      configure: async (projectId, sessionId, pane, sourceSessionId) => {
        const source = this.sessions.get(this.sessionKey(projectId, sourceSessionId));
        if (source) this.detachSession(source);
        const partition =
          pane.profileId === "current" && source
            ? source.partition
            : deriveBrowserPartition({ profileId: pane.profileId });
        await this.ensureSession({
          projectId,
          sessionId,
          initialUrl: pane.url,
          partition,
          profileId: pane.profileId,
        });
        const session = this.sessions.get(this.sessionKey(projectId, sessionId))!;
        session.profileId = pane.profileId;
        if (session.currentUrl !== pane.url) await this.loadUrl(session, pane.url);
        this.setBounds({ projectId, sessionId, ...pane.bounds, visible: true });
        session.view.webContents.setZoomFactor(1);
        await session.cdpCoordinator.withSession("emulation", async (debug) => {
          await debug.sendCommand("Emulation.setDeviceMetricsOverride", {
            ...pane.viewport,
            deviceScaleFactor: 1,
            mobile: false,
            scale: Math.min(
              session.bounds!.width / pane.viewport.width,
              session.bounds!.height / pane.viewport.height,
              1,
            ),
          });
        });
        if (session.bounds) {
          this.attachSession(session);
          session.view.setBounds(session.bounds);
        }
      },
      navigate: (projectId, sessionId, url) => this.navigate({ projectId, sessionId, url }),
      scroll: async (projectId, sessionId, position) => {
        const session = this.sessions.get(this.sessionKey(projectId, sessionId));
        if (!session) throw new Error("Comparison closed.");
        return session.view.webContents.executeJavaScript(`(() => {
          const root = document.scrollingElement || document.documentElement;
          const width = Math.max(0, root.scrollWidth - innerWidth), height = Math.max(0, root.scrollHeight - innerHeight);
          const position = ${JSON.stringify(position ?? null)};
          if (position) window.scrollTo({ left: position.x * width, top: position.y * height, behavior: 'instant' });
          return { x: width ? scrollX / width : 0, y: height ? scrollY / height : 0 };
        })()`);
      },
      capture: (projectId, sessionId) => this.captureScreenshot({ projectId, sessionId }),
      destroy: (projectId, sessionId) => {
        const session = this.sessions.get(this.sessionKey(projectId, sessionId));
        if (session) this.detachSession(session);
        this.destroySession({ projectId, sessionId }, false);
      },
      restore: async (projectId, sessionId) => {
        if (this.activeKey && this.activeKey !== this.sessionKey(projectId, sessionId)) return;
        await this.activateSession({ projectId, sessionId });
      },
    });
    defaultPermissionMediator.setPromptHandler((request) => {
      for (const session of this.sessions.values()) {
        const profileId = extractProfileIdFromPartition(session.partition) || "default";
        if (profileId === request.profileId) {
          session.pendingPermission = request;
          this.emitState(session);
          break;
        }
      }
    });
  }

  getAuthDiagnostics(): readonly AuthDiagnosticEntry[] {
    return this.diagnostics.getEntries();
  }

  getAuthDiagnosticsSummary(): string {
    return this.diagnostics.formatBugReportSummary();
  }

  private sessionKey(projectId: string, sessionId?: string): string {
    return `${projectId}::${sessionId ?? DEFAULT_SESSION_ID}`;
  }

  getState(): DesktopBrowserHostState {
    return DEFAULT_BROWSER_HOST_STATE;
  }

  getSessionState(projectId: string, sessionId?: string): DesktopBrowserSessionState {
    const session = this.sessions.get(this.sessionKey(projectId, sessionId));
    if (!session) {
      return {
        projectId,
        sessionId: sessionId ?? DEFAULT_SESSION_ID,
        currentUrl: null,
        pageTitle: null,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        devToolsOpen: false,
        zoomFactor: 1,
        audioMuted: false,
        pictureInPicture: false,
        colorScheme: "system",
        lastError: null,
        transientError: null,
      };
    }

    return this.snapshotSession(session);
  }

  async ensureSession(input: DesktopBrowserHostEnsureSessionInput): Promise<void> {
    const key = this.sessionKey(input.projectId, input.sessionId);
    const partition = input.partition ?? `persist:tabs-browser:${input.projectId}`;
    const existing = this.sessions.get(key);
    if (existing) {
      if (input.taskId) {
        if (existing.assignedTaskId && existing.assignedTaskId !== input.taskId)
          throw new Error("Browser tab belongs to another task.");
        if (!existing.assignedTaskId) {
          existing.assignedTaskId = input.taskId;
          existing.controlEpoch++;
          this.emitState(existing);
        }
      }
      // If the session's partition was updated in settings, recreate the session.
      if (existing.partition !== partition) {
        await this.recreateSession(input.projectId, input.sessionId, partition);
        return;
      }
      // Keep the tab alive across switches/re-mounts: do NOT re-navigate here
      // (that caused the reload-on-switch). Only load if it has nothing yet.
      if (!existing.currentUrl && input.initialUrl) {
        await this.loadUrl(existing, input.initialUrl);
      }
      return;
    }

    const sessionId = input.sessionId ?? DEFAULT_SESSION_ID;
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        partition,
      },
    });
    this.recordPartition(partition);
    configurePartitionSession(view.webContents.session);
    this.observeProfileSession(partition, view.webContents.session);
    view.setBackgroundColor("#111111");

    const initialZoom = this.getWindow()?.webContents?.getZoomFactor() ?? 1.0;
    view.webContents?.setZoomFactor(initialZoom);

    const session: BrowserSession = {
      projectId: input.projectId,
      sessionId,
      partition,
      profileId: input.profileId,
      key,
      view,
      bounds: null,
      currentUrl: null,
      pageTitle: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: view.webContents.isDevToolsOpened(),
      zoomFactor: 1,
      audioMuted: false,
      pictureInPictureWindow: null,
      colorScheme: "system",
      lastError: null,
      transientError: null,
      certificateError: null,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
      controller: "none",
      controlEpoch: 0,
      humanControlLocked: false,
      assignedTaskId: input.taskId ?? null,
      temporaryAgentTab: Boolean(input.temporaryAgentTab),
      userRetained: false,
      dispatchingAgentInput: false,
      humanControlTimer: null,
      crashRecoveryAttempts: 0,
      crashRecoveryWindowStartedAt: null,
      crashRecoveryTimer: null,
      pendingPermission: null,
      automationTail: Promise.resolve(),
      cdpCoordinator: new BrowserCdpCoordinator(view.webContents),
    };

    this.sessions.set(key, session);
    this.registerSessionEvents(session);
    this.observeAutomationNetwork(view.webContents.session);
    if (input.initialUrl) {
      await this.loadUrl(session, input.initialUrl);
    } else {
      await view.webContents.loadURL("about:blank");
    }
    await this.applyColorScheme(session);
  }

  async activateSession(input: DesktopBrowserHostActivateSessionInput): Promise<void> {
    const key = this.sessionKey(input.projectId, input.sessionId);
    const session = this.sessions.get(key);
    const window = this.getWindow();
    if (!session || !window) {
      return;
    }

    const current = this.activeKey ? this.sessions.get(this.activeKey) : null;
    if (current && current.key !== session.key) {
      this.detachSession(current);
    }

    this.activeKey = key;
    if (session.bounds) {
      this.attachSession(session);
      session.view.setBounds(session.bounds);
    }
  }

  async recreateSession(
    projectId: string,
    sessionId?: string,
    partitionInput?: string,
  ): Promise<void> {
    const key = this.sessionKey(projectId, sessionId);
    const session = this.sessions.get(key);
    if (!session) return;

    this.closePictureInPicture({ projectId, sessionId });

    const currentUrl = session.currentUrl;
    const partition = partitionInput ?? session.partition ?? `persist:tabs-browser:${projectId}`;

    session.controlEpoch = (session.controlEpoch ?? 0) + 1;
    this.clearCrashRecoveryTimer(session);
    this.clearHumanControlTimer(session);
    this.detachSession(session);
    defaultPermissionMediator.cancelPendingRequestsForWebContents(session.view.webContents.id);
    session.pendingPermission = null;
    await session.journeyRecorder?.stop();
    session.journeyRecorder = undefined;
    session.cdpCoordinator?.detach();
    session.view.webContents.close({ waitForBeforeUnload: false });

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        partition,
      },
    });
    this.recordPartition(partition);
    configurePartitionSession(view.webContents.session);
    this.observeProfileSession(partition, view.webContents.session);
    view.setBackgroundColor("#111111");

    const initialZoom = this.getWindow()?.webContents?.getZoomFactor() ?? 1.0;
    view.webContents?.setZoomFactor(initialZoom * session.zoomFactor);
    view.webContents.setAudioMuted(session.audioMuted);

    session.view = view;
    session.partition = partition;
    session.cdpCoordinator = new BrowserCdpCoordinator(view.webContents);
    session.lastError = null;
    session.transientError = null;
    this.registerSessionEvents(session);
    this.observeAutomationNetwork(view.webContents.session);

    if (this.activeKey === key && session.bounds) {
      this.attachSession(session);
      session.view.setBounds(session.bounds);
    }

    if (currentUrl) {
      await this.loadUrl(session, currentUrl);
    } else {
      await view.webContents.loadURL("about:blank");
    }
    await this.applyColorScheme(session);
  }

  async clearProfileData(profileId: string): Promise<void> {
    const trimmed = normalizeBrowserProfileId(profileId);
    const partition = deriveBrowserPartition({ profileId: trimmed });
    const s = electronSession.fromPartition(partition);
    this.observeProfileSession(partition, s);
    this.recordPartition(partition);
    await s.closeAllConnections();
    await s.clearData({
      dataTypes: [
        "cache",
        "cookies",
        "fileSystems",
        "indexedDB",
        "localStorage",
        "serviceWorkers",
        "webSQL",
      ],
    });
    s.flushStorageData();
    await s.cookies.flushStore();
    for (const session of this.sessions.values()) {
      if (session.partition === partition && session.currentUrl) {
        await this.loadUrl(session, session.currentUrl);
      }
    }
  }

  async clearSessionData(projectId: string, sessionId?: string): Promise<void> {
    const browserSession = this.sessions.get(this.sessionKey(projectId, sessionId));
    if (!browserSession) {
      throw new Error("Browser session is not available.");
    }
    this.recordPartition(browserSession.partition);
    const storageSession = browserSession.view.webContents.session;
    await storageSession.closeAllConnections();
    await storageSession.clearData({
      dataTypes: [
        "cache",
        "cookies",
        "fileSystems",
        "indexedDB",
        "localStorage",
        "serviceWorkers",
        "webSQL",
      ],
    });
    storageSession.flushStorageData();
    await storageSession.cookies.flushStore();
    if (browserSession.currentUrl) {
      await this.loadUrl(browserSession, browserSession.currentUrl);
    }
  }

  async inspectProfile(profileId: string): Promise<BrowserProfileInspection> {
    const trimmed = normalizeBrowserProfileId(profileId);
    const partition = deriveBrowserPartition({ profileId: trimmed });
    const s = electronSession.fromPartition(partition);
    this.recordPartition(partition);
    this.observeProfileSession(partition, s);

    const isPersistent =
      typeof (s as any).isPersistent === "function"
        ? Boolean((s as any).isPersistent())
        : partition.startsWith("persist:");
    const storagePath =
      typeof (s as any).getStoragePath === "function" ? (s as any).getStoragePath() : null;

    const cookies = await s.cookies.get({});
    const map = new Map<string, { count: number; hasSessionHint: boolean }>();

    const AUTH_COOKIE_NAMES = [
      "sid",
      "hsid",
      "ssid",
      "apisid",
      "sapisid",
      "osid",
      "user_session",
      "logged_in",
      "dotcom_user",
      "__secure-next-auth.session-token",
      "auth_token",
      "figma.session",
      "figma.login",
      "linear_session",
      "token_v2",
      "jwt",
      "sessionid",
    ];

    let totalCookies = 0;
    for (const cookie of cookies) {
      totalCookies += 1;
      let domain = cookie.domain || "";
      if (domain.startsWith(".")) domain = domain.slice(1);
      if (!domain) continue;

      const existing = map.get(domain) ?? { count: 0, hasSessionHint: false };
      existing.count += 1;

      const cName = cookie.name.toLowerCase();
      const hasSessionHint =
        AUTH_COOKIE_NAMES.some((name) => cName === name || cName.includes(name)) ||
        cName.includes("session") ||
        cName.includes("token") ||
        cName.includes("auth");

      if (hasSessionHint) {
        existing.hasSessionHint = true;
      }
      map.set(domain, existing);
    }

    const domains = Array.from(map.entries())
      .map(([domain, data]) => ({
        domain,
        cookieCount: data.count,
        hasSessionHint: data.hasSessionHint,
      }))
      .toSorted((a, b) => {
        if (a.hasSessionHint && !b.hasSessionHint) return -1;
        if (!a.hasSessionHint && b.hasSessionHint) return 1;
        return a.domain.localeCompare(b.domain);
      });

    return {
      profileId: trimmed,
      partition,
      isPersistent,
      storagePath,
      totalDomains: domains.length,
      totalCookies,
      domains,
      inspectedAt: Date.now(),
    };
  }

  async getProfileDomains(profileId: string): Promise<BrowserProfileDomainInfo[]> {
    const inspection = await this.inspectProfile(profileId);
    return inspection.domains;
  }

  async clearProfileDomain(profileId: string, domainToClear: string): Promise<void> {
    const trimmed = normalizeBrowserProfileId(profileId);
    const domain = normalizeBrowserCookieDomain(domainToClear);
    const partition = deriveBrowserPartition({ profileId: trimmed });
    const s = electronSession.fromPartition(partition);
    this.observeProfileSession(partition, s);
    try {
      const cookies = await s.cookies.get({});
      for (const cookie of cookies) {
        const cDomain = (cookie.domain || "").replace(/^\./, "").toLowerCase();
        if (cDomain === domain || cDomain.endsWith("." + domain)) {
          const protocol = cookie.secure ? "https:" : "http:";
          const url = `${protocol}//${cDomain}${cookie.path || "/"}`;
          await s.cookies.remove(url, cookie.name);
        }
      }
      await s.closeAllConnections();
      await s.clearData({
        origins: [`https://${domain}`, `http://${domain}`],
        dataTypes: [
          "cookies",
          "fileSystems",
          "indexedDB",
          "localStorage",
          "serviceWorkers",
          "webSQL",
        ],
        originMatchingMode: "third-parties-included",
      });
      s.flushStorageData();
      await s.cookies.flushStore();
      for (const session of this.sessions.values()) {
        if (
          session.partition === partition &&
          session.currentUrl &&
          session.currentUrl.includes(domain)
        ) {
          await this.loadUrl(session, session.currentUrl);
        }
      }
    } catch (err) {
      console.error("[browserHostManager] Failed to clear profile domain:", err);
    }
  }

  async openProfileLoginWindow(profileId: string, targetUrl?: string): Promise<void> {
    const trimmed = normalizeBrowserProfileId(profileId);
    const partition = deriveBrowserPartition({ profileId: trimmed });
    this.recordPartition(partition);
    await this.openLoginWindow(
      partition,
      trimmed,
      targetUrl?.trim() || "https://accounts.google.com",
    );
  }

  async listBrowserImportSources(): Promise<BrowserImportSource[]> {
    const importer = new BrowserSessionImporter();
    return await importer.listSources();
  }

  private readonly browserImports = new Map<string, AbortController>();

  cancelBrowserImport(requestId: string): void {
    this.browserImports.get(requestId)?.abort();
  }

  async importBrowserCookies(input: BrowserImportInput): Promise<BrowserImportResult> {
    const importer = new BrowserSessionImporter();
    const requestId = input.requestId ?? crypto.randomUUID();
    if (this.browserImports.has(requestId)) throw new Error("This import is already running.");
    const controller = new AbortController();
    this.browserImports.set(requestId, controller);
    let result: BrowserImportResult;
    try {
      result = await importer.importSelectedCookies(input, undefined, controller.signal);
    } finally {
      this.browserImports.delete(requestId);
    }
    const trimmed = normalizeBrowserProfileId(input.targetProfileId);
    const partition = `persist:tabs-browser:profile:${trimmed}`;
    const s = electronSession.fromPartition(partition);
    this.observeProfileSession(partition, s);
    return result;
  }

  respondPermission(requestId: string, granted: boolean, remember: boolean = true): void {
    defaultPermissionMediator.respondDecision(requestId, granted, remember);
    for (const session of this.sessions.values()) {
      if (session.pendingPermission?.requestId === requestId) {
        session.pendingPermission = null;
        this.emitState(session);
      }
    }
  }

  getProfilePermissions(profileId: string): BrowserProfilePermissionInfo[] {
    const trimmed = normalizeBrowserProfileId(profileId);
    return defaultPermissionMediator.listDecisions(trimmed);
  }

  revokeProfilePermission(profileId: string, origin: string, permission: string): void {
    const trimmed = normalizeBrowserProfileId(profileId);
    defaultPermissionMediator.revokeDecision(trimmed, origin, permission);
  }

  private async openLoginWindow(
    partition: string,
    label: string,
    targetUrl: string,
    completionOriginUrl?: string,
  ): Promise<AuthWindowResult> {
    const url = normalizeRemoteBrowserUrl(targetUrl);

    const s = electronSession.fromPartition(partition);
    this.observeProfileSession(partition, s);
    configurePartitionSession(s);

    return await openHardenedAuthWindow({
      partition,
      label,
      targetUrl: url,
      completionOriginUrl,
    });
  }

  hideActiveSession(): void {
    if (!this.activeKey) return;
    const session = this.sessions.get(this.activeKey);
    if (session) {
      this.detachSession(session);
    }
    this.activeKey = null;
  }

  setBounds(input: DesktopBrowserHostSetBoundsInput): void {
    const key = this.sessionKey(input.projectId, input.sessionId);
    const session = this.sessions.get(key);
    if (!session) {
      return;
    }

    if (!input.visible || input.width <= 0 || input.height <= 0) {
      session.bounds = null;
      if (this.activeKey === key) {
        this.detachSession(session);
      }
      return;
    }

    const mainWindow = this.getWindow();
    const zoomFactor = mainWindow?.webContents?.getZoomFactor() ?? 1.0;

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
      const currentZoom = session.view.webContents?.getZoomFactor() ?? 1.0;
      const effectiveZoom = zoomFactor * session.zoomFactor;
      if (Math.abs(currentZoom - effectiveZoom) > 0.001) {
        session.view.webContents?.setZoomFactor(effectiveZoom);
      }
    }

    if (this.activeKey === key) {
      this.attachSession(session);
      session.view.setBounds(session.bounds);
    }
  }

  async navigate(input: DesktopBrowserHostNavigateInput): Promise<void> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    if (session.verificationLease) session.controlEpoch++;
    await this.loadUrl(session, input.url);
  }

  async reload(input: DesktopBrowserHostControlInput & { ignoreCache?: boolean }): Promise<void> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    if (session.verificationLease) session.controlEpoch++;
    session.lastError = null;
    this.emitState(session);
    if (input.ignoreCache) {
      session.view.webContents.reloadIgnoringCache();
    } else {
      session.view.webContents.reload();
    }
  }

  async goBack(input: DesktopBrowserHostControlInput): Promise<void> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || !session.view.webContents.canGoBack()) return;
    if (session.verificationLease) session.controlEpoch++;
    session.lastError = null;
    this.emitState(session);
    session.view.webContents.goBack();
  }

  setZoomFactor(input: DesktopBrowserHostControlInput & { zoomFactor: number }): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    const requested = Number.isFinite(input.zoomFactor) ? input.zoomFactor : 1;
    session.zoomFactor = Math.min(2, Math.max(0.5, Math.round(requested * 10) / 10));
    const windowZoom = this.getWindow()?.webContents?.getZoomFactor() ?? 1;
    session.view.webContents.setZoomFactor(windowZoom * session.zoomFactor);
    this.emitState(session);
  }

  setAudioMuted(input: DesktopBrowserHostControlInput & { audioMuted: boolean }): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    session.audioMuted = input.audioMuted;
    session.view.webContents.setAudioMuted(input.audioMuted);
    this.emitState(session);
  }

  async setColorScheme(
    input: DesktopBrowserHostControlInput & { colorScheme: "system" | "light" | "dark" },
  ): Promise<void> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    session.colorScheme = input.colorScheme;
    await this.applyColorScheme(session);
    this.emitState(session);
  }

  openPictureInPicture(input: DesktopBrowserHostControlInput): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || session.view.webContents.isDestroyed()) return;
    const existing = session.pictureInPictureWindow;
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }

    this.detachSession(session);
    const pictureWindow = new BrowserWindow({
      width: 640,
      height: 420,
      minWidth: 320,
      minHeight: 240,
      title: session.pageTitle || "Browser preview",
      autoHideMenuBar: true,
      alwaysOnTop: true,
      backgroundColor: "#111111",
      show: false,
    });
    session.pictureInPictureWindow = pictureWindow;

    const layout = () => {
      if (pictureWindow.isDestroyed()) return;
      const [width = 640, height = 420] = pictureWindow.getContentSize();
      session.view.setBounds({ x: 0, y: 0, width, height });
    };
    pictureWindow.contentView.addChildView(session.view);
    layout();
    pictureWindow.on("resize", layout);
    pictureWindow.once("ready-to-show", () => pictureWindow.show());
    pictureWindow.once("closed", () => {
      if (session.pictureInPictureWindow !== pictureWindow) return;
      session.pictureInPictureWindow = null;
      if (this.activeKey === session.key && session.bounds) {
        this.attachSession(session);
        session.view.setBounds(session.bounds);
      }
      this.emitState(session);
    });
    this.emitState(session);
  }

  closePictureInPicture(input: DesktopBrowserHostControlInput): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    const pictureWindow = session?.pictureInPictureWindow;
    if (!session || !pictureWindow) return;
    if (!pictureWindow.isDestroyed()) {
      if (pictureWindow.contentView.children.includes(session.view)) {
        pictureWindow.contentView.removeChildView(session.view);
      }
      pictureWindow.close();
    }
    if (session.pictureInPictureWindow === pictureWindow) {
      session.pictureInPictureWindow = null;
      if (this.activeKey === session.key && session.bounds) {
        this.attachSession(session);
        session.view.setBounds(session.bounds);
      }
      this.emitState(session);
    }
  }

  async goForward(input: DesktopBrowserHostControlInput): Promise<void> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || !session.view.webContents.canGoForward()) return;
    if (session.verificationLease) session.controlEpoch++;
    session.lastError = null;
    this.emitState(session);
    session.view.webContents.goForward();
  }

  async toggleDevTools(input: DesktopBrowserHostControlInput): Promise<void> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    if (session.view.webContents.isDevToolsOpened()) {
      session.view.webContents.closeDevTools();
    } else {
      session.cdpCoordinator.prepareForDevTools();
      session.view.webContents.openDevTools({ mode: DOCKED_DEVTOOLS_MODE, activate: false });
    }
  }

  async runAutomation(request: BrowserAutomationRequest, lease?: symbol): Promise<unknown> {
    const session = this.sessions.get(this.sessionKey(request.projectId, request.sessionId));
    if (!session) throw new Error("The requested browser session was not found.");
    const contents = session.view.webContents;
    if (contents.isDestroyed()) throw new Error("The requested browser session is unavailable.");
    if (request.source === "agent") {
      if (!request.taskId) throw new Error("Agent browser operations require a task identity.");
      if (!session.assignedTaskId) {
        session.assignedTaskId = request.taskId;
        session.controlEpoch++;
        this.emitState(session);
      }
    }
    if (request.source === "human")
      request = { ...request, taskId: session.assignedTaskId ?? undefined };
    const input = automationInput(request.input);
    if (
      request.source !== "human" &&
      session.assignedTaskId &&
      request.taskId !== session.assignedTaskId
    ) {
      throw new Error(
        `Browser tab is assigned to task "${session.assignedTaskId}"; the matching task identity is required.`,
      );
    }
    if (request.operation === "cancelVerification" && request.source === "human") {
      this.takeControl(request);
      return { cancelled: true };
    }
    if (session.verificationLease && lease !== session.verificationLease) {
      throw new Error(
        "A verification already owns this tab. Cancel it before starting another operation.",
      );
    }
    if (request.operation === "verify") {
      if (session.journeyRecorder?.status().recording)
        throw new Error("Stop recording before verification.");
      const token = Symbol("verification");
      session.verificationLease = token;
      const epoch = session.controlEpoch;
      const taskId = session.assignedTaskId;
      if (request.source === "human") {
        session.humanControlLocked = false;
        session.controller = "none";
        this.clearHumanControlTimer(session);
      }
      const checkControl = () => {
        if (
          this.sessions.get(session.key) !== session ||
          session.view.webContents !== contents ||
          contents.isDestroyed() ||
          session.controlEpoch !== epoch ||
          session.assignedTaskId !== taskId ||
          session.controller === "human"
        )
          throw new Error("Verification interrupted by control or session changes.");
      };
      const execute = async (operation: string, input: unknown) => {
        checkControl();
        const result = await this.runAutomation({ ...request, operation, input }, token);
        checkControl();
        return result;
      };
      try {
        return await this.withAutomationSurface(session, async () => {
          const result = await runBrowserReproduction(
            {
              checkControl,
              navigate: async (url) => {
                await execute("navigate", { url });
              },
              evaluate: (expression) => execute("evaluate", { expression }),
              click: async (selector) => {
                await execute("click", { selector });
              },
              fill: async (selector, text) => {
                await execute("type", { selector, text, clear: true });
              },
              press: async (key) => {
                await execute("press", { key });
              },
            },
            typeof input.url === "string" ? input.url : "",
            input.steps as BrowserReproductionStep[],
            process.env,
          );
          if (result.status === "pass") {
            checkControl();
            const artifact = await this.captureScreenshot(request);
            checkControl();
            return { ...result, afterScreenshotPath: artifact.path };
          }
          return result;
        });
      } finally {
        if (session.verificationLease === token) session.verificationLease = undefined;
      }
    }
    if (request.operation === "navigate") {
      if (typeof input.url !== "string") throw new Error("Navigation URL is required.");
      return this.trackAutomation(
        session,
        "navigate",
        () => this.loadUrl(session, input.url as string, true),
        request.source === "human" ? (session.assignedTaskId ?? undefined) : request.taskId,
      );
    }
    if (request.operation === "recordStart") {
      session.journeyRecorder ??= new JourneyRecorder(contents, session.cdpCoordinator);
      if (request.source === "human") {
        await session.journeyRecorder.start();
        return session.journeyRecorder.status();
      }
      await this.trackAutomation(
        session,
        "recordStart",
        () => session.journeyRecorder!.start(),
        request.taskId,
      );
      return session.journeyRecorder.status();
    }
    if (request.operation === "recordStatus")
      return session.journeyRecorder?.status() ?? { recording: false, count: 0 };
    if (request.operation === "recordStop") {
      if (!session.journeyRecorder) throw new Error("No recorded journey is available");
      if (request.source === "human") return session.journeyRecorder.stop();
      return this.trackAutomation(
        session,
        "recordStop",
        () => session.journeyRecorder!.stop(),
        request.taskId,
      );
    }

    if (request.operation === "assertControl") {
      if (
        session.controller === "human" ||
        (typeof input.controlEpoch === "number" && input.controlEpoch !== session.controlEpoch)
      )
        throw new Error("Browser control was interrupted.");
      return { controlEpoch: session.controlEpoch };
    }

    if (request.operation === "status") {
      return {
        available: true,
        visible: this.activeKey === session.key && session.bounds !== null,
        tabId: session.sessionId,
        url: session.currentUrl,
        title: session.pageTitle,
        loading: session.loading,
        viewport: session.bounds
          ? { width: session.bounds.width, height: session.bounds.height }
          : undefined,
      };
    }

    if (request.operation === "evaluate") {
      if (typeof input.expression !== "string" || input.expression.trim().length === 0) {
        throw new Error("A JavaScript expression is required.");
      }
      return this.trackAutomation(
        session,
        "evaluate",
        () => contents.executeJavaScript(input.expression as string, true),
        request.taskId,
      );
    }

    if (request.operation === "snapshot") {
      return this.trackAutomation(
        session,
        "snapshot",
        async () => {
          const page = await contents.executeJavaScript(
            `(() => ({
          visibleText: (document.body?.innerText || "").slice(0, 20000),
          interactiveElements: [...document.querySelectorAll(
            'a[href],button,input,select,textarea,[role="button"],[role="link"],[tabindex]'
          )].slice(0, 200).map((element, index) => {
            const rect = element.getBoundingClientRect();
            const html = element;
            return {
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute("role"),
              name: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 500),
              selector: element.id ? "#" + CSS.escape(element.id) : element.tagName.toLowerCase() + ":nth-of-type(" + (index + 1) + ")",
              x: rect.x, y: rect.y, width: rect.width, height: rect.height
            };
          })
        }))()`,
            true,
          );
          let accessibilityTree: unknown = null;
          try {
            accessibilityTree = await session.cdpCoordinator.withSession(
              "automation",
              async (debuggerApi) => {
                return await debuggerApi.sendCommand("Accessibility.getFullAXTree");
              },
            );
          } catch {
            accessibilityTree = null;
          }
          const image = nativeImage.createFromBuffer(await this.captureSessionImage(session));
          const size = image.getSize();
          return {
            url: contents.getURL(),
            title: contents.getTitle(),
            loading: session.loading,
            visibleText: page.visibleText,
            interactiveElements: page.interactiveElements,
            accessibilityTree,
            consoleEntries: [...(session.consoleEntries ?? [])],
            networkEntries: [...(session.networkEntries ?? [])],
            actionTimeline: [...(session.actionTimeline ?? [])],
            screenshot: {
              mimeType: "image/png",
              data: image.toPNG().toString("base64"),
              width: size.width,
              height: size.height,
            },
          };
        },
        request.taskId,
      );
    }

    if (request.operation === "press") {
      if (typeof input.key !== "string" || input.key.length === 0) {
        throw new Error("A key is required.");
      }
      const modifierMap = {
        Alt: "alt",
        Control: "control",
        Meta: "meta",
        Shift: "shift",
      } as const;
      const modifiers = Array.isArray(input.modifiers)
        ? input.modifiers.flatMap((value) =>
            typeof value === "string" && value in modifierMap
              ? [modifierMap[value as keyof typeof modifierMap]]
              : [],
          )
        : [];
      return this.trackAutomation(
        session,
        "press",
        async () => {
          const epoch = session.controlEpoch;
          if (session.cdpCoordinator) {
            const parts = (input.key as string).split("+");
            const key = parts.pop()!;
            const mask: Record<string, number> = { alt: 1, control: 2, meta: 4, shift: 8 };
            const modifierBits = [...modifiers, ...parts.map((part) => part.toLowerCase())].reduce(
              (value, part) => value | (mask[part] ?? 0),
              0,
            );
            const codes: Record<string, number> = {
              Enter: 13,
              Tab: 9,
              Escape: 27,
              Backspace: 8,
              Delete: 46,
              ArrowLeft: 37,
              ArrowUp: 38,
              ArrowRight: 39,
              ArrowDown: 40,
              Home: 36,
              End: 35,
              PageUp: 33,
              PageDown: 34,
              Space: 32,
            };
            const code =
              codes[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined);
            if (code === undefined) throw new Error("Unsupported keyboard key.");
            await session.cdpCoordinator.withSession("automation", async (debug) => {
              const args = {
                key: key === "Space" ? " " : key,
                windowsVirtualKeyCode: code,
                modifiers: modifierBits,
              };
              session.inputGuard ??= new BrowserInputGuard();
              await debug.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
              try {
                for (const type of ["keyDown", "keyUp"]) {
                  if (session.controlEpoch !== epoch)
                    throw new Error("Keyboard action interrupted by human control.");
                  const release = session.inputGuard.expect({ type, key: args.key });
                  try {
                    await debug.sendCommand("Input.dispatchKeyEvent", {
                      ...args,
                      type,
                      ...(type === "keyDown"
                        ? key === "Enter"
                          ? { text: "\r" }
                          : key.length === 1 && modifierBits === 0
                            ? { text: key }
                            : {}
                        : {}),
                    });
                  } finally {
                    release();
                  }
                }
              } finally {
                await debug.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false });
              }
            });
          } else {
            session.dispatchingAgentInput = true;
            try {
              contents.sendInputEvent({ type: "keyDown", keyCode: input.key as string, modifiers });
              contents.sendInputEvent({ type: "keyUp", keyCode: input.key as string, modifiers });
            } finally {
              session.dispatchingAgentInput = false;
            }
          }
          return { pressed: true };
        },
        request.taskId,
      );
    }

    if (request.operation === "click") {
      return this.trackAutomation(
        session,
        "click",
        async () => {
          const epoch = session.controlEpoch;
          let point: { x: number; y: number };
          if (typeof input.x === "number" && typeof input.y === "number") {
            point = { x: input.x, y: input.y };
          } else {
            const target = pageTargetExpression(input);
            const resolved = (await contents.executeJavaScript(
              `(() => { const element = ${target}; if (!(element instanceof HTMLElement)) return null; element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); const rect = element.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); if (hit && hit !== element && !element.contains(hit)) return null; return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }; })()`,
              true,
            )) as { x: number; y: number } | null;
            if (!resolved) throw new Error("The browser click target was not found.");
            point = resolved;
          }
          await contents.executeJavaScript(
            `(() => {
              document.querySelector('[data-tabs-agent-pointer]')?.remove();
              const pointer = document.createElement('div');
              pointer.setAttribute('data-tabs-agent-pointer', '');
              Object.assign(pointer.style, {
                position: 'fixed', left: '${point.x}px', top: '${point.y}px', width: '18px', height: '18px',
                transform: 'translate(-50%, -50%)', borderRadius: '999px', pointerEvents: 'none',
                zIndex: '2147483647', background: 'rgba(124,58,237,.3)', border: '2px solid #7c3aed',
                boxShadow: '0 0 0 5px rgba(124,58,237,.12)', transition: 'opacity 180ms ease'
              });
              document.documentElement.append(pointer);
              setTimeout(() => { pointer.style.opacity = '0'; setTimeout(() => pointer.remove(), 200); }, 500);
            })()`,
            true,
          );
          if (session.cdpCoordinator) {
            await session.cdpCoordinator.withSession("automation", async (debug) => {
              session.inputGuard ??= new BrowserInputGuard();
              await debug.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
              try {
                for (const [type, nativeType] of [
                  ["mousePressed", "mouseDown"],
                  ["mouseReleased", "mouseUp"],
                ]) {
                  if (session.controlEpoch !== epoch)
                    throw new Error("Click interrupted by human control.");
                  const release = session.inputGuard.expect({
                    type: nativeType!,
                    ...point,
                    zoom: contents.getZoomFactor(),
                  });
                  try {
                    await debug.sendCommand("Input.dispatchMouseEvent", {
                      type,
                      ...point,
                      button: "left",
                      clickCount: 1,
                    });
                  } finally {
                    release();
                  }
                }
              } finally {
                await debug.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false });
              }
            });
          } else {
            session.dispatchingAgentInput = true;
            try {
              contents.sendInputEvent({
                type: "mouseMove",
                x: point.x,
                y: point.y,
              });
              contents.sendInputEvent({
                type: "mouseDown",
                x: point.x,
                y: point.y,
                button: "left",
                clickCount: 1,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x: point.x,
                y: point.y,
                button: "left",
                clickCount: 1,
              });
            } finally {
              session.dispatchingAgentInput = false;
            }
          }
          return { clicked: true };
        },
        request.taskId,
      );
    }

    if (request.operation === "type") {
      if (typeof input.text !== "string") throw new Error("Text is required.");
      const target = pageTargetExpression(input);
      const encodedText = JSON.stringify(input.text);
      const clear = input.clear === true;
      return this.trackAutomation(
        session,
        "type",
        async () => {
          const typed = await contents.executeJavaScript(
            `(() => {
            const element = ${target};
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement && element.isContentEditable)) return false;
            element.focus();
            if (${clear}) {
              if ("value" in element) element.value = "";
              else element.textContent = "";
            }
            if ("value" in element) element.value += ${encodedText};
            else element.textContent = (element.textContent || "") + ${encodedText};
            element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${encodedText} }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          })()`,
            true,
          );
          if (!typed) throw new Error("The browser type target is not editable.");
          return { typed: true };
        },
        request.taskId,
      );
    }

    if (request.operation === "scroll") {
      const target = pageTargetExpression(input);
      const deltaX = typeof input.deltaX === "number" ? input.deltaX : 0;
      const deltaY = typeof input.deltaY === "number" ? input.deltaY : 0;
      return this.trackAutomation(
        session,
        "scroll",
        async () => {
          await contents.executeJavaScript(
            `(() => { const target = ${target}; (target || window).scrollBy(${deltaX}, ${deltaY}); })()`,
            true,
          );
          return { scrolled: true };
        },
        request.taskId,
      );
    }

    if (request.operation === "waitFor") {
      const timeoutMs =
        typeof input.timeoutMs === "number"
          ? Math.min(60_000, Math.max(1, input.timeoutMs))
          : 15_000;
      const deadline = Date.now() + timeoutMs;
      return this.trackAutomation(
        session,
        "waitFor",
        async () => {
          while (Date.now() <= deadline) {
            const target = pageTargetExpression(input);
            const text = typeof input.text === "string" ? JSON.stringify(input.text) : "null";
            const url =
              typeof input.urlIncludes === "string" ? JSON.stringify(input.urlIncludes) : "null";
            const matched = await contents.executeJavaScript(
              `(() => {
              const target = ${target};
              const text = ${text};
              const url = ${url};
              return (!${Boolean(input.selector || input.locator)} || Boolean(target))
                && (!text || (document.body?.innerText || "").includes(text))
                && (!url || location.href.includes(url));
            })()`,
              true,
            );
            if (matched) return { matched: true };
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(`Browser wait timed out after ${timeoutMs}ms.`);
        },
        request.taskId,
      );
    }

    throw new Error(`Unsupported browser automation operation: ${request.operation}`);
  }

  private async captureSessionImage(session: BrowserSession): Promise<Buffer> {
    let data: Buffer;
    if (session.cdpCoordinator && !session.view.webContents.isDevToolsOpened()) {
      const capture = await session.cdpCoordinator.withSession("automation", (debug) =>
        debug.sendCommand("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          fromSurface: true,
        }),
      );
      data = Buffer.from(capture.data, "base64");
    } else {
      const image = await session.view.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
      data = image.toPNG();
    }
    if (data.byteLength === 0) throw new Error("The browser did not produce a screenshot.");
    return data;
  }

  async captureScreenshot(
    input: DesktopBrowserHostControlInput,
  ): Promise<DesktopPreviewScreenshotArtifact> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || session.view.webContents.isDestroyed()) {
      throw new Error("The requested browser session is unavailable.");
    }
    const data = await this.captureSessionImage(session);
    const createdAt = new Date().toISOString();
    const id = `browser-screenshot-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const artifactDirectory = this.artifactDirectory();
    const artifactPath = Path.join(artifactDirectory, `${id}.png`);
    await FS.mkdir(artifactDirectory, { recursive: true });
    await FS.writeFile(artifactPath, data, { flag: "wx" });
    return {
      id,
      tabId: session.sessionId,
      path: artifactPath,
      mimeType: "image/png",
      sizeBytes: data.byteLength,
      createdAt,
    };
  }

  getMediaSourceId(input: DesktopBrowserHostControlInput): string {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || session.view.webContents.isDestroyed()) {
      throw new Error("The requested browser session is unavailable.");
    }
    const requestContents = this.getWindow()?.webContents;
    if (!requestContents) throw new Error("The browser recording renderer is unavailable.");
    return session.view.webContents.getMediaSourceId(requestContents);
  }

  async saveRecording(
    input: DesktopBrowserHostControlInput & { mimeType: string; data: Uint8Array },
  ): Promise<DesktopPreviewRecordingArtifact> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) throw new Error("The requested browser session is unavailable.");
    const extension = input.mimeType.includes("mp4") ? "mp4" : "webm";
    const createdAt = new Date().toISOString();
    const id = `browser-recording-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const artifactDirectory = this.artifactDirectory();
    const artifactPath = Path.join(artifactDirectory, `${id}.${extension}`);
    await FS.mkdir(artifactDirectory, { recursive: true });
    await FS.writeFile(artifactPath, input.data, { flag: "wx" });
    return {
      id,
      tabId: session.sessionId,
      path: artifactPath,
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      createdAt,
    };
  }

  async pickElement(
    input: DesktopBrowserHostControlInput,
  ): Promise<PreviewAnnotationPayload | null> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || session.view.webContents.isDestroyed()) {
      throw new Error("The requested browser session is unavailable.");
    }
    const picked = (await session.view.webContents.executeJavaScript(
      String.raw`(() => new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.setAttribute("data-tabs-element-picker", "");
        Object.assign(overlay.style, {
          position: "fixed", pointerEvents: "none", zIndex: "2147483647",
          border: "2px solid #7c3aed", background: "rgba(124,58,237,.14)",
          boxSizing: "border-box", display: "none"
        });
        const help = document.createElement("div");
        help.textContent = "Select an element · Esc to cancel";
        Object.assign(help.style, {
          position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)",
          zIndex: "2147483647", padding: "8px 12px", borderRadius: "8px",
          color: "white", background: "rgba(17,24,39,.94)", font: "12px system-ui",
          pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,.3)"
        });
        document.documentElement.append(overlay, help);
        let hovered = null;
        const cleanup = () => {
          document.removeEventListener("mousemove", onMove, true);
          document.removeEventListener("click", onClick, true);
          document.removeEventListener("keydown", onKey, true);
          overlay.remove(); help.remove();
        };
        const selectorFor = (element) => {
          if (element.id) return "#" + CSS.escape(element.id);
          const parts = [];
          for (let current = element; current && current.nodeType === 1 && parts.length < 6; current = current.parentElement) {
            let part = current.tagName.toLowerCase();
            const stableClasses = [...current.classList].filter((name) => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)).slice(0, 2);
            if (stableClasses.length) part += stableClasses.map((name) => "." + CSS.escape(name)).join("");
            const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
            if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
            parts.unshift(part);
          }
          return parts.join(" > ") || null;
        };
        const onMove = (event) => {
          const target = event.target;
          if (!(target instanceof Element) || target === overlay || target === help) return;
          hovered = target;
          const rect = target.getBoundingClientRect();
          Object.assign(overlay.style, { display: "block", left: rect.x + "px", top: rect.y + "px", width: rect.width + "px", height: rect.height + "px" });
        };
        const onClick = (event) => {
          event.preventDefault(); event.stopImmediatePropagation();
          const target = event.composedPath().find((node) => node instanceof Element) ?? hovered;
          if (!(target instanceof Element)) return;
          const rect = target.getBoundingClientRect();
          const computed = getComputedStyle(target);
          const styles = ["display", "position", "color", "background-color", "font", "margin", "padding", "border", "border-radius", "width", "height"]
            .map((property) => property + ": " + computed.getPropertyValue(property) + ";").join("\n");
          const result = {
            pageUrl: location.href, pageTitle: document.title?.trim() || null,
            tagName: target.tagName.toLowerCase(), selector: selectorFor(target),
            htmlPreview: target.outerHTML.slice(0, 12000), componentName: null,
            source: null, stack: [], styles, pickedAt: new Date().toISOString(),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
          cleanup(); resolve(result);
        };
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault(); event.stopImmediatePropagation(); cleanup(); resolve(null);
        };
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKey, true);
      }))()`,
      true,
    )) as
      | (PickedElementPayload & {
          rect: { x: number; y: number; width: number; height: number };
        })
      | null;
    if (!picked) return null;
    const image = await session.view.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    const size = image.getSize();
    const { rect, ...element } = picked;
    return {
      id: `annotation-${crypto.randomUUID()}`,
      pageUrl: element.pageUrl as string,
      pageTitle: element.pageTitle as string | null,
      comment: "",
      elements: [{ id: `element-${crypto.randomUUID()}`, element, rect }],
      regions: [],
      strokes: [],
      styleChanges: [],
      screenshot: {
        dataUrl: `data:image/png;base64,${image.toPNG().toString("base64")}`,
        width: size.width,
        height: size.height,
        cropRect: rect,
      },
      createdAt: new Date().toISOString(),
    };
  }

  revealArtifact(artifactPath: string): void {
    shell.showItemInFolder(this.requireArtifactPath(artifactPath));
  }

  async copyArtifactToClipboard(artifactPath: string): Promise<void> {
    const safePath = this.requireArtifactPath(artifactPath);
    const data = await FS.readFile(safePath);
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) throw new Error("The browser artifact is not a readable image.");
    await clipboard.write([
      new ClipboardItem({ "image/png": new Blob([new Uint8Array(data)], { type: "image/png" }) }),
    ]);
  }

  private artifactDirectory(): string {
    return Path.join(app.getPath("userData"), "browser-artifacts");
  }

  private requireArtifactPath(artifactPath: string): string {
    const artifactDirectory = Path.resolve(this.artifactDirectory());
    const resolved = Path.resolve(artifactPath);
    if (!resolved.startsWith(`${artifactDirectory}${Path.sep}`)) {
      throw new Error("Browser artifacts must be inside the Tabs artifact directory.");
    }
    return resolved;
  }

  sessionForWebContentsId(webContentsId: number | undefined): BrowserSession | undefined {
    if (webContentsId === undefined) return undefined;
    return [...this.sessions.values()].find(
      (candidate) => candidate.view.webContents.id === webContentsId,
    );
  }

  /** A detached native view cannot receive Chromium pointer events. Keep its
   * surface attached underneath the app renderer while a background action runs. */
  private async withAutomationSurface<T>(
    session: BrowserSession,
    run: () => Promise<T>,
  ): Promise<T> {
    const window = this.getWindow();
    const contents = session.view.webContents;
    const epoch = session.controlEpoch;
    const attached =
      window && !window.isDestroyed() && !window.contentView.children.includes(session.view);
    if (attached) {
      if (this.stackCoordinator) {
        this.stackCoordinator.attachAutomationView(session.view, 0);
      } else {
        window.contentView.addChildView(session.view, 0);
      }
      session.view.setBounds(session.bounds ?? { x: 0, y: 0, width: 1024, height: 768 });
    }
    try {
      if (attached && session.cdpCoordinator)
        await session.cdpCoordinator.withSession("automation", (debug) =>
          debug.sendCommand("Page.captureScreenshot", { format: "png", fromSurface: true }),
        );
      if (
        session.controlEpoch !== epoch ||
        this.sessions.get(session.key) !== session ||
        session.view.webContents !== contents ||
        contents.isDestroyed()
      )
        throw new Error("Browser action interrupted during surface preparation.");
      return await run();
    } finally {
      if (attached && !contents.isDestroyed() && this.activeKey !== session.key)
        this.detachSession(session);
    }
  }

  private async trackAutomation<T>(
    session: BrowserSession,
    action: string,
    run: () => Promise<T>,
    taskId?: string,
  ): Promise<T> {
    if (session.assignedTaskId && session.assignedTaskId !== taskId) {
      throw new Error(
        `Browser tab is assigned to task "${session.assignedTaskId}", but automation was requested by task "${taskId}".`,
      );
    }
    if (session.controller === "human") {
      throw new Error("Browser automation was rejected because human has taken control.");
    }

    session.controlEpoch ??= 0;
    const scheduledEpoch = session.controlEpoch;
    const previous = session.automationTail ?? Promise.resolve();
    let releaseQueue!: () => void;
    session.automationTail = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    const event: BrowserActionEvent = {
      id: crypto.randomUUID(),
      action,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    session.actionTimeline ??= [];
    appendBounded(session.actionTimeline, event);

    try {
      await previous;
    } catch {
      // previous queue item failed, continue
    }

    if (!this.sessions.has(session.key) || session.view.webContents.isDestroyed()) {
      event.status = "cancelled";
      event.completedAt = new Date().toISOString();
      event.error = "Browser session was closed or recreated before automation could execute.";
      releaseQueue();
      throw new Error(event.error);
    }

    if (
      (session.controlEpoch ?? 0) !== scheduledEpoch ||
      (session.controller as string) === "human"
    ) {
      event.status = "cancelled";
      event.completedAt = new Date().toISOString();
      event.error =
        "Browser automation was cancelled prior to execution due to human takeover or control epoch change.";
      releaseQueue();
      throw new Error(event.error);
    }

    if (session.assignedTaskId && session.assignedTaskId !== taskId) {
      event.status = "cancelled";
      event.completedAt = new Date().toISOString();
      event.error = `Tab assignment changed to task "${session.assignedTaskId}".`;
      releaseQueue();
      throw new Error(event.error);
    }

    session.controller = "agent";
    this.emitState(session);
    try {
      const result = await this.withAutomationSurface(session, run);
      if (session.controlEpoch !== scheduledEpoch) {
        event.status = "interrupted";
        event.completedAt = new Date().toISOString();
        event.error = "Browser automation was interrupted by human input during execution.";
        throw new Error(event.error);
      }
      event.status = "succeeded";
      event.completedAt = new Date().toISOString();
      return result;
    } catch (cause) {
      if (event.status !== "interrupted" && event.status !== "cancelled") {
        event.status = "failed";
        event.completedAt = new Date().toISOString();
        event.error = cause instanceof Error ? cause.message : String(cause);
      }
      throw cause;
    } finally {
      if (session.controller === "agent") {
        session.controller = "none";
        this.emitState(session);
      }
      releaseQueue();
    }
  }

  takeControl(input: DesktopBrowserHostControlInput): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    session.controlEpoch = (session.controlEpoch ?? 0) + 1;
    session.controller = "human";
    session.humanControlLocked = true;
    session.userRetained = true;
    this.clearHumanControlTimer(session);
    this.emitState(session);
  }

  resumeAgent(input: DesktopBrowserHostControlInput & { taskId?: string | undefined }): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    if (input.taskId && session.assignedTaskId && session.assignedTaskId !== input.taskId) {
      throw new Error(`Cannot resume tab assigned to task "${session.assignedTaskId}".`);
    }
    session.controlEpoch = (session.controlEpoch ?? 0) + 1;
    session.controller = "none";
    session.humanControlLocked = false;
    this.clearHumanControlTimer(session);
    this.emitState(session);
  }

  assignTabTask(input: DesktopBrowserHostControlInput & { taskId: string | null }): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    if (session.assignedTaskId !== input.taskId) {
      session.controlEpoch = (session.controlEpoch ?? 0) + 1;
    }
    session.assignedTaskId = input.taskId ?? null;
    this.emitState(session);
  }

  retainTab(input: DesktopBrowserHostControlInput): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    session.userRetained = true;
    this.emitState(session);
  }

  cleanupAgentTabs(input: { projectId: string; taskId: string }): string[] {
    const closedIds: string[] = [];
    for (const [, session] of this.sessions) {
      if (
        session.projectId === input.projectId &&
        session.assignedTaskId === input.taskId &&
        session.temporaryAgentTab &&
        !session.userRetained
      ) {
        closedIds.push(session.sessionId);
        this.destroySession({ projectId: session.projectId, sessionId: session.sessionId });
      }
    }
    return closedIds;
  }

  destroySession(input: DesktopBrowserHostControlInput, remember = true): void {
    const key = this.sessionKey(input.projectId, input.sessionId);
    const session = this.sessions.get(key);
    if (!session) return;
    if (remember) this.recordRecentlyClosed(session);
    session.controlEpoch = (session.controlEpoch ?? 0) + 1;
    this.clearCrashRecoveryTimer(session);
    this.clearHumanControlTimer(session);
    if (this.activeKey === key) {
      this.detachSession(session);
      this.activeKey = null;
    }
    this.closePictureInPicture({ projectId: session.projectId, sessionId: session.sessionId });
    defaultPermissionMediator.cancelPendingRequestsForWebContents(session.view.webContents.id);
    session.pendingPermission = null;
    session.cdpCoordinator?.detach();
    session.view.webContents.close({ waitForBeforeUnload: false });
    this.sessions.delete(key);
  }

  private recordRecentlyClosed(session: BrowserSession): void {
    if (!session.currentUrl || session.currentUrl === "about:blank") return;
    const list = this.recentlyClosedTabs.get(session.projectId) ?? [];
    const entry: RecentlyClosedTab = {
      id: crypto.randomUUID(),
      projectId: session.projectId,
      sessionId: session.sessionId,
      url: session.currentUrl,
      title: session.pageTitle || session.currentUrl,
      profileId: session.profileId,
      closedAt: new Date().toISOString(),
    };
    list.unshift(entry);
    if (list.length > 25) list.pop();
    this.recentlyClosedTabs.set(session.projectId, list);
  }

  getRecentlyClosedTabs(projectId: string): RecentlyClosedTab[] {
    return this.recentlyClosedTabs.get(projectId) ?? [];
  }

  restoreRecentlyClosedTab(projectId: string, id?: string): RecentlyClosedTab | null {
    const list = this.recentlyClosedTabs.get(projectId);
    if (!list || list.length === 0) return null;
    const index = id ? list.findIndex((e) => e.id === id) : 0;
    if (index === -1) return null;
    const [restored] = list.splice(index, 1);
    return restored ?? null;
  }

  private observeAutomationNetwork(browserSession: Session): void {
    if (this.observedAutomationSessions.has(browserSession)) return;
    this.observedAutomationSessions.add(browserSession);
    browserSession.webRequest.onCompleted((details) => {
      const target = this.sessionForWebContentsId(details.webContentsId);
      if (!target) return;
      target.networkEntries ??= [];
      appendBounded(target.networkEntries, {
        url: details.url,
        method: details.method,
        status: details.statusCode,
        failed: false,
        timestamp: new Date().toISOString(),
      });
    });
    browserSession.webRequest.onErrorOccurred((details) => {
      const target = this.sessionForWebContentsId(details.webContentsId);
      if (!target) return;
      target.networkEntries ??= [];
      appendBounded(target.networkEntries, {
        url: details.url,
        method: details.method,
        status: null,
        failed: true,
        errorText: details.error,
        timestamp: new Date().toISOString(),
      });
    });
  }

  syncSessions(projectIds: readonly string[]): void {
    const allowed = new Set(projectIds);
    for (const session of this.sessions.values()) {
      if (allowed.has(session.projectId)) continue;
      this.destroySession({ projectId: session.projectId, sessionId: session.sessionId });
    }
  }

  async flushAndShutdownSessions(options?: { timeoutMs?: number }): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown(options?.timeoutMs ?? 5000);
    return this.shutdownPromise;
  }

  private async performShutdown(timeoutMs: number): Promise<void> {
    for (const controller of this.browserImports.values()) {
      try {
        controller.abort();
      } catch {
        /* best effort */
      }
    }
    try {
      void this.comparisons.closeAll();
    } catch {
      /* best effort */
    }
    this.hideActiveSession();

    // Deduplicate distinct persistent sessions to flush
    const sessionsToFlush = new Map<string, Session>();

    for (const session of this.sessions.values()) {
      const partition = session.partition;
      const s = session.view?.webContents?.session;
      const isPersistent =
        isPersistentPartition(partition) ||
        partition.startsWith("persist:") ||
        (typeof (s as any)?.isPersistent === "function" && Boolean((s as any).isPersistent()));

      if (isPersistent && session.view && !session.view.webContents.isDestroyed()) {
        if (s && !sessionsToFlush.has(partition)) {
          sessionsToFlush.set(partition, s);
        }
      }
    }

    for (const partition of this.knownPartitions) {
      const isPersistent = isPersistentPartition(partition) || partition.startsWith("persist:");
      if (isPersistent && !sessionsToFlush.has(partition)) {
        try {
          const s = electronSession.fromPartition(partition);
          if (s) {
            sessionsToFlush.set(partition, s);
          }
        } catch {
          /* best effort */
        }
      }
    }

    // flushStorageData writes DOM storage synchronously. Cookie persistence is
    // a separate asynchronous Electron API, so await and bound flushStore.
    const flushTasks = Array.from(sessionsToFlush.entries()).map(async ([partition, s]) => {
      try {
        if (typeof s.flushStorageData === "function") {
          s.flushStorageData();
        }
        if (typeof s.cookies?.flushStore === "function") {
          await withTimeout(
            s.cookies.flushStore(),
            timeoutMs,
            `Cookie flush timed out after ${timeoutMs}ms`,
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[browserHostManager] Failed to flush partition ${partition}: ${message}`);
      }
    });

    await Promise.allSettled(flushTasks);

    // After flush phase completes, close WebContents and clean up timers
    for (const session of this.sessions.values()) {
      try {
        this.closePictureInPicture({ projectId: session.projectId, sessionId: session.sessionId });
      } catch {
        /* best effort */
      }
      this.clearHumanControlTimer(session);
      this.clearCrashRecoveryTimer(session);
      try {
        if (!session.view.webContents.isDestroyed()) {
          session.view.webContents.close({ waitForBeforeUnload: false });
        }
      } catch {
        /* best effort */
      }
    }
    this.sessions.clear();
  }

  dispose(): void {
    void this.flushAndShutdownSessions().catch((err) => {
      console.warn("[browserHostManager] Shutdown flush error during dispose:", err);
    });
  }

  private async loadUrl(session: BrowserSession, url: string, failOnError = false): Promise<void> {
    session.currentUrl = url;
    session.lastError = null;
    session.transientError = null;
    this.emitState(session);
    try {
      await session.view.webContents.loadURL(url);
    } catch (error) {
      if (failOnError) throw error;
      // Electron's loadURL rejects when navigation fails (e.g. ERR_CONNECTION_REFUSED, ERR_ABORTED).
      // The did-fail-load event listener captures the error and updates session state cleanly.
    }
  }

  private snapshotSession(session: BrowserSession): DesktopBrowserSessionState {
    return {
      projectId: session.projectId,
      sessionId: session.sessionId,
      profileId: session.profileId,
      currentUrl: session.currentUrl,
      pageTitle: session.pageTitle,
      loading: session.loading,
      canGoBack: session.canGoBack,
      canGoForward: session.canGoForward,
      devToolsOpen: session.devToolsOpen,
      zoomFactor: session.zoomFactor,
      audioMuted: session.audioMuted,
      pictureInPicture:
        session.pictureInPictureWindow !== null && !session.pictureInPictureWindow.isDestroyed(),
      colorScheme: session.colorScheme,
      controller: session.controller ?? "none",
      controlEpoch: session.controlEpoch,
      assignedTaskId: session.assignedTaskId,
      temporaryAgentTab: session.temporaryAgentTab,
      userRetained: session.userRetained,
      lastError: session.lastError,
      transientError: session.transientError,
      securityContext: buildSecurityContext({
        url: session.currentUrl,
        partition: session.partition,
        certificateError: session.certificateError,
        isTabsOwned: true,
      }),
      pendingPermission: session.pendingPermission ?? null,
    };
  }

  private emitState(session: BrowserSession): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    window.webContents.send("desktop:browser-host:session-state", this.snapshotSession(session));
  }

  private async applyColorScheme(session: BrowserSession): Promise<void> {
    const contents = session.view.webContents;
    if (contents.isDestroyed() || contents.isDevToolsOpened()) return;
    try {
      if (session.cdpCoordinator) {
        await session.cdpCoordinator.withSession("emulation", async (debuggerApi) => {
          await debuggerApi.sendCommand("Emulation.setEmulatedMedia", {
            features: [
              {
                name: "prefers-color-scheme",
                value: session.colorScheme === "system" ? "" : session.colorScheme,
              },
            ],
          });
        });
      } else {
        if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
        await contents.debugger.sendCommand("Emulation.setEmulatedMedia", {
          features: [
            {
              name: "prefers-color-scheme",
              value: session.colorScheme === "system" ? "" : session.colorScheme,
            },
          ],
        });
      }
    } catch (error) {
      console.warn("[browserHostManager] Failed to apply browser color scheme:", error);
    }
  }

  private clearHumanControlTimer(session: BrowserSession): void {
    if (!session.humanControlTimer) return;
    clearTimeout(session.humanControlTimer);
    session.humanControlTimer = null;
  }

  private clearCrashRecoveryTimer(session: BrowserSession): void {
    if (!session.crashRecoveryTimer) return;
    clearTimeout(session.crashRecoveryTimer);
    session.crashRecoveryTimer = null;
  }

  private observeProfileSession(partition: string, s: Session): void {
    const profileId = extractProfileIdFromPartition(partition);
    if (!profileId || this.observedProfileSessions.has(s)) {
      return;
    }
    this.observedProfileSessions.add(s);
    s.cookies.on("changed", () => {
      const window = this.getWindow();
      if (!window || window.isDestroyed()) return;
      window.webContents.send("desktop:browser-host:profile-data-changed", profileId);
    });
  }

  private attachSession(session: BrowserSession): void {
    if (this.comparisons.active && !session.sessionId.startsWith("comparison-")) return;
    if (session.pictureInPictureWindow && !session.pictureInPictureWindow.isDestroyed()) {
      return;
    }
    const window = this.getWindow();
    if (!window) return;
    if (this.stackCoordinator) {
      this.stackCoordinator.attachToolView(session.view);
    } else {
      const currentViews = window.contentView.children;
      if (!currentViews.includes(session.view)) {
        window.contentView.addChildView(session.view);
      }
    }
    if (!session.sessionId.startsWith("comparison-")) session.view.webContents.focus?.();
  }

  private detachSession(session: BrowserSession): void {
    const window = this.getWindow();
    if (!window) return;
    if (this.stackCoordinator) {
      this.stackCoordinator.detachToolView(session.view);
    } else {
      const currentViews = window.contentView.children;
      if (currentViews.includes(session.view)) {
        window.contentView.removeChildView(session.view);
      }
    }
  }

  private registerSessionEvents(session: BrowserSession): void {
    const contents = session.view.webContents;
    const refreshNavigationState = () => {
      session.canGoBack = contents.canGoBack();
      session.canGoForward = contents.canGoForward();
    };
    const markHumanControl = (
      _event?: unknown,
      input?: {
        type?: string;
        key?: string;
        x?: number;
        y?: number;
        movementX?: number;
        movementY?: number;
      },
    ) => {
      if (session.dispatchingAgentInput || session.inputGuard?.consume(input)) return;
      // Chromium emits stationary hover updates when native surfaces move or attach.
      if (input?.type === "mouseMove" && input.movementX === 0 && input.movementY === 0) return;
      session.controlEpoch = (session.controlEpoch ?? 0) + 1;
      session.controller = "human";
      session.userRetained = true;
      if (session.humanControlTimer) clearTimeout(session.humanControlTimer);
      this.emitState(session);
      if (session.humanControlLocked) return;
      session.humanControlTimer = setTimeout(() => {
        session.humanControlTimer = null;
        if (session.controller !== "human") return;
        session.controller = "none";
        this.emitState(session);
      }, 750);
    };
    contents.on("before-input-event", markHumanControl);
    contents.on("before-mouse-event", markHumanControl);
    contents.on("will-navigate", (event, url) => {
      const currentUrl = contents.getURL();
      const classification = classifyAuthNavigation({
        url,
        initiatingUrl: currentUrl,
        isWindowOpen: false,
      });
      this.diagnostics.record({
        profileId: session.partition,
        provider: classification.provider,
        stage: "navigation_initiated",
        navigationType: "will_navigate",
        rawUrl: url,
        outcome: classification.kind === "externalOAuthRequired" ? "in_progress" : "completed",
        summary: classification.reason,
      });
      if (classification.kind === "blockedUnsafeScheme") {
        event.preventDefault();
        return;
      }
    });

    contents.on("did-start-loading", () => {
      if (session.pendingPermission) {
        defaultPermissionMediator.cancelPendingRequestsForWebContents(contents.id);
        session.pendingPermission = null;
      }
      session.loading = true;
      session.lastError = null;
      session.transientError = null;
      session.certificateError = null;
      refreshNavigationState();
      this.emitState(session);
    });
    contents.on("destroyed", () => {
      defaultPermissionMediator.cancelPendingRequestsForWebContents(contents.id);
      session.pendingPermission = null;
    });
    contents.on("did-stop-loading", () => {
      session.loading = false;
      session.currentUrl = contents.getURL() || session.currentUrl;
      session.pageTitle = contents.getTitle() || session.pageTitle;
      if (session.currentUrl) {
        const rejection = detectGoogleRejection(session.currentUrl, session.pageTitle);
        if (rejection.isRejected && rejection.code === "disallowed_useragent") {
          session.lastError = rejection.explanation;
        }
      }
      refreshNavigationState();
      this.emitState(session);
    });
    contents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      session.pageTitle = title || null;
      this.emitState(session);
    });
    contents.on("did-navigate", (_event, url) => {
      session.currentUrl = url;
      this.comparisons.navigated(session.projectId, session.sessionId, url);
      session.lastError = null;
      session.transientError = null;
      session.certificateError = null;
      session.crashRecoveryAttempts = 0;
      session.crashRecoveryWindowStartedAt = null;
      refreshNavigationState();
      this.emitState(session);
    });
    contents.on("certificate-error", (event, _url, error, _certificate, callback) => {
      event.preventDefault();
      session.certificateError = error;
      session.lastError = `Certificate error: ${error}`;
      this.diagnostics.record({
        profileId: session.partition,
        stage: "error",
        navigationType: "in_page",
        rawUrl: _url,
        errorCode: error,
        outcome: "error",
        summary: `Certificate verification failed: ${error}`,
      });
      refreshNavigationState();
      this.emitState(session);
      callback(false);
    });
    contents.on("did-navigate-in-page", (_event, url) => {
      session.currentUrl = url;
      this.comparisons.navigated(session.projectId, session.sessionId, url);
      refreshNavigationState();
      this.emitState(session);
    });
    contents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) {
          return;
        }
        session.loading = false;
        session.currentUrl = validatedUrl || session.currentUrl;
        // ERR_CONNECTION_REFUSED (-102): dev server hasn't bound to the port yet.
        // Treat as a transient startup condition — the frontend will show a
        // "Starting..." overlay and retry. Do NOT set lastError here.
        if (errorCode === -102) {
          session.transientError = errorDescription || "ERR_CONNECTION_REFUSED";
          session.lastError = null;
        } else {
          session.lastError = errorDescription || "Unable to load page.";
          session.transientError = null;
        }
        refreshNavigationState();
        this.emitState(session);
      },
    );
    // A blank embed used to be indistinguishable from a crash: if the page's
    // renderer process died, the WebContentsView just painted its background color
    // with no indication. Surface it as an error (which the UI shows with a
    // reload affordance) instead of a silent black void.
    contents.on("render-process-gone", (_event, details) => {
      session.loading = false;
      const recovery = planBrowserCrashRecovery(
        session.crashRecoveryAttempts,
        session.crashRecoveryWindowStartedAt,
        Date.now(),
      );
      session.lastError = recovery
        ? `The page crashed (${details.reason}). Recovering…`
        : `The page crashed repeatedly (${details.reason}). Reload to try again.`;
      refreshNavigationState();
      this.emitState(session);
      const sanitizedUrl = sanitizeDiagnosticOrigin(session.currentUrl);
      console.error(
        `[browser-host] render process gone for ${session.key} (${sanitizedUrl}): ${details.reason}`,
      );
      if (!recovery || session.crashRecoveryTimer) return;
      session.crashRecoveryAttempts = recovery.attempts;
      session.crashRecoveryWindowStartedAt = recovery.windowStartedAt;
      session.crashRecoveryTimer = setTimeout(() => {
        session.crashRecoveryTimer = null;
        if (this.sessions.get(session.key) !== session) return;
        void this.recreateSession(session.projectId, session.sessionId).catch((error) => {
          session.lastError = error instanceof Error ? error.message : String(error);
          this.emitState(session);
        });
      }, recovery.delayMs);
    });
    // Forward page-level error logs to the main process log. Many "the site is
    // blank" reports are a client-side exception thrown by the embedded page
    // (e.g. figma); capturing it here makes those diagnosable without manually
    // opening DevTools on the BrowserView.
    contents.on("console-message", (details) => {
      const sanitizedSource = sanitizeDiagnosticOrigin(details.sourceId);
      session.consoleEntries ??= [];
      appendBounded(session.consoleEntries, {
        level: details.level,
        text: details.message,
        timestamp: new Date().toISOString(),
        ...(sanitizedSource.length > 0
          ? { source: `${sanitizedSource}:${details.lineNumber}` }
          : {}),
      });
      if (details.level === "error") {
        console.error(
          `[browser-host] page console error ${session.key} (${sanitizedSource}:${details.lineNumber}): ${details.message}`,
        );
      }
    });
    contents.on("devtools-opened", () => {
      session.devToolsOpen = true;
      session.cdpCoordinator?.handleDevToolsOpened();
      this.emitState(session);
    });
    contents.on("devtools-closed", () => {
      session.devToolsOpen = false;
      session.cdpCoordinator?.handleDevToolsClosed();
      this.emitState(session);
      void this.applyColorScheme(session);
    });
    contents.setWindowOpenHandler((details) => {
      const decision = decideWindowOpenAction(details, session.partition, contents.getURL());
      if (decision.action === "deny" && decision.externalOAuthRequired) {
        session.currentUrl = details.url;
        session.lastError = EXTERNAL_OAUTH_REQUIRED_MESSAGE;
        this.emitState(session);
      }
      this.diagnostics.record({
        profileId: session.partition,
        stage: "popup_opened",
        navigationType:
          decision.action === "allow"
            ? "new_window"
            : decision.handledInTab
              ? "in_page"
              : decision.handledExternally
                ? "external_browser"
                : "new_window",
        rawUrl: details.url,
        outcome: decision.action === "allow" ? "in_progress" : "completed",
        summary:
          decision.action === "allow"
            ? "Scripted popup allowed with shared partition"
            : decision.handledInTab
              ? "Link loaded in embedded browser tab"
              : decision.handledExternally
                ? "Routed to external browser"
                : "Popup blocked by browser security policy",
      });
      if (decision.action === "allow") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: decision.overrideBrowserWindowOptions,
        };
      }
      if (decision.handledInTab && details.url) {
        void contents.loadURL(details.url);
      }
      return { action: "deny" };
    });
    contents.on("did-create-window", (childWindow) => {
      configureChildPopupWindow(childWindow, contents, session.partition);
    });
    contents.on("context-menu", (_event, params) => {
      const template: MenuItemConstructorOptions[] = [
        {
          label: "Back",
          enabled: contents.canGoBack(),
          click: () => contents.goBack(),
        },
        {
          label: "Forward",
          enabled: contents.canGoForward(),
          click: () => contents.goForward(),
        },
        {
          label: "Reload",
          click: () => contents.reload(),
        },
        { type: "separator" },
        {
          label: "Open In Browser",
          click: () => {
            const url = contents.getURL();
            if (url) {
              void shell.openExternal(url).catch(() => undefined);
            }
          },
        },
        {
          label: "Inspect Element",
          click: () => {
            if (!contents.isDevToolsOpened()) {
              contents.openDevTools({ mode: DOCKED_DEVTOOLS_MODE });
            }
            contents.inspectElement(params.x, params.y);
          },
        },
      ];
      const popupWindow = this.getWindow();
      Menu.buildFromTemplate(template).popup(
        popupWindow
          ? {
              window: popupWindow,
            }
          : {},
      );
    });
  }
}
