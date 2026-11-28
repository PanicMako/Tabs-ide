import { isUserBrowserTab } from "@tabs/shared/preview";
import {
  pageTargetExpression,
  SNAPSHOT_SELECTOR,
  snapshotTextMatchesExpression,
} from "./browserPageTarget";
import {
  getBrowserPageScope,
  grantedPageAddress,
  describeBrowserPageScope,
  matchesPageScope,
  pageOrigin,
  PAGE_READY_FOR_AGENT,
} from "./browserPageGrant";
import { BrowserInputGuard } from "./browserInputGuard";
import { findInPage, stopFindInPage, type BrowserFindResult } from "./browserFind";
import { BrowserComparisonController } from "./browserComparisonController";
import { runBrowserReproduction } from "./browserReproductionRunner";
import { BrowserSubmissionGuards, browserWorkflowHostKey } from "./browserWorkflowHostId";
import { checkSubmissionGuard, checkSubmissionIdentity } from "./browserSubmissionGuard";
import {
  BrowserAttachmentBookmarks,
  type BrowserAttachmentBookmark,
} from "./browserAttachmentBookmarks";
import { browserWorkflowPageScript } from "./browserWorkflowPage";
import {
  deviceScreenshotInputScript,
  SCREENSHOT_IMAGE_RECEIPTS,
  SCREENSHOT_RECEIPT_MODE,
  selectedDeviceScreenshotScript,
} from "./deviceScreenshotInput";
import {
  ACCOUNT_MARKER_MESSAGE,
  ACCOUNT_MARKER_SCRIPT,
  accountMarkerChanged,
  parseAccountMarker,
} from "./browserAccountMarker";
import {
  checkAttachmentPage,
  classifyScreenshotReceipt,
  type ScreenshotReceiptKind,
} from "./browserScreenshotReceipts";
import type { BrowserReproductionStep } from "@tabs/contracts";
import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { JourneyRecorder } from "./journeyRecorder";
import { BrowserSessionImporter } from "./browserImport/BrowserSessionImporter";
import {
  classifyAuthNavigation,
  sanitizeAuthUrl,
  hasSameRegistrableOrigin,
  isLikelyAuthenticationUrl,
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
import {
  PermissionMediator,
  checkWebAuthnContext,
  categorizePermission,
} from "./permissionMediator";
import { BrowserAuthDiagnostics, type AuthDiagnosticEntry } from "./browserDiagnostics";

import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  nativeImage,
  WebContentsView,
  session as electronSession,
  shell,
  type Session,
} from "electron";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import * as Schema from "effect/Schema";
import {
  BROWSER_WORKFLOW_UPLOAD_MAX_BYTES,
  BrowserWorkflowBrowserRequest,
  BrowserWorkflowPageResult,
  PreviewAutomationFindText,
  PreviewTabId,
  ThreadId,
} from "@tabs/contracts";
import {
  runBrowserContextMenuAction,
  validateContextMenuReply,
  type PendingBrowserContextMenu,
} from "./browserContextMenu";
import type { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";
import { DeviceComparisonFrame, DeviceComparisonResultRef } from "@tabs/contracts";
import type {
  DesktopBrowserHostActivateSessionInput,
  DesktopBrowserHostControlInput,
  DesktopBrowserHostNavigateInput,
  DesktopBrowserHostSetBoundsInput,
  DesktopBrowserHostState,
  DesktopBrowserSessionState,
  DesktopBridge,
  BrowserProfileDomainInfo,
  BrowserImportSource,
  BrowserProfilePermissionInfo,
  DesktopPreviewScreenshotArtifact,
  DesktopPreviewRecordingArtifact,
} from "@tabs/contracts";

const DEFAULT_BROWSER_HOST_STATE: DesktopBrowserHostState = {
  available: true,
  reason: null,
};
const DOCKED_DEVTOOLS_MODE = "bottom";

/** The longest a page may sit out of sight before it rests: one week. */
const MAX_REST_MINUTES = 7 * 24 * 60;
const configuredSessions = new WeakSet<Session>();

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
  isLikelyAuthenticationUrl,
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

function normalizeAuthenticationHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./u, "");
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

let activeBrowserHostManager: BrowserHostManager | null = null;

function browserPermissionScope(partition: string | undefined): string {
  return partition?.startsWith(AGENT_PARTITION_PREFIX)
    ? partition
    : (extractProfileIdFromPartition(partition) ?? "default");
}

export function configurePartitionSession(s: Session, partition?: string): void {
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
      defaultPermissionMediator.handlePermissionRequest({
        webContentsId: webContents?.id,
        permission,
        requestingUrl: details?.requestingUrl,
        details,
        profileId: browserPermissionScope(session?.partition ?? partition),
        callback,
      });
    });
    s.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const session = activeBrowserHostManager?.sessionForWebContentsId(webContents?.id);
      return defaultPermissionMediator.evaluateCheck(
        permission,
        requestingOrigin,
        browserPermissionScope(session?.partition ?? partition),
      );
    });
  } catch (err) {
    console.error("[browserHostManager] Failed to configure partition session:", err);
  }
}

export function sanitizeEmbeddedBrowserUserAgent(userAgent: string): string {
  return userAgent.replace(/ Electron\/[^ ]+/g, "").replace(/ [^ /]+\/[^ ]+ Chrome\//, " Chrome/");
}

import {
  ScreenshotDraft,
  DeviceScreenshotGrant,
  DeviceScreenshotAttempt,
  BrowserSession,
  BrowserActionEvent,
  appendBounded,
  BrowserAutomationRequest,
  BrowserConsentPage,
  isBrowserAttachmentUrl,
  releaseInterruptedPress,
  automationInput,
  screenshotPair,
  matchesScreenshotDraftUrl,
  pairedScreenshotDraft,
  currentThreadPageGrant,
  checkGuardedWorkflowDefinition,
} from "./browserHostSupport";
import {
  livePartnerCenterStatus,
  liveFigmaCanvasReview,
  runPartnerCenterStatus,
  requireCurrentFigmaCanvasReview,
  rejectFigmaCanvasReview,
  inspectFigmaCanvas,
  verifyFigmaCanvasPage,
  runFigmaCanvas,
  enterFigmaCanvasResult,
} from "./browserFigmaPartnerCenter";
import {
  quickActionTargets,
  pickQuickActionControl,
  runQuickActionOperation,
  enterQuickActionFileResult,
} from "./browserQuickActionRun";
import {
  openSavedAttachment,
  requireSavedBrowserTarget,
  enterBrowserWorkflowResult,
  monitorBrowserWorkflow,
} from "./browserWorkflowRun";
import {
  bookmarkForScreenshotDraft,
  saveVerifiedScreenshotDraft,
  stageComparisonDraft,
  revokeScreenshotAttempts,
  enterSavedScreenshotDraft,
  readDeviceComparisonDraft,
  findDeviceComparisonDraft,
  enterDeviceComparisonDraft,
  isCurrentDeviceEvidencePage,
  authorizeDeviceComparisonEvidence,
  currentDeviceScreenshotGrants,
  storeDeviceScreenshotGrants,
} from "./browserDeviceScreenshots";
import { MAX_DEVICE_SCREENSHOT_GRANTS } from "./browserHostSupport";
import {
  readBrowserSelection,
  enterAttachedPage,
  attachmentThread,
  attachmentBookmark,
  captureAttachedPage,
  enterSavedAttachedPage,
} from "./browserAttachedPage";
import {
  clearProfileData,
  clearSessionData,
  clearPartitionData,
  inspectProfile,
  clearProfileDomain,
  importBrowserCookies,
  observeProfileSession,
  lastHttpOnlyCookieChange,
  invalidateStorageGrants,
} from "./browserProfileStorage";
import { normalizeBrowserProfileId, normalizeBrowserCookieDomain } from "./browserProfileStorage";
import {
  performShutdown,
  snapshotSession,
  registerSessionEvents,
  openContextMenu,
} from "./browserSessionEvents";
import {
  ensureSession,
  recreateSession,
  pickElement,
  takeControl,
  resumeAgent,
} from "./browserAgentControl";
import {
  defaultPermissionMediator,
  BROWSER_CONTEXT_MENU_CHANNEL,
  DEFAULT_SESSION_ID,
  AGENT_PARTITION_PREFIX,
  BROWSER_CRASH_RECOVERY_WINDOW_MS,
  planBrowserCrashRecovery,
} from "./browserHostSupport";

export interface RecentlyClosedTab {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly url: string;
  readonly title: string;
  readonly profileId?: string | undefined;
  readonly closedAt: string;
}

export class BrowserHostManager {
  readonly submissionGuards = new BrowserSubmissionGuards(() => app.getPath("userData"));
  readonly attachmentBookmarks = new BrowserAttachmentBookmarks(() => app.getPath("userData"));
  readonly attachmentEntryLease = Symbol("enter-saved-attached-page");
  readonly attachmentManagerId = randomUUID();
  readonly workflowRefreshes = new WeakSet<BrowserSession>();
  checkSubmissionGuard(session: BrowserSession) {
    checkSubmissionGuard(
      this.submissionGuards,
      session.partition,
      session.view.webContents.getURL(),
    );
  }

  private checkSubmissionIdentity(session: BrowserSession, contents: Electron.WebContents) {
    return checkSubmissionIdentity(this.submissionGuards, session.partition, contents);
  }

  liveSubmissionApproval(session: BrowserSession, url: string | null) {
    const approval = session.workflowSubmission;
    if (
      approval &&
      session.pageGrant === approval.grant &&
      session.assignedTaskId === approval.grant.taskId &&
      session.controlEpoch === approval.epoch &&
      session.partition === approval.grant.partition &&
      session.controller !== "human" &&
      !session.loading &&
      url === approval.definition.url
    ) {
      return approval;
    }
  }

  matchesBrowserConsentPage(session: BrowserSession, page: BrowserConsentPage) {
    const { contents, browserSession, storagePath, profileId, grant, url } = page;
    return (
      this.sessions.get(session.key) === session &&
      session.view.webContents === contents &&
      session.instanceId === page.instanceId &&
      session.pageRevision === page.revision &&
      session.pageGrant === grant &&
      session.assignedTaskId === grant.taskId &&
      session.partition === grant.partition &&
      (session.profileId ?? "default") === profileId &&
      session.controlEpoch === page.epoch &&
      session.controller !== "human" &&
      !session.resting &&
      !session.loading &&
      !session.certificateError &&
      !contents.isDestroyed() &&
      !contents.isCrashed() &&
      !contents.isLoadingMainFrame() &&
      contents.session === browserSession &&
      browserSession.storagePath === storagePath &&
      contents.getURL() === url &&
      matchesPageScope(grant, url)
    );
  }

  livePartnerCenterStatus(
    ...args: Parameters<typeof livePartnerCenterStatus>
  ): ReturnType<typeof livePartnerCenterStatus> {
    return livePartnerCenterStatus.apply(this, args);
  }

  liveFigmaCanvasReview(
    ...args: Parameters<typeof liveFigmaCanvasReview>
  ): ReturnType<typeof liveFigmaCanvasReview> {
    return liveFigmaCanvasReview.apply(this, args);
  }

  // Keyed by `${projectId}::${sessionId}` so each browser tab keeps its own
  // WebContentsView alive — switching tabs shows/hides instead of reloading.
  readonly sessions = new Map<string, BrowserSession>();
  private readonly pageReferenceKey = randomBytes(32);
  activeKey: string | null = null;
  readonly observedProfileSessions = new WeakSet<Session>();
  private readonly storageChanges = new WeakMap<Session, number>();
  readonly lastProfileImport = new WeakMap<Session, number>();
  readonly lastHttpOnlyCookieChanges = new WeakMap<Session, Map<string, number>>();
  private readonly checkedProfileDocuments = new WeakMap<
    Electron.WebContents,
    { changedAt: number; revision: number | undefined }
  >();
  private readonly observedAutomationSessions = new WeakSet<Session>();
  private readonly recentlyClosedTabs = new Map<string, RecentlyClosedTab[]>();
  readonly knownPartitions = new Set<string>();
  private shutdownPromise: Promise<void> | null = null;
  readonly diagnostics = new BrowserAuthDiagnostics();
  readonly comparisons: BrowserComparisonController;

  recordPartition(partition?: string | null): void {
    if (partition) {
      this.knownPartitions.add(partition);
    }
  }

  private restAfterMs = 0;
  private restTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly getWindow: () => BrowserWindow | null,
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
        if (browserPermissionScope(session.partition) === request.profileId) {
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

  sessionKey(projectId: string, sessionId?: string): string {
    return `${projectId}::${sessionId ?? DEFAULT_SESSION_ID}`;
  }

  getState(): DesktopBrowserHostState {
    return DEFAULT_BROWSER_HOST_STATE;
  }

  listBrowserWorkflowTabs() {
    const tabs: Awaited<ReturnType<NonNullable<DesktopBridge["listBrowserWorkflowTabs"]>>> = [];
    for (const session of this.sessions.values()) {
      const grant = session.pageGrant;
      const contents = session.view.webContents;
      if (
        !grant ||
        !isUserBrowserTab(session.sessionId) ||
        session.assignedTaskId !== grant.taskId ||
        session.partition !== grant.partition ||
        session.controller === "human" ||
        session.resting ||
        contents.isDestroyed() ||
        !matchesPageScope(grant, contents.getURL())
      )
        continue;
      const storagePath = contents.session.storagePath;
      if (!storagePath) continue;
      tabs.push({
        threadId: ThreadId.makeUnsafe(grant.taskId),
        tabId: PreviewTabId.make(session.sessionId),
        workflowHostKey: browserWorkflowHostKey(app.getPath("userData"), storagePath),
      });
    }
    return tabs;
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

  async ensureSession(...args: Parameters<typeof ensureSession>): ReturnType<typeof ensureSession> {
    return ensureSession.apply(this, args);
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
      current.lastActiveAt = Date.now();
      this.detachSession(current);
    }

    this.activeKey = key;
    session.lastActiveAt = Date.now();
    if (session.resting) await this.wakeSession(session);
    if (session.bounds) {
      this.attachSession(session);
      session.view.setBounds(session.bounds);
    }
  }

  async recreateSession(
    ...args: Parameters<typeof recreateSession>
  ): ReturnType<typeof recreateSession> {
    return recreateSession.apply(this, args);
  }

  async clearProfileData(
    ...args: Parameters<typeof clearProfileData>
  ): ReturnType<typeof clearProfileData> {
    return clearProfileData.apply(this, args);
  }

  async clearSessionData(
    ...args: Parameters<typeof clearSessionData>
  ): ReturnType<typeof clearSessionData> {
    return clearSessionData.apply(this, args);
  }

  async clearPartitionData(
    ...args: Parameters<typeof clearPartitionData>
  ): ReturnType<typeof clearPartitionData> {
    return clearPartitionData.apply(this, args);
  }

  async inspectProfile(
    ...args: Parameters<typeof inspectProfile>
  ): ReturnType<typeof inspectProfile> {
    return inspectProfile.apply(this, args);
  }

  async getProfileDomains(profileId: string): Promise<BrowserProfileDomainInfo[]> {
    const inspection = await this.inspectProfile(profileId);
    return inspection.domains;
  }

  async clearProfileDomain(
    ...args: Parameters<typeof clearProfileDomain>
  ): ReturnType<typeof clearProfileDomain> {
    return clearProfileDomain.apply(this, args);
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

  readonly browserImports = new Map<string, AbortController>();

  cancelBrowserImport(requestId: string): void {
    this.browserImports.get(requestId)?.abort();
  }

  async importBrowserCookies(
    ...args: Parameters<typeof importBrowserCookies>
  ): ReturnType<typeof importBrowserCookies> {
    return importBrowserCookies.apply(this, args);
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

  /**
   * Rest browser pages that have been out of sight for `idleMinutes` (0 turns
   * resting off). Like a discarded Chrome tab, a resting page gives back its
   * memory and returns to the same history entry when shown again.
   */
  setRestAfterMinutes(idleMinutes: number): void {
    const minutes = Number.isFinite(idleMinutes) ? Math.round(idleMinutes) : 0;
    // Five minutes to a week: long enough not to fight active work, short
    // enough to matter for projects left open in the background for days.
    this.restAfterMs = minutes > 0 ? Math.min(Math.max(minutes, 5), MAX_REST_MINUTES) * 60_000 : 0;
    if (this.restTimer) clearInterval(this.restTimer);
    this.restTimer = undefined;
    if (this.restAfterMs > 0) {
      this.restTimer = setInterval(() => void this.restIdleSessions(), 60_000);
      this.restTimer.unref?.();
    }
  }

  /** Visible for tests: one pass of the idle sweep. */
  async restIdleSessions(now = Date.now()): Promise<void> {
    if (this.restAfterMs <= 0) return;
    for (const session of this.sessions.values()) {
      if (!this.canRest(session, now)) continue;
      await this.restSession(session).catch(() => undefined);
    }
  }

  private canRest(session: BrowserSession, now: number): boolean {
    const contents = session.view.webContents;
    return (
      !session.resting &&
      session.key !== this.activeKey &&
      !session.sessionId.startsWith("comparison-") &&
      session.lastActiveAt !== undefined &&
      now - session.lastActiveAt >= this.restAfterMs &&
      !session.loading &&
      !session.devToolsOpen &&
      !session.assignedTaskId &&
      session.controller !== "agent" &&
      !session.temporaryAgentTab &&
      !session.pendingPermission &&
      !(session.pictureInPictureWindow && !session.pictureInPictureWindow.isDestroyed()) &&
      !session.journeyRecorder?.status().recording &&
      Boolean(session.currentUrl) &&
      session.currentUrl !== "about:blank" &&
      !contents.isDestroyed()
    );
  }

  private async restSession(session: BrowserSession): Promise<void> {
    const contents = session.view.webContents;
    const history = contents.navigationHistory;
    const historyIndex = history.getActiveIndex();
    if (historyIndex < 0) return;
    session.resting = {
      snapshot: { ...this.snapshotSession(session), resting: true },
      historyIndex,
    };
    this.emitRestingState(session);
    try {
      await contents.loadURL("about:blank");
    } catch {
      // A failed placeholder load still leaves the page unloaded or intact;
      // either way waking returns to the saved entry.
    }
  }

  /** Bring a resting page back to the entry it rested on. Safe to call anytime. */
  private async wakeSession(session: BrowserSession): Promise<void> {
    const resting = session.resting;
    if (!resting) return;
    const contents = session.view.webContents;
    session.resting = undefined;
    // Restore what the UI was showing before the placeholder overwrote it.
    session.currentUrl = resting.snapshot.currentUrl;
    session.pageTitle = resting.snapshot.pageTitle;
    if (contents.isDestroyed()) return;
    const history = contents.navigationHistory;
    const placeholder = history.getActiveIndex();
    try {
      if (history.canGoToOffset(resting.historyIndex - placeholder)) {
        history.goToIndex(resting.historyIndex);
        // Drop the blank placeholder so Back and Forward behave as before.
        if (placeholder !== resting.historyIndex) history.removeEntryAtIndex(placeholder);
      } else if (resting.snapshot.currentUrl) {
        await this.loadUrl(session, resting.snapshot.currentUrl);
      }
    } catch {
      if (resting.snapshot.currentUrl) {
        await this.loadUrl(session, resting.snapshot.currentUrl).catch(() => undefined);
      }
    }
    this.emitState(session);
  }

  private emitRestingState(session: BrowserSession): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || !session.resting) return;
    window.webContents.send("desktop:browser-host:session-state", session.resting.snapshot);
  }

  hideActiveSession(): void {
    if (!this.activeKey) return;
    const session = this.sessions.get(this.activeKey);
    if (session) {
      session.lastActiveAt = Date.now();
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

  /** Stop the current load; the page keeps whatever it has painted so far. */
  stop(input: DesktopBrowserHostControlInput): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || session.view.webContents.isDestroyed()) return;
    session.view.webContents.stop();
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

  /** Find text in the page of one browser tab. Highlights stay until `stopFind`. */
  find(
    input: DesktopBrowserHostControlInput & {
      text: string;
      forward?: boolean;
      findNext?: boolean;
    },
  ): Promise<BrowserFindResult> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || session.view.webContents.isDestroyed()) {
      return Promise.resolve({ matches: 0, activeMatch: 0 });
    }
    return findInPage(session.view.webContents, input.text, {
      ...(input.forward === undefined ? {} : { forward: input.forward }),
      ...(input.findNext === undefined ? {} : { findNext: input.findNext }),
    });
  }

  stopFind(input: DesktopBrowserHostControlInput): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || session.view.webContents.isDestroyed()) return;
    stopFindInPage(session.view.webContents);
  }

  setAudioMuted(input: DesktopBrowserHostControlInput & { audioMuted: boolean }): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    session.audioMuted = input.audioMuted;
    session.view.webContents.setAudioMuted(input.audioMuted);
    this.emitState(session);
  }

  async setColorScheme(
    input: DesktopBrowserHostControlInput & {
      colorScheme: "system" | "light" | "dark";
    },
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
      session.view.webContents.openDevTools({
        mode: DOCKED_DEVTOOLS_MODE,
        activate: false,
      });
    }
  }

  quickActionToken(session: BrowserSession): string {
    return `${this.quickActionPageToken(session)}:${session.controlEpoch}`;
  }

  quickActionPageToken(session: BrowserSession): string {
    return `${session.view.webContents.id}:${session.quickAction?.revision ?? 0}`;
  }

  private quickActionTargets(
    ...args: Parameters<typeof quickActionTargets>
  ): ReturnType<typeof quickActionTargets> {
    return quickActionTargets.apply(this, args);
  }

  async pickQuickActionControl(
    ...args: Parameters<typeof pickQuickActionControl>
  ): ReturnType<typeof pickQuickActionControl> {
    return pickQuickActionControl.apply(this, args);
  }

  private async runQuickActionOperation(
    ...args: Parameters<typeof runQuickActionOperation>
  ): ReturnType<typeof runQuickActionOperation> {
    return runQuickActionOperation.apply(this, args);
  }

  private async enterQuickActionFileResult(
    ...args: Parameters<typeof enterQuickActionFileResult>
  ): ReturnType<typeof enterQuickActionFileResult> {
    return enterQuickActionFileResult.apply(this, args);
  }

  pageReference(session: BrowserSession, url: string): string {
    return createHmac("sha256", this.pageReferenceKey)
      .update(
        JSON.stringify([
          session.projectId,
          session.sessionId,
          session.instanceId,
          session.partition,
          url,
        ]),
      )
      .digest("hex");
  }

  pageApprovalToken(session: BrowserSession): string {
    return [
      session.instanceId,
      session.controlEpoch,
      session.pageRevision ?? 0,
      session.inPageApprovalRevision ?? 0,
    ].join(":");
  }

  checkPageApproval(session: BrowserSession, token: unknown): void {
    if (
      token !== undefined &&
      (token !== this.pageApprovalToken(session) || session.view.webContents.isLoadingMainFrame())
    )
      throw new Error("The page changed during review. Review the current page before approving.");
  }

  private async readBrowserSelection(
    ...args: Parameters<typeof readBrowserSelection>
  ): ReturnType<typeof readBrowserSelection> {
    return readBrowserSelection.apply(this, args);
  }

  private async enterAttachedPage(
    ...args: Parameters<typeof enterAttachedPage>
  ): ReturnType<typeof enterAttachedPage> {
    return enterAttachedPage.apply(this, args);
  }

  attachmentThread(
    ...args: Parameters<typeof attachmentThread>
  ): ReturnType<typeof attachmentThread> {
    return attachmentThread.apply(this, args);
  }

  attachmentBookmark(
    ...args: Parameters<typeof attachmentBookmark>
  ): ReturnType<typeof attachmentBookmark> {
    return attachmentBookmark.apply(this, args);
  }

  bookmarkForScreenshotDraft(
    ...args: Parameters<typeof bookmarkForScreenshotDraft>
  ): ReturnType<typeof bookmarkForScreenshotDraft> {
    return bookmarkForScreenshotDraft.apply(this, args);
  }

  private saveVerifiedScreenshotDraft(
    ...args: Parameters<typeof saveVerifiedScreenshotDraft>
  ): ReturnType<typeof saveVerifiedScreenshotDraft> {
    return saveVerifiedScreenshotDraft.apply(this, args);
  }

  private stageComparisonDraft(
    ...args: Parameters<typeof stageComparisonDraft>
  ): ReturnType<typeof stageComparisonDraft> {
    return stageComparisonDraft.apply(this, args);
  }

  revokeScreenshotAttempts(
    ...args: Parameters<typeof revokeScreenshotAttempts>
  ): ReturnType<typeof revokeScreenshotAttempts> {
    return revokeScreenshotAttempts.apply(this, args);
  }

  private async captureAttachedPage(
    ...args: Parameters<typeof captureAttachedPage>
  ): ReturnType<typeof captureAttachedPage> {
    return captureAttachedPage.apply(this, args);
  }

  private async enterSavedAttachedPage(
    ...args: Parameters<typeof enterSavedAttachedPage>
  ): ReturnType<typeof enterSavedAttachedPage> {
    return enterSavedAttachedPage.apply(this, args);
  }

  private async enterSavedScreenshotDraft(
    ...args: Parameters<typeof enterSavedScreenshotDraft>
  ): ReturnType<typeof enterSavedScreenshotDraft> {
    return enterSavedScreenshotDraft.apply(this, args);
  }

  readDeviceComparisonDraft(
    ...args: Parameters<typeof readDeviceComparisonDraft>
  ): ReturnType<typeof readDeviceComparisonDraft> {
    return readDeviceComparisonDraft.apply(this, args);
  }

  private findDeviceComparisonDraft(
    ...args: Parameters<typeof findDeviceComparisonDraft>
  ): ReturnType<typeof findDeviceComparisonDraft> {
    return findDeviceComparisonDraft.apply(this, args);
  }

  private async enterDeviceComparisonDraft(
    ...args: Parameters<typeof enterDeviceComparisonDraft>
  ): ReturnType<typeof enterDeviceComparisonDraft> {
    return enterDeviceComparisonDraft.apply(this, args);
  }

  async openSavedAttachment(
    ...args: Parameters<typeof openSavedAttachment>
  ): ReturnType<typeof openSavedAttachment> {
    return openSavedAttachment.apply(this, args);
  }

  requireSavedBrowserTarget(
    ...args: Parameters<typeof requireSavedBrowserTarget>
  ): ReturnType<typeof requireSavedBrowserTarget> {
    return requireSavedBrowserTarget.apply(this, args);
  }

  private async enterBrowserWorkflowResult(
    ...args: Parameters<typeof enterBrowserWorkflowResult>
  ): ReturnType<typeof enterBrowserWorkflowResult> {
    return enterBrowserWorkflowResult.apply(this, args);
  }

  private async monitorBrowserWorkflow(
    ...args: Parameters<typeof monitorBrowserWorkflow>
  ): ReturnType<typeof monitorBrowserWorkflow> {
    return monitorBrowserWorkflow.apply(this, args);
  }

  private async runPartnerCenterStatus(
    ...args: Parameters<typeof runPartnerCenterStatus>
  ): ReturnType<typeof runPartnerCenterStatus> {
    return runPartnerCenterStatus.apply(this, args);
  }

  requireCurrentFigmaCanvasReview(
    ...args: Parameters<typeof requireCurrentFigmaCanvasReview>
  ): ReturnType<typeof requireCurrentFigmaCanvasReview> {
    return requireCurrentFigmaCanvasReview.apply(this, args);
  }

  rejectFigmaCanvasReview(
    ...args: Parameters<typeof rejectFigmaCanvasReview>
  ): ReturnType<typeof rejectFigmaCanvasReview> {
    return rejectFigmaCanvasReview.apply(this, args);
  }

  async inspectFigmaCanvas(
    ...args: Parameters<typeof inspectFigmaCanvas>
  ): ReturnType<typeof inspectFigmaCanvas> {
    return inspectFigmaCanvas.apply(this, args);
  }

  async verifyFigmaCanvasPage(
    ...args: Parameters<typeof verifyFigmaCanvasPage>
  ): ReturnType<typeof verifyFigmaCanvasPage> {
    return verifyFigmaCanvasPage.apply(this, args);
  }

  private async runFigmaCanvas(
    ...args: Parameters<typeof runFigmaCanvas>
  ): ReturnType<typeof runFigmaCanvas> {
    return runFigmaCanvas.apply(this, args);
  }

  private enterFigmaCanvasResult(
    ...args: Parameters<typeof enterFigmaCanvasResult>
  ): ReturnType<typeof enterFigmaCanvasResult> {
    return enterFigmaCanvasResult.apply(this, args);
  }

  isCurrentDeviceEvidencePage(
    ...args: Parameters<typeof isCurrentDeviceEvidencePage>
  ): ReturnType<typeof isCurrentDeviceEvidencePage> {
    return isCurrentDeviceEvidencePage.apply(this, args);
  }

  private async authorizeDeviceComparisonEvidence(
    ...args: Parameters<typeof authorizeDeviceComparisonEvidence>
  ): ReturnType<typeof authorizeDeviceComparisonEvidence> {
    return authorizeDeviceComparisonEvidence.apply(this, args);
  }

  currentDeviceScreenshotGrants(
    ...args: Parameters<typeof currentDeviceScreenshotGrants>
  ): ReturnType<typeof currentDeviceScreenshotGrants> {
    return currentDeviceScreenshotGrants.apply(this, args);
  }

  storeDeviceScreenshotGrants(
    ...args: Parameters<typeof storeDeviceScreenshotGrants>
  ): ReturnType<typeof storeDeviceScreenshotGrants> {
    return storeDeviceScreenshotGrants.apply(this, args);
  }

  async runAutomation(
    request: BrowserAutomationRequest,
    lease?: symbol,
    authorizeDeviceScreenshot?: () => Promise<boolean>,
  ): Promise<unknown> {
    if (request.operation === "findDeviceComparisonDraft")
      return this.findDeviceComparisonDraft(request);
    if (
      request.operation === "enterDeviceComparisonDraft" &&
      (request.source !== "human" || !request.sessionId)
    )
      throw new Error("Open the saved comparison draft from its original thread and tab.");
    if (
      (request.operation === "enterBrowserWorkflowResult" ||
        request.operation === "readWorkflowReceipt") &&
      (request.source !== "human" ||
        typeof request.taskId !== "string" ||
        !request.taskId.trim() ||
        !request.sessionId)
    )
      throw new Error("Open the saved browser result from its thread.");
    if (request.operation === "listQuickActionTargets") {
      if (request.source !== "human") throw new Error("Choose a browser tab in Quick Actions.");
      return this.quickActionTargets(request.projectId, automationInput(request.input).action);
    }
    if (request.operation === "runQuickAction" && request.source === "agent" && !request.sessionId)
      throw new Error("Provide the exact tab ID from the user's Quick Actions approval.");
    const session = this.sessions.get(this.sessionKey(request.projectId, request.sessionId));
    if (!session) throw new Error("The requested browser session was not found.");
    if (
      request.operation !== "revokeBrowserPage" &&
      request.operation !== "revokeDeviceScreenshot" &&
      request.operation !== "revokeQuickAction"
    ) {
      const contents = session.view.webContents;
      const storage = contents.session;
      if (this.storageChanges.has(storage))
        throw new Error(
          "Wait for this browser profile to finish updating site data, then review access.",
        );
      const importTime = this.lastProfileImport.get(storage);
      if (importTime !== undefined || this.lastHttpOnlyCookieChanges.has(storage)) {
        const url = session.resting
          ? (session.resting.snapshot.currentUrl ?? "")
          : contents.getURL();
        const cookieTime = this.lastHttpOnlyCookieChange(storage, url);
        const changedAt = Math.max(importTime ?? 0, cookieTime ?? 0);
        if (changedAt && pageOrigin(url)) {
          const reloadRequired =
            (cookieTime ?? 0) > (importTime ?? 0)
              ? "Reload this page after its browser session changed, then review access."
              : "Reload this page after importing the browser session, then review access.";
          const loading = () => cookieTime !== undefined && contents.isLoadingMainFrame();
          if (session.resting || loading()) throw new Error(reloadRequired);
          const cached = this.checkedProfileDocuments.get(contents);
          const revision = session.pageRevision;
          if (cached?.changedAt !== changedAt || cached.revision !== revision) {
            const epoch = session.controlEpoch;
            // A navigation can start before the cookie change and commit after it.
            const documentTime: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [
              { code: "performance.timeOrigin" },
            ]);
            if (
              typeof documentTime !== "number" ||
              !Number.isFinite(documentTime) ||
              documentTime <= changedAt ||
              this.storageChanges.has(storage) ||
              this.lastProfileImport.get(storage) !== importTime ||
              session.view.webContents !== contents ||
              contents.isDestroyed() ||
              session.pageRevision !== revision ||
              session.controlEpoch !== epoch ||
              this.lastHttpOnlyCookieChange(storage, contents.getURL()) !== cookieTime ||
              loading()
            )
              throw new Error(reloadRequired);
            this.checkedProfileDocuments.set(contents, { changedAt, revision });
          }
        }
      }
    }
    if (request.operation === "authorizeDeviceComparisonEvidence")
      return this.authorizeDeviceComparisonEvidence(session, request);
    if (
      request.operation === "partnerCenterStatus" ||
      request.operation === "authorizePartnerCenterStatus"
    )
      return this.runPartnerCenterStatus(session, request);
    if (request.operation === "figmaCanvas" || request.operation === "authorizeFigmaCanvas")
      return this.runFigmaCanvas(session, request);
    if (request.operation === "enterFigmaCanvasResult")
      return this.enterFigmaCanvasResult(session, request);
    if (request.operation === "enterQuickActionFileResult")
      return this.enterQuickActionFileResult(session, request);
    if (request.operation === "readBrowserSelection")
      return this.readBrowserSelection(session, request);
    if (request.operation === "captureAttachedPage")
      return this.captureAttachedPage(session, request);
    if (request.operation === "enterSavedAttachedPage")
      return this.enterSavedAttachedPage(session, request);
    if (request.operation === "enterSavedScreenshotDraft")
      return this.enterSavedScreenshotDraft(session, request);
    if (request.operation === "enterDeviceComparisonDraft")
      return this.enterDeviceComparisonDraft(session, request);
    if (request.operation === "readWorkflowReceipt")
      return this.enterBrowserWorkflowResult(session, request);
    if (request.operation === "enterBrowserWorkflowResult") {
      const { stage } = await this.enterBrowserWorkflowResult(session, request);
      return { stage };
    }
    if (
      request.operation === "browserWorkflow" &&
      automationInput(request.input).phase === "monitor"
    ) {
      const workflow = Schema.decodeUnknownSync(BrowserWorkflowBrowserRequest)(request.input);
      return this.monitorBrowserWorkflow(session, request, workflow);
    }
    if (
      [
        "authorizeQuickAction",
        "revokeQuickAction",
        "runQuickAction",
        "repairQuickAction",
        "resolveQuickActionStep",
        "enterQuickActionPause",
        "pickQuickActionOutcome",
      ].includes(request.operation)
    )
      return this.runQuickActionOperation(session, request);
    if (request.operation === "enterAttachedPage") {
      if (session.view.webContents.isDestroyed())
        throw new Error("The requested browser session is unavailable.");
      return this.enterAttachedPage(session, request);
    }
    const authorizePair = request.operation === "authorizeDeviceScreenshotPair";
    // An agent driving a resting page gets the real page back first. Only
    // await when resting, so ordinary calls keep their exact ordering.
    if (session.resting && !authorizePair) {
      if (request.source === "agent" && isUserBrowserTab(session.sessionId))
        throw new Error("Approve access in the selected tab’s Browser tools menu.");
      await this.wakeSession(session);
    }
    const contents = session.view.webContents;
    if (contents.isDestroyed()) throw new Error("The requested browser session is unavailable.");
    if (request.operation === "authorizeBrowserSubmission") {
      const approval = this.liveSubmissionApproval(session, contents.getURL());
      const input = automationInput(request.input);
      if (
        request.source !== "human" ||
        !approval ||
        approval.grant.taskId !== request.taskId ||
        approval.id !== input.approvalId
      ) {
        throw new Error("Review the current draft before approving its submission.");
      }
      let selectedFile: { name: string; type: string; bytes: Uint8Array } | undefined;
      if (approval.chooseUploadFile) {
        const { name, type, bytes } = automationInput(input.selectedFile);
        if (
          approval.approved ||
          typeof name !== "string" ||
          !name.trim() ||
          name.length > 300 ||
          /[/\\]/u.test(name) ||
          Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
          typeof type !== "string" ||
          type.length > 255 ||
          /[^\x20-\x7e]/u.test(type) ||
          !(bytes instanceof Uint8Array) ||
          bytes.byteLength === 0 ||
          bytes.byteLength > BROWSER_WORKFLOW_UPLOAD_MAX_BYTES
        )
          throw new Error("Choose one readable file within the guarded upload size limit.");
        selectedFile = { name, type, bytes };
      } else if (input.selectedFile !== undefined) {
        throw new Error("This approval uses the file already staged in the draft.");
      }
      const operation = browserWorkflowPageScript(approval.definition, false, false, {
        currentId: approval.id,
      });
      const result: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [
        { code: `(${PAGE_READY_FOR_AGENT}) ? (${operation}) : null` },
      ]);
      if (
        contents.isDestroyed() ||
        this.sessions.get(session.key) !== session ||
        session.view.webContents !== contents ||
        this.liveSubmissionApproval(session, contents.getURL()) !== approval ||
        (selectedFile && approval.approved)
      ) {
        throw new Error("The draft or its control changed during approval. Review it again.");
      }
      if (
        result === null ||
        Schema.decodeUnknownSync(BrowserWorkflowPageResult)(result).submitControlBinding !==
          "retained"
      ) {
        session.workflowSubmission = undefined;
        this.emitState(session);
        throw new Error(
          approval.chooseUploadFile
            ? "The draft or its file input changed. Ask the thread to check it again."
            : "The draft or its Submit control changed. Ask the thread to check it again.",
        );
      }
      if (selectedFile) {
        const { name, type, bytes } = selectedFile;
        approval.localUpload = {
          name,
          type,
          base64: Buffer.from(bytes).toString("base64"),
        };
      }
      approval.approved = true;
      this.emitState(session);
      return {
        approved: true,
        ...(approval.workflowId && { workflowId: approval.workflowId }),
      };
    }
    if (request.operation === "releaseSubmissionGuard") {
      const { url, instanceId } = automationInput(request.input);
      if (
        request.source !== "human" ||
        typeof url !== "string" ||
        url !== contents.getURL() ||
        typeof instanceId !== "string" ||
        instanceId !== session.instanceId ||
        session.assignedTaskId !== request.taskId
      )
        throw new Error("Choose the original draft before releasing its submission guard.");
      this.submissionGuards.set(session.partition, url, false);
      session.workflowSubmission = undefined;
      this.emitState(session);
      return;
    }
    if (
      request.operation === "authorizeBrowserPage" ||
      request.operation === "revokeBrowserPage" ||
      request.operation === "authorizeDeviceScreenshot" ||
      authorizePair ||
      request.operation === "revokeDeviceScreenshot"
    ) {
      const taskId = request.taskId;
      if (request.source !== "human" || typeof taskId !== "string" || !taskId.trim())
        throw new Error("Choose a device in the browser tab menu to approve this transfer.");
      if (session.assignedTaskId && session.assignedTaskId !== taskId)
        throw new Error("This tab belongs to another thread.");
      if (request.operation === "revokeBrowserPage") {
        this.takeControl(request);
        session.pageGrant = undefined;
        session.deviceUploads?.clear();
        this.assignTabTask({ ...request, taskId: null });
        return;
      }
      const source = automationInput(request.input);
      if (request.operation === "revokeDeviceScreenshot") {
        const revoke = (id: string) => {
          session.deviceUploads?.delete(id);
          this.revokeScreenshotAttempts(session, id);
        };
        if ("grantIds" in source) {
          const { grantIds } = source;
          if (!Array.isArray(grantIds) || !grantIds.every((id) => typeof id === "string"))
            throw new Error("Select the exact screenshot grants to revoke.");
          for (const id of grantIds) revoke(id);
        } else if (typeof source.grantId === "string") revoke(source.grantId);
        else {
          session.deviceUploads?.clear();
          this.revokeScreenshotAttempts(session);
        }
        this.emitState(session);
        return;
      }
      const url = contents.getURL();
      if (
        request.operation === "authorizeBrowserPage" &&
        source.adoptOpenTab === true &&
        (session.assignedTaskId ||
          session.resting ||
          session.verificationLease ||
          session.pendingPermission ||
          session.returningDemonstration ||
          session.actionTimeline.some((action) => action.status === "running") ||
          session.journeyRecorder?.status().recording ||
          typeof source.pageApprovalToken !== "string" ||
          typeof source.instanceId !== "string" ||
          contents.isLoadingMainFrame() ||
          session.currentUrl !== url)
      )
        throw new Error("Finish using the original browser tab before moving it.");
      this.checkPageApproval(session, source.pageApprovalToken);
      if (
        source.url !== url ||
        (source.instanceId !== undefined && source.instanceId !== session.instanceId) ||
        (authorizePair &&
          (typeof source.instanceId !== "string" ||
            session.resting ||
            session.currentUrl !== url ||
            contents.isCrashed() ||
            contents.isLoadingMainFrame())) ||
        session.loading ||
        !/^https?:\/\//i.test(url) ||
        isLikelyAuthenticationUrl(url) ||
        source.profileId !== (session.profileId ?? "default")
      )
        throw new Error(
          "Recheck the device, browser profile and destination page before approving.",
        );
      const scope = getBrowserPageScope(url);
      if (!scope) throw new Error("Open an HTTP or HTTPS destination in the approved profile.");
      if (
        request.operation === "authorizeDeviceScreenshot" &&
        (typeof source.hostId !== "string" ||
          !source.hostId ||
          typeof source.deviceId !== "string" ||
          !source.deviceId)
      )
        throw new Error("Select the exact device and host before approving.");
      const pair = authorizePair ? screenshotPair(source.frames) : undefined;
      const frame =
        !pair && source.frame !== undefined
          ? Schema.decodeUnknownSync(DeviceComparisonFrame)(source.frame)
          : undefined;
      if (session.humanControlLocked && session.assignedTaskId)
        throw new Error("Return control to the thread before granting access.");
      const alreadyAllowed = currentThreadPageGrant(session, taskId, url);
      const retainedGrants = pair ? this.currentDeviceScreenshotGrants(session, taskId, url) : [];
      if (pair && retainedGrants.length + pair.length > MAX_DEVICE_SCREENSHOT_GRANTS)
        throw new Error("Finish or revoke a pending screenshot transfer before adding another.");
      if (pair && !alreadyAllowed && session.returningDemonstration)
        throw new Error("The browser is already returning control.");
      if (pair) this.updateTabTask(session, taskId);
      else this.assignTabTask({ ...request, taskId });
      if (
        pair ||
        request.operation === "authorizeBrowserPage" ||
        source.allowPageControl === true
      ) {
        const discardedConsent = !!(
          session.partnerCenterStatus || session.figmaCanvasReview?.consent
        );
        session.partnerCenterStatus = undefined;
        session.figmaCanvasReview = undefined;
        session.pageGrant = {
          ...scope,
          taskId,
          partition: session.partition,
          scopeLabel: describeBrowserPageScope(scope, session.profileId ?? "default"),
        };
        await this.captureAccountMarker(session, contents);
        if (!alreadyAllowed) {
          // The new grant replaces any demonstration grant, so no guest work is needed.
          if (pair) this.returnControlToAgent(session);
          else await this.resumeAgent(request);
        }
        if (request.operation === "authorizeBrowserPage") {
          if (alreadyAllowed && discardedConsent) this.emitState(session);
          return { approved: true, scopeLabel: session.pageGrant.scopeLabel };
        }
      }
      if (!pair && session.deviceUploads) {
        for (const [key, grant] of session.deviceUploads)
          if (grant.epoch !== session.controlEpoch) session.deviceUploads.delete(key);
        if (session.deviceUploads.size >= MAX_DEVICE_SCREENSHOT_GRANTS)
          throw new Error("Finish or revoke a pending screenshot transfer before adding another.");
      }
      const screenshots =
        pair ??
        ([
          {
            hostId: source.hostId as string,
            deviceId: source.deviceId as string,
            ...(frame ? { frame } : {}),
          },
        ] as const);
      const grantIds = this.storeDeviceScreenshotGrants(
        session,
        taskId,
        url,
        screenshots,
        pair ? retainedGrants : undefined,
      );
      return pair ? { grantIds } : { grantId: grantIds[0]! };
    }
    const attachedPage = request.source === "agent" && isUserBrowserTab(session.sessionId);
    const managedPage = attachedPage && request.operation !== "deviceScreenshotUpload";
    const checkPage = (url?: string) => {
      if (["click", "press", "type", "evaluate", "verify"].includes(request.operation))
        this.checkSubmissionGuard(session);
      const grant =
        !contents.isDestroyed() && session.view.webContents === contents
          ? currentThreadPageGrant(session, request.taskId, url ?? contents.getURL())
          : undefined;
      if (!grant)
        throw new Error(
          "Approve access to this page and profile in Browser tools, or finish signing in yourself.",
        );
      const destination = automationInput(request.input).url;
      if (
        request.operation === "navigate" &&
        (typeof destination !== "string" || !matchesPageScope(grant, destination))
      )
        throw new Error("Open the new destination yourself and approve access there.");
      if (
        ["evaluate", "recordStart", "recordStatus", "recordStop", "verify"].includes(
          request.operation,
        )
      )
        throw new Error(
          "Use the approved page controls or a user-approved Quick Action for this tab.",
        );
      return grant;
    };
    const readPage = (code: string, userGesture = false, isolateUnmanaged = false) => {
      if (!managedPage && !isolateUnmanaged) return contents.executeJavaScript(code, userGesture);
      const url = contents.getURL();
      if (managedPage) checkPage(url);
      return contents.executeJavaScriptInIsolatedWorld(
        999,
        [
          {
            code: `location.href === ${JSON.stringify(url)} ? (${code}) : (() => { throw new Error("The approved page changed."); })()`,
          },
        ],
        userGesture,
      );
    };
    const protectedPageMessage =
      "Take over this page to complete protected input or account selection.";
    const checkProtectedPage = async () => {
      checkPage();
      const epoch = session.controlEpoch;
      const safe = await readPage(PAGE_READY_FOR_AGENT);
      checkPage();
      if (session.controlEpoch !== epoch || safe !== true) throw new Error(protectedPageMessage);
    };
    const trackPageAction = <T>(
      target: BrowserSession,
      action: string,
      run: () => Promise<T>,
      taskId?: string,
      checkCurrent?: () => void,
    ) =>
      this.trackAutomation(
        target,
        action,
        managedPage || checkCurrent
          ? async () => {
              if (managedPage) {
                await checkProtectedPage();
                await this.checkAccountMarker(session, contents);
                if (["click", "press", "type"].includes(request.operation))
                  await this.checkSubmissionIdentity(session, contents);
              }
              checkCurrent?.();
              const result = await run();
              if (managedPage) {
                if (request.operation === "snapshot") await checkProtectedPage();
                else checkPage();
              }
              checkCurrent?.();
              return result;
            }
          : run,
        taskId,
        request.source,
      );
    if (managedPage) {
      checkPage();
      if (request.operation === "assertControl" || request.operation === "status")
        await checkProtectedPage();
    }
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
    if (request.operation === "browserWorkflow") {
      const requested = Schema.decodeUnknownSync(BrowserWorkflowBrowserRequest)(input);
      checkGuardedWorkflowDefinition(requested.definition);
      const readOnly = requested.definition.readOnly === true;
      const attempt = requested.phase === "submit" || requested.phase === "upload";
      if (readOnly && attempt) throw new Error("A read-only workflow cannot upload or submit.");

      const draftUrl = contents.getURL();
      const bindCurrentDraft =
        requested.phase === "inspect" &&
        !requested.target &&
        !requested.workflowId &&
        !requested.statusOnly &&
        requested.definition.url !== draftUrl &&
        requested.definition.url === grantedPageAddress(draftUrl);
      if (
        bindCurrentDraft &&
        (!isBrowserAttachmentUrl(draftUrl) ||
          !Schema.is(BrowserWorkflowBrowserRequest.fields.definition.fields.url)(draftUrl))
      )
        throw new Error("Open a stable draft URL without sign-in or access credentials.");
      const workflow = bindCurrentDraft
        ? {
            ...requested,
            definition: { ...requested.definition, url: draftUrl },
          }
        : requested;
      const statusOnly = readOnly || workflow.statusOnly === true;
      const profileId = session.profileId ?? "default";
      const storagePath = contents.session.storagePath;
      if (
        !managedPage ||
        !storagePath ||
        profileId !== workflow.profileId ||
        !matchesPageScope(checkPage(), workflow.definition.url)
      ) {
        throw new Error("The workflow requires its selected persistent browser profile.");
      }
      const target = {
        projectId: session.projectId,
        tabId: PreviewTabId.make(session.sessionId),
        profileId,
        hostKey: browserWorkflowHostKey(app.getPath("userData"), storagePath),
      };
      const expected = workflow.target;
      if (
        expected
          ? expected.projectId !== target.projectId ||
            expected.tabId !== target.tabId ||
            expected.profileId !== target.profileId ||
            expected.hostKey !== target.hostKey
          : workflow.phase !== "inspect"
      ) {
        throw new Error("The workflow belongs to another browser host, profile or tab.");
      }
      const { instanceId, pageGrant, controlEpoch, pageRevision, inPageApprovalRevision } = session;
      const checkBoundDraft = () => {
        if (
          bindCurrentDraft &&
          (this.sessions.get(session.key) !== session ||
            session.view.webContents !== contents ||
            contents.isDestroyed() ||
            session.instanceId !== instanceId ||
            session.pageGrant !== pageGrant ||
            session.controlEpoch !== controlEpoch ||
            session.pageRevision !== pageRevision ||
            session.inPageApprovalRevision !== inPageApprovalRevision ||
            session.loading ||
            contents.isLoadingMainFrame() ||
            contents.getURL() !== draftUrl)
        )
          throw new Error("The approved browser draft changed. Inspect its current page again.");
      };
      const page = await trackPageAction(
        session,
        attempt ? `check breakpoint and ${workflow.phase}` : "inspect workflow status",
        async () => {
          checkBoundDraft();
          const currentUrl = contents.getURL();
          const readOnCurrentPage =
            currentUrl === workflow.definition.url &&
            (readOnly ||
              workflow.definition.uploadSelector ||
              workflow.definition.uploadInputSelector);
          const shouldNavigate =
            workflow.phase === "refresh" || (workflow.phase === "enter" && !readOnCurrentPage);
          if (
            shouldNavigate &&
            (!readOnly ||
              (!session.workflowSubmission &&
                !this.submissionGuards.has(session.partition, currentUrl)))
          ) {
            await this.loadUrl(session, workflow.definition.url, true);
            await checkProtectedPage();
          }
          const grant = checkPage();
          const { controlEpoch: epoch, pageRevision, inPageApprovalRevision } = session;
          const observationUrl = contents.getURL();
          const candidate =
            expected && !statusOnly
              ? this.liveSubmissionApproval(session, observationUrl)
              : undefined;
          const approval =
            candidate &&
            candidate.workflowId === workflow.workflowId &&
            isDeepStrictEqual(candidate.definition, workflow.definition)
              ? candidate
              : undefined;
          const action = workflow.phase === "upload" ? "upload" : "submit";
          const mayActivate =
            attempt &&
            approval?.approved === true &&
            (approval.chooseUploadFile
              ? action === "upload" && !!approval.localUpload
              : approval.uploadFile
                ? action === "upload"
                : action === "submit");
          const nextId = expected && !statusOnly ? randomUUID() : undefined;
          if (mayActivate) session.workflowSubmission = undefined;
          const operation = browserWorkflowPageScript(
            workflow.definition,
            mayActivate,
            statusOnly,
            statusOnly
              ? undefined
              : {
                  ...(approval && { currentId: approval.id }),
                  ...(nextId !== undefined && { nextId }),
                },
            action,
            mayActivate ? approval.localUpload : undefined,
          );
          const result: unknown = await readPage(
            `(${PAGE_READY_FOR_AGENT}) ? (${operation}) : ({
                disposition: "unobservable",
                reason: "Protected input or a frame requires human review."
              })`,
          );
          checkBoundDraft();
          const {
            submitControlBinding,
            submitControlLabel,
            uploadFile,
            chooseUploadFile,
            siteSubmissionKey,
            ...checked
          } = Schema.decodeUnknownSync(BrowserWorkflowPageResult)(result);
          if (readOnly) {
            if (
              session.pageGrant !== grant ||
              session.controlEpoch !== epoch ||
              session.pageRevision !== pageRevision ||
              session.inPageApprovalRevision !== inPageApprovalRevision ||
              contents.getURL() !== observationUrl ||
              contents.isLoadingMainFrame()
            )
              throw new Error("The workflow page changed while reading its status.");
            return { ...checked, submissionApproved: false };
          }
          if (
            (checked.observation?.stage === "uploaded" ||
              checked.observation?.stage === "ready_to_upload") &&
            checked.disposition === "observed" &&
            contents.getURL() === workflow.definition.url
          ) {
            // An inspection uses caller-supplied labels. It cannot release an existing guard.
            this.submissionGuards.set(session.partition, workflow.definition.url, true, {
              selector: workflow.definition.identitySelector,
              resourceId: workflow.definition.resourceId,
            });
          }
          if (
            expected &&
            !statusOnly &&
            session.controlEpoch === epoch &&
            session.pageGrant === grant &&
            !session.loading &&
            contents.getURL() === workflow.definition.url
          ) {
            if (submitControlBinding === "bound" && nextId) {
              session.workflowSubmission = {
                id: nextId,
                ...(workflow.workflowId && { workflowId: workflow.workflowId }),
                definition: workflow.definition,
                grant,
                epoch,
                approved: false,
                ...(submitControlLabel && { controlLabel: submitControlLabel }),
                ...(uploadFile && { uploadFile }),
                ...(chooseUploadFile && { chooseUploadFile }),
                ...(siteSubmissionKey && { siteSubmissionKey }),
              };
            } else if (
              submitControlBinding !== "retained" &&
              session.workflowSubmission === approval
            ) {
              session.workflowSubmission = undefined;
            }
          }
          return {
            ...checked,
            submissionApproved:
              !attempt &&
              submitControlBinding === "retained" &&
              approval?.approved === true &&
              this.liveSubmissionApproval(session, contents.getURL()) === approval,
          };
        },
        request.taskId,
      );
      checkBoundDraft();
      if (!readOnly && page.observation?.breakpoint === "matched") this.takeControl(request);
      return {
        ...page,
        target,
        ...(bindCurrentDraft &&
          page.disposition === "observed" &&
          page.observation && {
            resolvedDraftUrl: draftUrl,
          }),
      };
    }
    if (request.operation === "deviceScreenshotUpload") {
      const requireCurrent = (grant: DeviceScreenshotGrant | undefined) => {
        this.checkSubmissionGuard(session);
        if (
          !grant ||
          grant.id !== input.grantId ||
          request.source !== "agent" ||
          grant.taskId !== request.taskId ||
          grant.epoch !== session.controlEpoch ||
          grant.partition !== session.partition ||
          contents.isDestroyed() ||
          grant.url !== contents.getURL() ||
          session.controller === "human" ||
          session.loading ||
          this.sessions.get(session.key) !== session ||
          session.view.webContents !== contents ||
          (grant.firstDifference &&
            !this.isCurrentDeviceEvidencePage(session, contents, request, grant))
        )
          throw new Error("Approve this screenshot transfer again in the destination tab.");
        return grant;
      };
      const requireGrant = () =>
        requireCurrent(
          typeof input.grantId === "string" ? session.deviceUploads?.get(input.grantId) : undefined,
        );
      const requireCurrentAttempt = (attempt: DeviceScreenshotAttempt) => {
        const { grant } = attempt;
        requireCurrent(grant);
        if (
          session.screenshotAttempts?.get(grant.id) !== attempt ||
          attempt.contents !== contents ||
          attempt.instanceId !== session.instanceId ||
          attempt.pageRevision !== session.pageRevision ||
          attempt.navigationStarted ||
          session.assignedTaskId !== grant.taskId ||
          contents.isLoadingMainFrame() ||
          input.selector !== attempt.selector
        )
          throw new Error("The original screenshot selection changed. Inspect the draft.");
      };
      const recordSelection = (attempt: DeviceScreenshotAttempt) => {
        if (attempt.recorded) return;
        attempt.recorded = true;
        const drafts = (session.screenshotDrafts ??= []);
        drafts.push(attempt.draft);
        if (drafts.length > 32) drafts.shift();
        if (!attempt.cancelCheckpoint) this.stageComparisonDraft(session, attempt, "selected");
        attempt.cancelCheckpoint = undefined;
      };
      const previous =
        typeof input.grantId === "string"
          ? session.screenshotAttempts?.get(input.grantId)
          : undefined;
      if (previous && input.phase === "inspect") {
        const { grant, selector } = previous;
        requireCurrentAttempt(previous);
        const selected = await contents.executeJavaScriptInIsolatedWorld(999, [
          {
            code: selectedDeviceScreenshotScript(grant.url, selector, grant.id),
          },
        ]);
        requireCurrentAttempt(previous);
        if (selected !== true)
          throw new Error("The original screenshot selection changed. Inspect the draft.");
        recordSelection(previous);
        return {
          hostId: grant.hostId,
          deviceId: grant.deviceId,
          ...(grant.firstDifference ? { firstDifference: grant.firstDifference } : {}),
          selection: {
            ...(previous.frame ? { frame: previous.frame } : {}),
            sha256: previous.draft.digest,
            sizeBytes: previous.sizeBytes,
          },
        };
      }
      const grant = requireGrant();
      if (input.phase === "inspect") {
        if (typeof input.selector !== "string")
          throw new Error("Select the file input on the approved page.");
        const matched = await contents.executeJavaScriptInIsolatedWorld(999, [
          {
            code: deviceScreenshotInputScript(
              grant.url,
              input.selector,
              null,
              grant.id,
              Array.from(session.deviceUploads?.keys() ?? []),
              grant.pairedGrantId,
            ),
          },
        ]);
        requireGrant();
        if (matched !== true)
          throw new Error("Choose one empty enabled file input on the approved page.");
        return {
          deviceId: grant.deviceId,
          hostId: grant.hostId,
          ...(grant.frame ? { frame: grant.frame } : {}),
          ...(grant.firstDifference ? { firstDifference: grant.firstDifference } : {}),
        };
      }
      const approvedFrame = grant.firstDifference ?? grant.frame;
      const frame = Schema.is(DeviceComparisonFrame)(input.frame) ? input.frame : undefined;
      if (
        input.phase !== "attach" ||
        typeof input.png !== "string" ||
        typeof input.selector !== "string" ||
        input.hostId !== grant.hostId ||
        input.deviceId !== grant.deviceId ||
        (approvedFrame
          ? !frame ||
            approvedFrame.runId !== frame.runId ||
            approvedFrame.side !== frame.side ||
            (grant.frame !== undefined && grant.frame.step !== frame.step)
          : input.frame !== undefined)
      )
        throw new Error("Screenshot source does not match the approved device.");
      if (!authorizeDeviceScreenshot)
        throw new Error("Device screenshot transfer requires current device authorization.");
      const expression = deviceScreenshotInputScript(
        grant.url,
        input.selector,
        input.png,
        grant.id,
        undefined,
        grant.pairedGrantId,
      );
      return trackPageAction(
        session,
        "attach device screenshot",
        async () => {
          requireGrant();
          const pageRef = this.pageReference(session, grant.url);
          const bytes = Buffer.from(input.png as string, "base64");
          const attempt: DeviceScreenshotAttempt = {
            grant,
            contents,
            instanceId: session.instanceId,
            pageRevision: session.pageRevision,
            selector: input.selector as string,
            sizeBytes: bytes.length,
            frame: frame && { ...frame },
            draft: {
              grantId: grant.id,
              ...(grant.pairedGrantId ? { pairedGrantId: grant.pairedGrantId } : {}),
              taskId: grant.taskId,
              partition: grant.partition,
              url: grant.url,
              pageRef,
              ...(grant.pairedGrantId && frame ? { comparisonFrame: { ...frame } } : {}),
              ...(grant.firstDifference ? { exactDraftUrl: true } : {}),
              ...(grant.firstDifference && grant.verifyScreenshotImages
                ? { verifyScreenshotImages: true }
                : {}),
              digest: createHash("sha256").update(bytes).digest("hex"),
            },
            recorded: false,
          };
          const storage = contents.session;
          const importTime = this.lastProfileImport.get(storage);
          const cookieTime = this.lastHttpOnlyCookieChange(storage, grant.url);
          const accountChanged = () =>
            this.storageChanges.has(storage) ||
            this.lastProfileImport.get(storage) !== importTime ||
            this.lastHttpOnlyCookieChange(storage, grant.url) !== cookieTime;
          // The queue and surface preparation have settled. Recheck the page after the RPC.
          if (!(await authorizeDeviceScreenshot()))
            throw new Error("Device access changed. Approve a new screenshot transfer.");
          if (
            requireGrant() !== grant ||
            session.instanceId !== attempt.instanceId ||
            session.pageRevision !== attempt.pageRevision ||
            session.assignedTaskId !== grant.taskId ||
            contents.isLoadingMainFrame() ||
            accountChanged()
          )
            throw new Error("Approve this screenshot transfer again in the destination tab.");

          // Reserve before dispatch. A disconnect after the input event must not repeat it.
          session.deviceUploads?.delete(grant.id);
          const attempts = (session.screenshotAttempts ??= new Map());
          if (attempts.size >= 32) {
            const oldest = attempts.keys().next();
            if (!oldest.done) attempts.delete(oldest.value);
          }
          attempts.set(grant.id, attempt);
          // A saved draft can outlive a lost selection reply. Recovery must hash both PNGs.
          attempt.cancelCheckpoint = this.stageComparisonDraft(session, attempt, "before-dispatch");
          attempt.dispatching = true;
          let attached: unknown;
          try {
            attached = await contents.executeJavaScriptInIsolatedWorld(999, [{ code: expression }]);
          } finally {
            attempt.dispatching = false;
            if (attempt.navigationStarted && attempts.get(grant.id) === attempt)
              attempts.delete(grant.id);
          }
          if (attached === false) attempt.cancelCheckpoint?.();
          requireCurrentAttempt(attempt);
          if (accountChanged())
            throw new Error("Approve this screenshot transfer again in the destination tab.");
          if (attached !== true)
            throw new Error("No unique enabled file input matched on the approved page.");
          recordSelection(attempt);
          return { attached: true };
        },
        request.taskId,
      );
    }
    if (request.operation === "navigate") {
      if (typeof input.url !== "string") throw new Error("Navigation URL is required.");
      return trackPageAction(
        session,
        "navigate",
        () => this.loadUrl(session, input.url as string, true),
        request.source === "human" ? (session.assignedTaskId ?? undefined) : request.taskId,
      );
    }
    if (request.operation === "recordStart") {
      session.journeyRecorder ??= new JourneyRecorder(contents, session.cdpCoordinator);
      if (request.source === "human") {
        if (input.quickAction === true && isLikelyAuthenticationUrl(contents.getURL()))
          throw new Error("Open the signed-in workflow before recording a Quick Action.");
        await session.journeyRecorder.start(input.quickAction === true);
        return session.journeyRecorder.status();
      }
      await trackPageAction(
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
      return trackPageAction(
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
        url: managedPage ? grantedPageAddress(contents.getURL()) : session.currentUrl,
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
      return trackPageAction(
        session,
        "evaluate",
        () => readPage(input.expression as string, true),
        request.taskId,
      );
    }

    if (request.operation === "snapshot") {
      const findText =
        input.findText === undefined
          ? undefined
          : Schema.decodeUnknownSync(PreviewAutomationFindText)(input.findText);
      const snapshotPageCheck = () => {
        const url = contents.getURL();
        const {
          instanceId,
          pageRevision,
          mainFrameNavigationRevision,
          inPageApprovalRevision,
          controlEpoch,
        } = session;
        return () => {
          if (
            this.sessions.get(session.key) !== session ||
            session.view.webContents !== contents ||
            session.instanceId !== instanceId ||
            session.pageRevision !== pageRevision ||
            session.mainFrameNavigationRevision !== mainFrameNavigationRevision ||
            session.inPageApprovalRevision !== inPageApprovalRevision ||
            session.controlEpoch !== controlEpoch ||
            contents.isDestroyed() ||
            contents.isCrashed() ||
            contents.isLoadingMainFrame() ||
            contents.getURL() !== url
          )
            throw new Error("The observed page changed. Take a fresh snapshot.");
        };
      };
      let checkSnapshotPage = findText === undefined ? undefined : snapshotPageCheck();
      return trackPageAction(
        session,
        "snapshot",
        async () => {
          const pageUrl = contents.getURL();
          const { pageRevision, controlEpoch } = session;
          const checkImageReceiptMode = managedPage && (session.screenshotDrafts?.length ?? 0) > 0;
          if (checkImageReceiptMode) checkSnapshotPage ??= snapshotPageCheck();
          const snapshotExpression = `(() => ({
          visibleText: (document.body?.innerText || "").slice(0, 20000),
          interactiveElements: [...document.querySelectorAll(
            'a[href],button,input,select,textarea,[role="button"],[role="link"],[tabindex]'
          )].slice(0, 200).map((element) => {
            const rect = element.getBoundingClientRect();
            const selectorFor = ${SNAPSHOT_SELECTOR};
            return {
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute("role"),
              name: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 500),
              selector: selectorFor(element),
              x: rect.x, y: rect.y, width: rect.width, height: rect.height
            };
          })${findText === undefined ? "" : `,\n          textMatches: ${snapshotTextMatchesExpression(findText)}`}
          ${checkImageReceiptMode ? `, imageReceipts: (${SCREENSHOT_RECEIPT_MODE}) === ${JSON.stringify(SCREENSHOT_IMAGE_RECEIPTS)}` : ""}
        }))()`;
          // A protected field can appear between the initial check and the DOM read.
          const guardedRead = managedPage && findText !== undefined;
          const page = await readPage(
            guardedRead
              ? `(${PAGE_READY_FOR_AGENT}) ? (${snapshotExpression}) : null`
              : snapshotExpression,
            true,
            findText !== undefined,
          );
          if (guardedRead && page === null) throw new Error(protectedPageMessage);
          checkSnapshotPage?.();
          let accessibilityTree: unknown = null;
          try {
            if (!managedPage)
              accessibilityTree = await session.cdpCoordinator.withSession(
                "automation",
                async (debuggerApi) => {
                  return await debuggerApi.sendCommand("Accessibility.getFullAXTree");
                },
              );
          } catch {
            accessibilityTree = null;
          }
          checkSnapshotPage?.();
          const bytes = await this.captureSessionImage(session, managedPage);
          checkSnapshotPage?.();
          const image = nativeImage.createFromBuffer(bytes);
          if (managedPage && pageUrl !== contents.getURL())
            throw new Error("The observed page changed. Take a fresh snapshot.");
          let verifiedEvidenceDraft:
            | (DeviceComparisonResultRef & { receiptKind: "image" })
            | undefined;
          let verifiedScreenshotDraft: { sha256: string; receiptKind: "image" } | undefined;
          let unverifiedScreenshotDraft: { sha256: string; receiptKind: "pageText" } | undefined;
          if (managedPage) {
            await checkProtectedPage();
            checkSnapshotPage?.();
            session.lastScreen = {
              digest: createHash("sha256").update(bytes).digest("hex"),
              epoch: session.controlEpoch,
              url: pageUrl,
              zoom: contents.getZoomFactor(),
            };
            const receiptChecks = new Map<string, ScreenshotReceiptKind | false>();
            const hasLiveReceipts = async (
              draft: ScreenshotDraft,
              paired?: ScreenshotDraft,
            ): Promise<ScreenshotReceiptKind | false> => {
              if (page.imageReceipts === true) {
                draft.verifyScreenshotImages = true;
                if (paired) paired.verifyScreenshotImages = true;
              }
              const digests = paired ? [draft.digest, paired.digest] : [draft.digest];
              const verifyImages =
                draft.verifyScreenshotImages === true || paired?.verifyScreenshotImages === true;
              const key = `${verifyImages}:${digests.toSorted().join(":")}`;
              const checked = receiptChecks.get(key);
              if (checked !== undefined) return checked;
              const imageReady =
                (await checkAttachmentPage(contents, pageUrl, digests, verifyImages)) === "ready";
              await checkProtectedPage();
              checkSnapshotPage?.();
              if (session.pageRevision !== pageRevision || session.controlEpoch !== controlEpoch)
                throw new Error("The observed page changed. Take a fresh snapshot.");
              const kind = classifyScreenshotReceipt(imageReady, page.visibleText, digests);
              receiptChecks.set(key, kind);
              return kind;
            };
            // Only a matching image counts as verified; matching page text is reported separately.
            const liveReceipt = async (draft: ScreenshotDraft, paired?: ScreenshotDraft) => {
              const kind = await hasLiveReceipts(draft, paired);
              if (kind === "pageText" && !paired)
                unverifiedScreenshotDraft ??= {
                  sha256: draft.digest,
                  receiptKind: "pageText",
                };
              return kind === "image";
            };
            const isCurrentDraft = (draft: ScreenshotDraft) =>
              this.sessions.get(session.key) === session &&
              session.view.webContents === contents &&
              !contents.isDestroyed() &&
              contents.getURL() === pageUrl &&
              !contents.isLoadingMainFrame() &&
              session.pageRevision === pageRevision &&
              session.controlEpoch === controlEpoch &&
              draft.taskId === request.taskId &&
              draft.partition === session.partition &&
              matchesScreenshotDraftUrl(draft, pageUrl) &&
              draft.pageRef === this.pageReference(session, draft.url);
            for (const draft of session.screenshotDrafts ?? []) {
              const other = pairedScreenshotDraft(session, draft);
              const paired =
                other?.verifiedUrl && other.verifiedUrl !== pageUrl ? undefined : other;
              if (
                (!draft.verifiedUrl || (draft.verifiedUrl === pageUrl && draft.bookmarkPending)) &&
                (!draft.pairedGrantId || paired) &&
                isCurrentDraft(draft) &&
                (await liveReceipt(draft, paired)) &&
                isCurrentDraft(draft)
              ) {
                if (
                  draft.verifiedUrl === pageUrl ||
                  (draft.observedUrl === pageUrl &&
                    draft.observedDocumentRevision !== (session.documentRevision ?? 0))
                ) {
                  draft.verifiedUrl = pageUrl;
                  if (this.saveVerifiedScreenshotDraft(session, contents, pageUrl, draft, paired))
                    delete draft.bookmarkPending;
                  else draft.bookmarkPending = true;
                } else {
                  draft.observedUrl = pageUrl;
                  draft.observedDocumentRevision = session.documentRevision ?? 0;
                }
              }
            }
            for (const single of [...(session.screenshotDrafts ?? [])].reverse()) {
              if (
                single.pairedGrantId ||
                single.verifiedUrl !== pageUrl ||
                !isCurrentDraft(single) ||
                !(await liveReceipt(single)) ||
                !isCurrentDraft(single)
              )
                continue;
              let saved;
              try {
                saved = this.attachmentBookmarks.readScreenshotDraft(single.grantId);
              } catch {
                continue;
              }
              const expected = this.bookmarkForScreenshotDraft(session, contents, pageUrl, single);
              if (
                saved &&
                expected &&
                saved.pairedGrantId === undefined &&
                saved.pageRef === single.pageRef &&
                saved.digest === single.digest &&
                Object.entries(expected).every(
                  ([key, value]) => saved[key as keyof BrowserAttachmentBookmark] === value,
                )
              ) {
                verifiedScreenshotDraft = {
                  sha256: single.digest,
                  receiptKind: "image",
                };
                break;
              }
            }
            if (
              session.screenshotDrafts?.length &&
              typeof page.visibleText === "string" &&
              !contents.isLoadingMainFrame() &&
              session.pageRevision === pageRevision &&
              session.controlEpoch === controlEpoch
            ) {
              for (const draft of [...(session.screenshotDrafts ?? [])].reverse()) {
                const frame = draft.comparisonFrame;
                if (
                  frame?.side !== "source" ||
                  draft.taskId !== request.taskId ||
                  draft.partition !== session.partition ||
                  draft.verifiedUrl !== pageUrl
                )
                  continue;
                const paired = pairedScreenshotDraft(session, draft);
                if (paired?.verifiedUrl !== pageUrl || !(await liveReceipt(draft, paired)))
                  continue;
                const bookmark = this.attachmentBookmarks.readDeviceComparisonDraft({
                  projectId: session.projectId,
                  threadId: draft.taskId,
                  runId: frame.runId,
                  step: frame.step,
                });
                if (
                  bookmark &&
                  !bookmark.pending &&
                  bookmark.url === pageUrl &&
                  bookmark.tabId === session.sessionId &&
                  bookmark.partition === session.partition &&
                  bookmark.profileId === (session.profileId ?? "default") &&
                  bookmark.instanceId === session.instanceId &&
                  bookmark.managerId === this.attachmentManagerId &&
                  bookmark.digests[0] === draft.digest &&
                  bookmark.digests[1] === paired.digest
                ) {
                  verifiedEvidenceDraft = {
                    runId: frame.runId,
                    step: frame.step,
                    receiptKind: "image",
                  };
                  break;
                }
              }
            }
          }
          const size = image.getSize();
          return {
            url: managedPage ? grantedPageAddress(contents.getURL()) : contents.getURL(),
            title: contents.getTitle(),
            loading: session.loading,
            visibleText: page.visibleText,
            interactiveElements: page.interactiveElements,
            ...(findText !== undefined && { textMatches: page.textMatches }),
            accessibilityTree: managedPage ? null : accessibilityTree,
            consoleEntries: managedPage ? [] : [...(session.consoleEntries ?? [])],
            networkEntries: managedPage ? [] : [...(session.networkEntries ?? [])],
            actionTimeline: [...(session.actionTimeline ?? [])],
            ...(verifiedEvidenceDraft && { verifiedEvidenceDraft }),
            ...(verifiedScreenshotDraft && { verifiedScreenshotDraft }),
            ...(!verifiedScreenshotDraft &&
              unverifiedScreenshotDraft && { unverifiedScreenshotDraft }),
            screenshot: {
              mimeType: "image/png",
              data: image.toPNG().toString("base64"),
              width: size.width,
              height: size.height,
            },
          };
        },
        request.taskId,
        managedPage || checkSnapshotPage ? () => checkSnapshotPage?.() : undefined,
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
      return trackPageAction(
        session,
        "press",
        async () => {
          const epoch = session.controlEpoch;
          if (session.cdpCoordinator) {
            const parts = (input.key as string).split("+");
            const key = parts.pop()!;
            const mask: Record<string, number> = {
              alt: 1,
              control: 2,
              meta: 4,
              shift: 8,
            };
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
              await debug.sendCommand("Emulation.setFocusEmulationEnabled", {
                enabled: true,
              });
              let keyHeld = false;
              try {
                for (const type of ["keyDown", "keyUp"]) {
                  if (managedPage) checkPage();
                  if (session.controlEpoch !== epoch)
                    throw new Error("Keyboard action interrupted by human control.");
                  const release = session.inputGuard.expect({
                    type,
                    key: args.key,
                  });
                  try {
                    if (type === "keyDown") keyHeld = true;
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
                    if (type === "keyUp") keyHeld = false;
                  } finally {
                    release();
                  }
                }
              } finally {
                // Space activates a focused button on key-up, so an interrupted Space stays down.
                if (keyHeld && args.key !== " ") {
                  const release = session.inputGuard.expect({
                    type: "keyUp",
                    key: args.key,
                  });
                  try {
                    await debug.sendCommand("Input.dispatchKeyEvent", {
                      ...args,
                      type: "keyUp",
                    });
                  } catch {
                    // The tab may already be gone.
                  } finally {
                    release();
                  }
                }
                await debug.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false });
              }
            });
          } else {
            session.dispatchingAgentInput = true;
            try {
              contents.sendInputEvent({
                type: "keyDown",
                keyCode: input.key as string,
                modifiers,
              });
              contents.sendInputEvent({
                type: "keyUp",
                keyCode: input.key as string,
                modifiers,
              });
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
      return trackPageAction(
        session,
        "click",
        async () => {
          const epoch = session.controlEpoch;
          const visual = typeof input.x === "number" && typeof input.y === "number";
          const target = visual ? null : pageTargetExpression(input);
          let point: { x: number; y: number };
          if (typeof input.x === "number" && typeof input.y === "number") {
            point = { x: input.x, y: input.y };
          } else {
            const resolved = (await readPage(
              `(() => { const element = ${target}; if (!(element instanceof HTMLElement) || element.matches(':disabled,[aria-disabled="true"]') || element.closest('[inert]')) return null; element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); const rect = element.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); if (!hit || (hit !== element && !element.contains(hit))) return null; return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }; })()`,
              true,
            )) as { x: number; y: number } | null;
            if (!resolved) throw new Error("The browser click target was not found.");
            point = resolved;
          }
          if (!managedPage)
            await readPage(
              `(() => {
              document.querySelector('[data-tabs-agent-pointer]')?.remove();
              const pointer = document.createElement('div');
              pointer.setAttribute('data-tabs-agent-pointer', '');
              Object.assign(pointer.style, {
                position: 'fixed', left: '${point.x}px', top: '${point.y}px', width: '18px', height: '18px',
                transform: 'translate(-50%, -50%)', borderRadius: '50%', pointerEvents: 'none',
                zIndex: '2147483647', background: 'rgba(124,58,237,.3)', border: '2px solid #7c3aed',
                boxShadow: '0 0 0 5px rgba(124,58,237,.12)', transition: 'opacity 180ms ease'
              });
              document.documentElement.append(pointer);
              setTimeout(() => { pointer.style.opacity = '0'; setTimeout(() => pointer.remove(), 200); }, 500);
            })()`,
              true,
            );
          const recheck = async () => {
            if (managedPage) {
              checkPage();
              if (visual) {
                const observed = session.lastScreen;
                if (
                  !observed ||
                  observed.url !== contents.getURL() ||
                  observed.epoch !== epoch ||
                  observed.zoom !== contents.getZoomFactor() ||
                  createHash("sha256")
                    .update(await this.captureSessionImage(session, true))
                    .digest("hex") !== observed.digest
                )
                  throw new Error(
                    "The screen has changed. Inspect this tab again before clicking coordinates.",
                  );
                session.lastScreen = undefined;
              } else {
                const hit = await readPage(`(() => {
                  const node = ${target};
                  const hit = document.elementFromPoint(${point.x}, ${point.y});
                  return !!node && !!hit && (hit === node || node.contains(hit)) && !node.matches(':disabled,[aria-disabled="true"]') && !node.closest('[inert]');
                })()`);
                if (hit !== true)
                  throw new Error(
                    "The chosen control moved or was covered. Inspect the page again.",
                  );
              }
            }
            if (session.controlEpoch !== epoch)
              throw new Error("Click interrupted by human control.");
          };
          if (session.cdpCoordinator) {
            await session.cdpCoordinator.withSession("automation", async (debug) => {
              session.inputGuard ??= new BrowserInputGuard();
              await debug.sendCommand("Emulation.setFocusEmulationEnabled", {
                enabled: true,
              });
              let pressed = false;
              try {
                for (const [type, nativeType] of [
                  ["mousePressed", "mouseDown"],
                  ["mouseReleased", "mouseUp"],
                ]) {
                  if (type === "mousePressed") await recheck();
                  if (session.controlEpoch !== epoch)
                    throw new Error("Click interrupted by human control.");
                  const release = session.inputGuard.expect({
                    type: nativeType!,
                    ...point,
                    zoom: contents.getZoomFactor(),
                  });
                  try {
                    if (type === "mousePressed") pressed = true;
                    await debug.sendCommand("Input.dispatchMouseEvent", {
                      type,
                      ...point,
                      button: "left",
                      clickCount: 1,
                    });
                    if (type === "mouseReleased") pressed = false;
                  } finally {
                    release();
                  }
                }
              } finally {
                // Never leave the page in a pressed or drag state. Release away from every
                // control so the interrupted press cannot complete as a click.
                if (pressed)
                  await releaseInterruptedPress(debug, session, contents.getZoomFactor());
                await debug.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false });
              }
            });
          } else {
            await recheck();
            if (session.controlEpoch !== epoch)
              throw new Error("Click interrupted by human control.");
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
      return trackPageAction(
        session,
        "type",
        async () => {
          const typed = await readPage(
            `(() => {
            const element = ${target};
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement && element.isContentEditable) || element.matches(':disabled,[readonly],input[type=password],[autocomplete~="one-time-code"]') || element.closest('[inert]')) return false;
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
      return trackPageAction(
        session,
        "scroll",
        async () => {
          await readPage(
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
      return trackPageAction(
        session,
        "waitFor",
        async () => {
          while (Date.now() <= deadline) {
            const target = pageTargetExpression(input);
            const text = typeof input.text === "string" ? JSON.stringify(input.text) : "null";
            const url =
              typeof input.urlIncludes === "string" ? JSON.stringify(input.urlIncludes) : "null";
            const matched = await readPage(
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

  async captureSession(input: DesktopBrowserHostControlInput): Promise<string | null> {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session || session.view.webContents.isDestroyed()) return null;
    try {
      const image = await session.view.webContents.capturePage();
      if (image.isEmpty()) return null;
      // The backdrop only stands in for the page while a menu covers it, so a
      // JPEG is plenty: it encodes several times faster than PNG at retina
      // sizes, which is what keeps opening a toolbar menu from lagging.
      return `data:image/jpeg;base64,${image.toJPEG(82).toString("base64")}`;
    } catch {
      return null;
    }
  }

  private async captureSessionImage(
    session: BrowserSession,
    viewportOnly = false,
  ): Promise<Buffer> {
    let data: Buffer;
    if (session.cdpCoordinator && !session.view.webContents.isDevToolsOpened()) {
      const capture = await session.cdpCoordinator.withSession("automation", (debug) =>
        debug.sendCommand("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: !viewportOnly,
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
    input: DesktopBrowserHostControlInput & {
      mimeType: string;
      data: Uint8Array;
    },
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

  async pickElement(...args: Parameters<typeof pickElement>): ReturnType<typeof pickElement> {
    return pickElement.apply(this, args);
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
      new ClipboardItem({
        "image/png": new Blob([new Uint8Array(data)], { type: "image/png" }),
      }),
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
          debug.sendCommand("Page.captureScreenshot", {
            format: "png",
            fromSurface: true,
          }),
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

  async trackAutomation<T>(
    session: BrowserSession,
    action: string,
    run: () => Promise<T>,
    taskId?: string,
    source?: BrowserAutomationRequest["source"],
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

    if (this.sessions.get(session.key) !== session || session.view.webContents.isDestroyed()) {
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
    if (source === "agent") session.activeAgentAction = { action, epoch: scheduledEpoch };
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
      session.activeAgentAction = undefined;
      if (session.controller === "agent") {
        session.controller = "none";
        this.emitState(session);
      }
      releaseQueue();
    }
  }

  takeControl(...args: Parameters<typeof takeControl>): ReturnType<typeof takeControl> {
    return takeControl.apply(this, args);
  }

  async resumeAgent(...args: Parameters<typeof resumeAgent>): ReturnType<typeof resumeAgent> {
    return resumeAgent.apply(this, args);
  }

  returnControlToAgent(session: BrowserSession): void {
    session.demonstration = undefined;
    session.controlEpoch = (session.controlEpoch ?? 0) + 1;
    session.figmaCanvasReview = undefined;
    session.controller = "none";
    session.humanControlLocked = false;
    this.clearHumanControlTimer(session);
  }

  assignTabTask(input: DesktopBrowserHostControlInput & { taskId: string | null }): void {
    const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
    if (!session) return;
    this.updateTabTask(session, input.taskId);
    this.emitState(session);
  }

  private updateTabTask(session: BrowserSession, taskId: string | null): void {
    if (session.assignedTaskId !== taskId) {
      session.demonstration = undefined;
      session.pageGrant = undefined;
      session.partnerCenterStatus = undefined;
      session.figmaCanvasReview = undefined;
      session.actionTimeline = [];
      session.deviceUploads?.clear();
      this.revokeScreenshotAttempts(session);
      session.controlEpoch = (session.controlEpoch ?? 0) + 1;
    }
    session.assignedTaskId = taskId ?? null;
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
        this.destroySession({
          projectId: session.projectId,
          sessionId: session.sessionId,
        });
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
    this.closePictureInPicture({
      projectId: session.projectId,
      sessionId: session.sessionId,
    });
    defaultPermissionMediator.cancelPendingRequestsForWebContents(session.view.webContents.id);
    session.pendingPermission = null;
    session.cdpCoordinator?.detach();
    session.view.webContents.close({ waitForBeforeUnload: false });
    this.sessions.delete(key);
    if (session.pageGrant) {
      const window = this.getWindow();
      if (window && !window.isDestroyed())
        window.webContents.send(
          "desktop:browser-host:session-state",
          this.getSessionState(session.projectId, session.sessionId),
        );
    }
    if (session.partition.startsWith(AGENT_PARTITION_PREFIX)) {
      defaultPermissionMediator.clearDecisions(undefined, session.partition);
      this.knownPartitions.delete(session.partition);
    }
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

  observeAutomationNetwork(browserSession: Session): void {
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
      this.destroySession({
        projectId: session.projectId,
        sessionId: session.sessionId,
      });
    }
  }

  async flushAndShutdownSessions(options?: { timeoutMs?: number }): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown(options?.timeoutMs ?? 5000);
    return this.shutdownPromise;
  }

  private async performShutdown(
    ...args: Parameters<typeof performShutdown>
  ): ReturnType<typeof performShutdown> {
    return performShutdown.apply(this, args);
  }

  dispose(): void {
    void this.flushAndShutdownSessions().catch((err) => {
      console.warn("[browserHostManager] Shutdown flush error during dispose:", err);
    });
  }

  async loadUrl(session: BrowserSession, url: string, failOnError = false): Promise<void> {
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

  private snapshotSession(
    ...args: Parameters<typeof snapshotSession>
  ): ReturnType<typeof snapshotSession> {
    return snapshotSession.apply(this, args);
  }

  emitState(session: BrowserSession): void {
    // Loading the blank placeholder must never reach the address bar or history.
    if (session.resting || this.sessions.get(session.key) !== session) return;
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    window.webContents.send("desktop:browser-host:session-state", this.snapshotSession(session));
  }

  async applyColorScheme(session: BrowserSession): Promise<void> {
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

  clearHumanControlTimer(session: BrowserSession): void {
    if (!session.humanControlTimer) return;
    clearTimeout(session.humanControlTimer);
    session.humanControlTimer = null;
  }

  clearCrashRecoveryTimer(session: BrowserSession): void {
    if (!session.crashRecoveryTimer) return;
    clearTimeout(session.crashRecoveryTimer);
    session.crashRecoveryTimer = null;
  }

  observeProfileSession(
    ...args: Parameters<typeof observeProfileSession>
  ): ReturnType<typeof observeProfileSession> {
    return observeProfileSession.apply(this, args);
  }

  private async readAccountMarker(contents: Electron.WebContents): Promise<string | null> {
    try {
      return parseAccountMarker(
        await contents.executeJavaScriptInIsolatedWorld(999, [{ code: ACCOUNT_MARKER_SCRIPT }]),
      );
    } catch {
      return null;
    }
  }

  private async captureAccountMarker(
    session: BrowserSession,
    contents: Electron.WebContents,
  ): Promise<void> {
    const grant = session.pageGrant;
    if (!grant) return;
    const hash = await this.readAccountMarker(contents);
    if (session.pageGrant === grant) session.accountMarker = { grant, hash };
  }

  /** Revokes the page grant when the visible signed-in account differs from the approved one. */
  async checkAccountMarker(session: BrowserSession, contents: Electron.WebContents): Promise<void> {
    const approved = session.accountMarker;
    const grant = session.pageGrant;
    if (!approved || approved.grant !== grant || approved.hash === null || !grant) return;
    const current = await this.readAccountMarker(contents);
    if (session.pageGrant !== grant || !accountMarkerChanged(approved.hash, current)) return;
    session.controlEpoch++;
    session.pageRevision = (session.pageRevision ?? 0) + 1;
    session.pageGrant = undefined;
    session.accountMarker = undefined;
    session.demonstration = undefined;
    session.returningDemonstration = undefined;
    session.lastScreen = undefined;
    session.actionTimeline = [];
    session.workflowSubmission = undefined;
    session.partnerCenterStatus = undefined;
    session.figmaCanvasReview = undefined;
    this.revokeScreenshotAttempts(session);
    session.deviceUploads?.clear();
    session.quickAction?.navigated();
    session.lastError = ACCOUNT_MARKER_MESSAGE;
    this.emitState(session);
    throw new Error(ACCOUNT_MARKER_MESSAGE);
  }

  private lastHttpOnlyCookieChange(
    ...args: Parameters<typeof lastHttpOnlyCookieChange>
  ): ReturnType<typeof lastHttpOnlyCookieChange> {
    return lastHttpOnlyCookieChange.apply(this, args);
  }

  async changingStorage(
    storage: Session,
    affected: (url: string) => boolean,
    clear: () => Promise<void>,
  ): Promise<void> {
    const finish = this.beginStorageChange(storage);
    try {
      this.invalidateStorageGrants(storage, affected);
      await clear();
    } finally {
      finish();
    }
  }

  beginStorageChange(storage: Session): () => void {
    this.storageChanges.set(storage, (this.storageChanges.get(storage) ?? 0) + 1);
    return () => {
      const remaining = (this.storageChanges.get(storage) ?? 1) - 1;
      if (remaining) this.storageChanges.set(storage, remaining);
      else this.storageChanges.delete(storage);
    };
  }

  invalidateStorageGrants(
    ...args: Parameters<typeof invalidateStorageGrants>
  ): ReturnType<typeof invalidateStorageGrants> {
    return invalidateStorageGrants.apply(this, args);
  }

  attachSession(session: BrowserSession): void {
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

  detachSession(session: BrowserSession): void {
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

  registerSessionEvents(
    ...args: Parameters<typeof registerSessionEvents>
  ): ReturnType<typeof registerSessionEvents> {
    return registerSessionEvents.apply(this, args);
  }

  readonly pendingContextMenus = new Map<
    string,
    {
      session: BrowserSession;
      menu: PendingBrowserContextMenu;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  async openContextMenu(
    ...args: Parameters<typeof openContextMenu>
  ): ReturnType<typeof openContextMenu> {
    return openContextMenu.apply(this, args);
  }

  /** The renderer has painted the snapshot; swap the live view out underneath it. */
  confirmContextMenuSnapshot(rawToken: unknown): void {
    if (typeof rawToken !== "string") return;
    const entry = this.pendingContextMenus.get(rawToken);
    if (entry && !entry.session.view.webContents.isDestroyed())
      entry.session.view.setVisible(false);
  }

  resolveContextMenu(raw: { token: unknown; id: unknown }): void {
    const reply = validateContextMenuReply(
      raw,
      new Map([...this.pendingContextMenus].map(([token, entry]) => [token, entry.menu])),
    );
    if (!reply) {
      // A bad reply must still not strand the page hidden.
      if (typeof raw.token === "string") this.settleContextMenu(raw.token, null);
      return;
    }
    this.settleContextMenu(reply.token, reply.id);
  }

  settleContextMenu(token: string, id: string | null): void {
    const entry = this.pendingContextMenus.get(token);
    if (!entry) return;
    this.pendingContextMenus.delete(token);
    clearTimeout(entry.timer);
    const { session, menu } = entry;
    const contents = session.view.webContents;
    if (contents.isDestroyed()) return;
    session.view.setVisible(true);
    if (id === null) return;
    contents.focus();
    runBrowserContextMenuAction(
      id,
      menu,
      {
        goBack: () => contents.goBack(),
        goForward: () => contents.goForward(),
        reload: () => contents.reload(),
        cut: () => contents.cut(),
        copy: () => contents.copy(),
        paste: () => contents.paste(),
        selectAll: () => contents.selectAll(),
        copyImageAt: (x, y) => contents.copyImageAt(x, y),
        replaceMisspelling: (word) => contents.replaceMisspelling(word),
        addWordToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
        inspectElement: (x, y) => contents.inspectElement(x, y),
        openDevToolsIfClosed: () => {
          if (!contents.isDevToolsOpened()) contents.openDevTools({ mode: DOCKED_DEVTOOLS_MODE });
        },
      },
      {
        writeClipboardText: (text) => clipboard.writeText(text),
        openExternal: (url) => void shell.openExternal(url).catch(() => undefined),
      },
    );
  }
}

export { normalizeBrowserProfileId, normalizeBrowserCookieDomain } from "./browserProfileStorage";

export {
  defaultPermissionMediator,
  BROWSER_CONTEXT_MENU_CHANNEL,
  BROWSER_CRASH_RECOVERY_WINDOW_MS,
} from "./browserHostSupport";
export { planBrowserCrashRecovery } from "./browserHostSupport";
