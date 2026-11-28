import {
  getBrowserPageScope,
  matchesPageScope,
  pageOrigin,
  type BrowserPageGrant,
  type BrowserPageScope,
} from "./browserPageGrant";
import { BrowserInputGuard } from "./browserInputGuard";
import {
  type BrowserAttachmentBookmark,
  type BrowserDeviceComparisonDraftBookmark,
} from "./browserAttachmentBookmarks";
import { JourneyRecorder } from "./journeyRecorder";
import { isLikelyAuthenticationUrl } from "./authClassifier";
import { EPHEMERAL_PARTITION_PREFIX } from "./profileStorage";
import { PermissionMediator } from "./permissionMediator";
import { BrowserWindow, WebContentsView, type Session, type Rectangle } from "electron";
import * as Schema from "effect/Schema";
import {
  DeviceComparisonFrame,
  type DesktopBrowserSessionState,
  type BrowserWorkflowDefinition,
  type FigmaCanvasApproval,
  type FigmaCanvasTarget,
  type PartnerCenterStatusApproval,
  PartnerCenterStatusRequest,
  BROWSER_DEMONSTRATION_CHANGES,
  DeviceComparisonFirstDifference,
  DeviceComparisonTarget,
  type BrowserPermissionRequest,
} from "@tabs/contracts";
import { hasProtectedBrowserUrlState } from "@tabs/shared/preview";
import { BrowserQuickActionState } from "./browserQuickAction";
import { type BrowserWorkflowLocalUpload } from "./browserWorkflowPage";
import { BrowserCdpCoordinator } from "./browserCdpCoordinator";

export const MAX_DEVICE_SCREENSHOT_GRANTS = 8;

export type ScreenshotDraft = {
  grantId: string;
  pairedGrantId?: string;
  taskId: string;
  partition: string;
  url: string;
  pageRef: string;
  digest: string;
  comparisonFrame?: DeviceComparisonFrame;
  exactDraftUrl?: true;
  verifyScreenshotImages?: true;
  observedUrl?: string;
  observedDocumentRevision?: number;
  verifiedUrl?: string;
  bookmarkPending?: true;
};

export type DeviceEvidencePage = {
  pageRef: string;
  profileId: string;
  verifyScreenshotImages?: true;
};

export type DeviceScreenshotSource = { hostId: string; deviceId: string } & (
  | { frame?: DeviceComparisonFrame | undefined; firstDifference?: never }
  | (DeviceEvidencePage & {
      firstDifference: DeviceComparisonFirstDifference;
      frame?: never;
    })
);

export type DeviceScreenshotGrant = DeviceScreenshotSource & {
  id: string;
  pairedGrantId?: string;
  taskId: string;
  url: string;
  partition: string;
  epoch: number;
};

export type DeviceScreenshotAttempt = {
  grant: DeviceScreenshotGrant;
  contents: Electron.WebContents;
  instanceId: string;
  pageRevision: number | undefined;
  selector: string;
  sizeBytes: number;
  frame: DeviceComparisonFrame | undefined;
  draft: ScreenshotDraft;
  recorded: boolean;
  dispatching?: boolean;
  navigationStarted?: boolean;
  cancelCheckpoint?: (() => void) | undefined;
};

export type BrowserSession = {
  instanceId: string;
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
  failedMainFrame?: { contents: Electron.WebContents; url: string } | undefined;
  /** Transient error set when ERR_CONNECTION_REFUSED fires (dev server not ready yet).
   * Cleared as soon as any successful navigation or page load occurs. */
  transientError: string | null;
  certificateError: string | null;
  consoleEntries: BrowserConsoleEntry[];
  pageErrorEmitTimer?: ReturnType<typeof setTimeout> | undefined;
  /** When the user last had this session in front of them. */
  lastActiveAt?: number | undefined;
  /**
   * Set while the session rests: the page was swapped for a blank one to free
   * its memory. Holds the state to show meanwhile and where to return.
   */
  resting?:
    | {
        readonly snapshot: DesktopBrowserSessionState;
        readonly historyIndex: number;
      }
    | undefined;
  /** Console errors since the current page loaded (reset on navigation). */
  pageErrors?: {
    count: number;
    latest: { text: string; source?: string; at: string };
  } | null;
  networkEntries: BrowserNetworkEntry[];
  actionTimeline: BrowserActionEvent[];
  controller: "human" | "agent" | "none";
  activeAgentAction?: { action: string; epoch: number } | undefined;
  demonstration?:
    | {
        grant: BrowserPageGrant;
        token: string;
        before: string;
        control?: string;
      }
    | undefined;
  returningDemonstration?: string | undefined;
  lastScreen?: { digest: string; epoch: number; url: string; zoom: number } | undefined;
  pageRevision?: number;
  documentRevision?: number;
  mainFrameNavigationRevision?: number;
  inPageApprovalRevision?: number;
  selectionDrag?: { token: string; url: string } | undefined;
  screenshotDrafts?: ScreenshotDraft[];
  screenshotAttempts?: Map<string, DeviceScreenshotAttempt>;
  pageGrant?: BrowserPageGrant | undefined;
  /** Hash of the visible account identity when the grant was approved. Never the text. */
  accountMarker?: { grant: BrowserPageGrant; hash: string | null } | undefined;
  workflowSubmission?: BrowserSubmissionApproval | undefined;
  partnerCenterStatus?: PartnerCenterStatusConsent | undefined;
  partnerCenterLookup?: { consent: PartnerCenterStatusConsent; expiresAt: number } | undefined;
  figmaCanvasReview?: FigmaCanvasReview | undefined;
  deviceUploads?: Map<string, DeviceScreenshotGrant>;
  controlEpoch: number;
  humanControlLocked: boolean;
  verificationLease?: symbol | undefined;
  quickAction?: BrowserQuickActionState | undefined;
  quickActionScope?: BrowserPageScope | undefined;
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

export interface BrowserConsoleEntry {
  readonly level: string;
  readonly text: string;
  readonly timestamp: string;
  readonly source?: string;
}

export interface BrowserNetworkEntry {
  readonly url: string;
  readonly method: string;
  readonly status: number | null;
  readonly failed: boolean;
  readonly errorText?: string;
  readonly timestamp: string;
}

export interface BrowserActionEvent {
  readonly id: string;
  readonly action: string;
  status: "running" | "succeeded" | "failed" | "interrupted" | "cancelled";
  readonly startedAt: string;
  completedAt?: string;
  error?: string;
  readonly observedChanges?: readonly (typeof BROWSER_DEMONSTRATION_CHANGES)[number][];
}

export const AUTOMATION_OBSERVATION_LIMIT = 200;
export const CHROMIUM_ERROR_DOCUMENT = "chrome-error://chromewebdata/";

export function appendBounded<T>(entries: T[], entry: T): void {
  entries.push(entry);
  if (entries.length > AUTOMATION_OBSERVATION_LIMIT) {
    entries.splice(0, entries.length - AUTOMATION_OBSERVATION_LIMIT);
  }
}

export interface BrowserAutomationRequest {
  readonly source?: "human" | "agent";
  readonly projectId: string;
  readonly sessionId?: string;
  readonly taskId?: string | undefined;
  readonly operation: string;
  readonly input?: unknown;
}

export interface BrowserSubmissionApproval {
  id: string;
  workflowId?: string;
  definition: BrowserWorkflowDefinition;
  grant: BrowserPageGrant;
  epoch: number;
  approved: boolean;
  controlLabel?: string;
  uploadFile?: { name: string; size: number };
  chooseUploadFile?: true;
  localUpload?: BrowserWorkflowLocalUpload;
  siteSubmissionKey?: true;
}

export interface BrowserConsentPage {
  contents: WebContentsView["webContents"];
  browserSession: Session;
  storagePath: string;
  profileId: string;
  instanceId: string;
  revision: number | undefined;
  grant: BrowserPageGrant;
  epoch: number;
  url: string;
}

export interface PartnerCenterStatusConsent {
  request: PartnerCenterStatusRequest;
  approval: PartnerCenterStatusApproval;
  page: BrowserConsentPage;
  approved: boolean;
}

export interface FigmaCanvasReview {
  target: FigmaCanvasTarget;
  attachment: BrowserAttachmentBookmark;
  page: BrowserConsentPage;
  inspected: boolean;
  consent?: { approval: FigmaCanvasApproval; approved: boolean };
  dispatchApproval?: FigmaCanvasApproval;
}

export const FIGMA_ATTACHMENT_REQUIRED =
  "Open the Figma attachment in its original desktop browser tab, profile and thread.";
export const FIGMA_PAGE_CHANGED =
  "The Figma attachment, page or browser access changed. Inspect the attached Figma node again.";
export const FIGMA_REVIEW_REQUIRED =
  "Review the current Figma frame request in its original browser tab and thread.";

export function isBrowserAttachmentUrl(address: string): boolean {
  if (!pageOrigin(address) || isLikelyAuthenticationUrl(address)) return false;
  const url = new URL(address);
  if (url.href !== address) return false;
  try {
    const path = decodeURIComponent(url.pathname);
    const route = decodeURIComponent(url.hash).slice(1).replace(/^!/u, "");
    return (
      !isLikelyAuthenticationUrl(url.origin + path) &&
      !(route.startsWith("/") && isLikelyAuthenticationUrl(url.origin + route)) &&
      !hasProtectedBrowserUrlState(url)
    );
  } catch {
    return false;
  }
}

/** Offscreen point that no control can occupy, used to end an interrupted press harmlessly. */
export const NEUTRAL_RELEASE_POINT = { x: -1, y: -1 };

export async function releaseInterruptedPress(
  debug: {
    sendCommand: (method: "Input.dispatchMouseEvent", params: object) => Promise<unknown>;
  },
  session: BrowserSession,
  zoom: number,
) {
  const guard = (session.inputGuard ??= new BrowserInputGuard());
  for (const [type, nativeType, extra] of [
    ["mouseMoved", "mouseMove", { buttons: 1 }],
    ["mouseReleased", "mouseUp", { button: "left", clickCount: 1 }],
  ] as const) {
    const release = guard.expect({
      type: nativeType,
      ...NEUTRAL_RELEASE_POINT,
      zoom,
    });
    try {
      await debug.sendCommand("Input.dispatchMouseEvent", {
        type,
        ...NEUTRAL_RELEASE_POINT,
        ...extra,
      });
    } catch {
      // The tab may already be gone; the original interruption is what matters.
    } finally {
      release();
    }
  }
}

export function waitForExactBrowserPage(
  contents: Electron.WebContents,
  matches: (url: string) => boolean,
  errorMessage: string,
  start: () => Promise<void> | void,
  options?: {
    cancelOnFailure?: boolean;
    preservePageNavigation?: boolean;
    rejectAuthentication?: boolean;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    const finish = (opened: boolean, cancel = true) => {
      if (settled) return;
      settled = true;
      if (!opened && cancel && options?.cancelOnFailure && !contents.isDestroyed()) contents.stop();
      clearTimeout(timeout);
      if (options?.preservePageNavigation) contents.removeListener("did-start-navigation", onStart);
      contents.removeListener("will-redirect", onRedirect);
      contents.removeListener("will-navigate", onWillNavigate);
      contents.removeListener("did-navigate", onNavigate);
      contents.removeListener("did-navigate-in-page", onInPage);
      contents.removeListener("did-finish-load", onFinish);
      contents.removeListener("did-fail-load", onFail);
      contents.removeListener("destroyed", onDestroy);
      if (options?.rejectAuthentication) contents.removeListener("login", onLogin);
      if (opened) resolve();
      else reject(new Error(errorMessage));
    };
    const onWillNavigate = (
      event: Electron.Event<Electron.WebContentsWillNavigateEventParams>,
      url: string,
    ) => {
      if (!matches(event.url ?? url)) {
        if (!options?.preservePageNavigation) event.preventDefault();
        finish(false, !options?.preservePageNavigation);
      }
    };
    const onStart = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
      url: string,
      _inPlace: boolean,
      mainFrame: boolean,
    ) => {
      if (!(event.isMainFrame ?? mainFrame)) return;
      if (started || !matches(event.url ?? url)) finish(false, false);
      else started = true;
    };
    const onRedirect = (
      event: Electron.Event<Electron.WebContentsWillRedirectEventParams>,
      url: string,
      _inPlace: boolean,
      mainFrame: boolean,
    ) => {
      if ((event.isMainFrame ?? mainFrame) && !matches(event.url ?? url)) {
        event.preventDefault();
        finish(false);
      }
    };
    const onNavigate = (_event: unknown, url: string) => {
      if (!matches(url)) finish(false);
    };
    const onInPage = (_event: unknown, url: string, mainFrame: boolean) => {
      if (!mainFrame) return;
      if (!matches(url)) finish(false);
      else if (!contents.isLoadingMainFrame()) finish(true);
    };
    const onFinish = () => finish(!contents.isDestroyed() && matches(contents.getURL()));
    const onFail = (
      _event: unknown,
      code: number,
      _description: string,
      url: string,
      mainFrame: boolean,
    ) => {
      if (mainFrame && (code !== -3 || matches(url)))
        finish(false, code !== -3 || !options?.preservePageNavigation);
    };
    const onDestroy = () => finish(false);
    const onLogin = (
      event: Electron.Event,
      _details: Electron.AuthenticationResponseDetails,
      _info: Electron.AuthInfo,
      callback: () => void,
    ) => {
      event.preventDefault();
      finish(false);
      callback();
    };
    const timeout = setTimeout(onDestroy, 10_000);
    if (options?.preservePageNavigation) contents.on("did-start-navigation", onStart);
    contents.on("will-redirect", onRedirect);
    contents.on("will-navigate", onWillNavigate);
    contents.on("did-navigate", onNavigate);
    contents.on("did-navigate-in-page", onInPage);
    contents.on("did-finish-load", onFinish);
    contents.on("did-fail-load", onFail);
    contents.on("destroyed", onDestroy);
    if (options?.rejectAuthentication) contents.on("login", onLogin);
    try {
      void start()?.then(onFinish, onDestroy);
    } catch {
      finish(false);
    }
  });
}

export function automationInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

export const ScreenshotPairFrame = Schema.Struct({
  ...DeviceComparisonTarget.fields,
  frame: DeviceComparisonFrame,
});
export const isScreenshotPair = Schema.is(Schema.Tuple([ScreenshotPairFrame, ScreenshotPairFrame]));
export const isDeviceEvidenceApproval = Schema.is(
  Schema.Struct({
    url: Schema.String,
    profileId: Schema.String,
    pageRef: Schema.String,
    instanceId: Schema.String.check(Schema.isUUID()),
    pageApprovalToken: Schema.optionalKey(Schema.String),
    runId: DeviceComparisonFirstDifference.fields.runId,
    source: DeviceComparisonTarget,
    target: DeviceComparisonTarget,
  }),
);

export function distinctScreenshotDevices([source, target]: readonly [
  DeviceComparisonTarget,
  DeviceComparisonTarget,
]) {
  return (
    (source.hostId !== target.hostId || source.deviceId !== target.deviceId) &&
    [source, target].every(
      ({ hostId, deviceId }) => hostId === hostId.trim() && deviceId === deviceId.trim(),
    )
  );
}

export function screenshotPair(input: unknown) {
  if (!isScreenshotPair(input))
    throw new Error("Select two exact devices and comparison frames before approving.");
  const [source, target] = input;
  if (
    !distinctScreenshotDevices(input) ||
    source.frame.side !== "source" ||
    target.frame.side !== "target" ||
    source.frame.runId !== target.frame.runId ||
    source.frame.step !== target.frame.step
  )
    throw new Error("Select distinct source and target devices from the same comparison step.");
  return input;
}

export function matchesScreenshotDraftUrl(draft: ScreenshotDraft, url: string): boolean {
  if (draft.exactDraftUrl) return draft.url === url;
  const scope = getBrowserPageScope(draft.url);
  return scope !== null && matchesPageScope(scope, url);
}

export function matchesPairedScreenshotDraft(draft: ScreenshotDraft, candidate: ScreenshotDraft) {
  return (
    candidate.grantId === draft.pairedGrantId &&
    candidate.pairedGrantId === draft.grantId &&
    candidate.taskId === draft.taskId &&
    candidate.partition === draft.partition &&
    candidate.url === draft.url &&
    candidate.pageRef === draft.pageRef
  );
}

export function pairedScreenshotDraft(session: BrowserSession, draft: ScreenshotDraft) {
  if (!draft.pairedGrantId) return;
  return session.screenshotDrafts?.find((candidate) =>
    matchesPairedScreenshotDraft(draft, candidate),
  );
}

export function comparisonDraftBookmark(
  bookmark: BrowserAttachmentBookmark,
  draft: ScreenshotDraft,
  paired: ScreenshotDraft | undefined,
): BrowserDeviceComparisonDraftBookmark | undefined {
  const frame = draft.comparisonFrame;
  const other = paired?.comparisonFrame;
  if (
    !frame ||
    !other ||
    !paired ||
    frame.runId !== other.runId ||
    frame.step !== other.step ||
    frame.side === other.side
  )
    return;
  return {
    ...bookmark,
    runId: frame.runId,
    step: frame.step,
    digests:
      frame.side === "source" ? [draft.digest, paired.digest] : [paired.digest, draft.digest],
  };
}

export function currentThreadPageGrant(
  session: BrowserSession,
  taskId: string | undefined,
  url: string,
) {
  const grant = session.pageGrant;
  if (
    grant &&
    taskId &&
    grant.taskId === taskId &&
    session.assignedTaskId === taskId &&
    grant.partition === session.partition &&
    session.controller !== "human" &&
    matchesPageScope(grant, url)
  )
    return grant;
}

export function checkGuardedWorkflowDefinition(definition: BrowserWorkflowDefinition) {
  const { states } = definition;
  if (
    definition.readOnly !== true &&
    (!definition.submitSelector ||
      !definition.breakpoint ||
      !states.uploaded ||
      !states.submitted ||
      !states.certified ||
      !states.published)
  )
    throw new Error("A guarded workflow requires Submit, a breakpoint and its lifecycle labels.");
}

/** Runs in the isolated guest world and returns only an exact identity match. */
export function matchesVisibleStoreSubmission(url: string, selector: string, submissionId: string) {
  if (location.href !== url || document.readyState === "loading") return false;
  const matches = document.querySelectorAll(selector);
  const element = matches[0];
  if (matches.length !== 1 || !(element instanceof HTMLElement)) return false;
  const bounds = element.getBoundingClientRect();
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    element.closest(
      '[hidden], [inert], [aria-hidden="true"], input, textarea, select, [contenteditable], [role="textbox"]',
    )
  )
    return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0)
      return false;
  }
  return element.innerText.trim() === submissionId;
}

export const defaultPermissionMediator = new PermissionMediator();

export const BROWSER_CONTEXT_MENU_CHANNEL = "desktop:browser-context-menu";

export const EXTERNAL_OAUTH_REQUIRED_MESSAGE =
  "This provider does not permit sign-in inside embedded browsers. Open the page in your system browser, but note that its login session cannot be transferred automatically back into this Tabs browser profile.";

export const DEFAULT_SESSION_ID = "browser";

export const AGENT_PARTITION_PREFIX = `${EPHEMERAL_PARTITION_PREFIX}agent:`;

export const BROWSER_CRASH_RECOVERY_WINDOW_MS = 30_000;

export const BROWSER_CRASH_RECOVERY_MAX_ATTEMPTS = 3;

export const BROWSER_CRASH_RECOVERY_BASE_DELAY_MS = 250;

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

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
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
