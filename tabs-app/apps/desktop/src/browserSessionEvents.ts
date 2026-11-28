import {
  browserSelectionDragScript,
  describeBrowserPageScope,
  matchesPageScope,
  pageOrigin,
} from "./browserPageGrant";
import { classifyAuthNavigation, isLikelyAuthenticationUrl } from "./authClassifier";
import { isPersistentPartition } from "./profileStorage";
import { decideWindowOpenAction, configureChildPopupWindow } from "./popupHandoff";
import { buildSecurityContext } from "./browserSecurityContext";
import { detectGoogleRejection } from "./googleAuthHandler";
import { sanitizeDiagnosticOrigin } from "./browserDiagnostics";
import { app, WebContentsView, session as electronSession, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { pendingFromParams } from "./browserContextMenu";
import type { DesktopBrowserSessionState } from "@tabs/contracts";
import { BrowserSession, CHROMIUM_ERROR_DOCUMENT, appendBounded } from "./browserHostSupport";
import { livePartnerCenterStatus, liveFigmaCanvasReview } from "./browserFigmaPartnerCenter";
import { revokeScreenshotAttempts } from "./browserDeviceScreenshots";
import type { BrowserHostManager } from "./browserHostManager";
import {
  defaultPermissionMediator,
  BROWSER_CONTEXT_MENU_CHANNEL,
  EXTERNAL_OAUTH_REQUIRED_MESSAGE,
  planBrowserCrashRecovery,
  withTimeout,
} from "./browserHostSupport";

export async function performShutdown(this: BrowserHostManager, timeoutMs: number): Promise<void> {
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
      this.closePictureInPicture({
        projectId: session.projectId,
        sessionId: session.sessionId,
      });
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

export function snapshotSession(
  this: BrowserHostManager,
  session: BrowserSession,
): DesktopBrowserSessionState {
  if (session.resting) return session.resting.snapshot;
  const approval = this.liveSubmissionApproval(session, session.currentUrl);
  const storeConsent = this.livePartnerCenterStatus(session);
  const figmaConsent = this.liveFigmaCanvasReview(session)?.consent;
  return {
    projectId: session.projectId,
    sessionId: session.sessionId,
    instanceId: session.instanceId,
    profileId: session.profileId,
    currentUrl: session.currentUrl,
    ...(session.currentUrl && pageOrigin(session.currentUrl)
      ? {
          pageRef: this.pageReference(session, session.currentUrl),
          pageApprovalToken: this.pageApprovalToken(session),
        }
      : {}),
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
    ...(session.controller === "agent" &&
    session.activeAgentAction &&
    session.activeAgentAction.epoch === session.controlEpoch
      ? { activeAgentAction: session.activeAgentAction.action }
      : {}),
    ...(session.demonstration?.control && session.demonstration.grant === session.pageGrant
      ? { demonstratedControl: session.demonstration.control }
      : {}),
    submissionGuardActive: this.submissionGuards.has(session.partition, session.currentUrl ?? ""),
    ...(approval && !approval.approved
      ? {
          pendingSubmissionApproval: {
            id: approval.id,
            ...(approval.workflowId && { workflowId: approval.workflowId }),
            resourceId: approval.definition.resourceId,
            url: approval.definition.url,
            ...(approval.controlLabel && {
              controlLabel: approval.controlLabel,
            }),
            ...(approval.siteSubmissionKey && {
              siteSubmissionKey: true as const,
            }),
            ...(approval.uploadFile && {
              action: "upload" as const,
              uploadFile: approval.uploadFile,
            }),
            ...(approval.chooseUploadFile && {
              action: "upload" as const,
              chooseUploadFile: true as const,
            }),
          },
        }
      : {}),
    ...(storeConsent && !storeConsent.approved
      ? { pendingPartnerCenterStatus: storeConsent.approval }
      : {}),
    ...(figmaConsent && !figmaConsent.approved
      ? { pendingFigmaCanvas: figmaConsent.approval }
      : {}),
    browserPageAuthorized:
      !!session.pageGrant &&
      session.pageGrant.taskId === session.assignedTaskId &&
      session.pageGrant.partition === session.partition &&
      matchesPageScope(session.pageGrant, session.currentUrl ?? ""),
    ...(session.pageGrant && {
      browserPageScopeLabel:
        session.pageGrant.scopeLabel ??
        describeBrowserPageScope(session.pageGrant, session.profileId ?? "default"),
    }),
    deviceScreenshotAuthorized: Array.from(session.deviceUploads?.values() ?? []).some(
      (grant) => grant.epoch === session.controlEpoch,
    ),
    temporaryAgentTab: session.temporaryAgentTab,
    userRetained: session.userRetained,
    lastError: session.lastError,
    pageErrors: session.pageErrors ?? null,
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

export function registerSessionEvents(this: BrowserHostManager, session: BrowserSession): void {
  const contents = session.view.webContents;
  const installSelectionDrag = () => {
    session.selectionDrag = undefined;
    if (
      !session.sessionId.startsWith("agents-surface-") ||
      contents.isDestroyed() ||
      session.view.webContents !== contents ||
      this.sessions.get(session.key) !== session
    )
      return;
    const url = contents.getURL();
    if (!pageOrigin(url) || isLikelyAuthenticationUrl(url)) return;
    const drag = { token: randomUUID(), url };
    session.selectionDrag = drag;
    void contents
      .executeJavaScriptInIsolatedWorld(999, [
        { code: browserSelectionDragScript(url, drag.token) },
      ])
      .catch(() => {
        if (session.selectionDrag === drag) session.selectionDrag = undefined;
      });
  };
  contents.on("dom-ready", installSelectionDrag);
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
    session.quickAction?.revoke();
    session.controlEpoch = (session.controlEpoch ?? 0) + 1;
    this.revokeScreenshotAttempts(session, undefined, true);
    session.figmaCanvasReview = undefined;
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
  const blockScopedNavigation = (event: { preventDefault(): void }, url: string) => {
    if (session.controller === "human") return false;
    const scope =
      session.quickActionScope ?? (session.controller === "agent" ? session.pageGrant : undefined);
    if (scope && !matchesPageScope(scope, url)) {
      event.preventDefault();
      session.controlEpoch++;
      return true;
    }
    return false;
  };
  contents.on("will-redirect", (event, url, _inPlace, mainFrame) => {
    if (event.isMainFrame ?? mainFrame) blockScopedNavigation(event, event.url ?? url);
  });
  contents.on("will-navigate", (event, url) => {
    url = event.url ?? url;
    if (blockScopedNavigation(event, url)) return;
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

  contents.on("did-start-navigation", (event, _url, _inPlace, mainFrame) => {
    if (!(event.isMainFrame ?? mainFrame)) return;
    session.mainFrameNavigationRevision = (session.mainFrameNavigationRevision ?? 0) + 1;
    if ((event.url ?? _url) !== CHROMIUM_ERROR_DOCUMENT) session.failedMainFrame = undefined;
    for (const [id, attempt] of session.screenshotAttempts ?? []) {
      // A save navigation can follow selection before its reply. Keep revocation reachable
      // until the reply settles, but require saved receipt verification after navigation.
      if (attempt.dispatching) attempt.navigationStarted = true;
      else session.screenshotAttempts?.delete(id);
    }
    const consent = session.figmaCanvasReview?.consent;
    session.figmaCanvasReview = undefined;
    let revokedEvidence = false;
    for (const [id, grant] of session.deviceUploads ?? []) {
      if (!grant.firstDifference) continue;
      session.deviceUploads?.delete(id);
      revokedEvidence = true;
    }
    if (consent || revokedEvidence) this.emitState(session);
  });
  contents.on("did-start-loading", () => {
    session.selectionDrag = undefined;
    session.workflowSubmission = undefined;
    session.partnerCenterStatus = undefined;
    session.figmaCanvasReview = undefined;
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
    session.quickAction?.navigated();
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
  const invalidatePageScope = (url: string) => {
    const grantChanged = session.pageGrant && !matchesPageScope(session.pageGrant, url);
    if (grantChanged) session.pageGrant = undefined;
    if (
      grantChanged ||
      (session.controller !== "human" &&
        session.quickActionScope &&
        !matchesPageScope(session.quickActionScope, url))
    )
      session.controlEpoch++;
  };
  const recheckAccount = () => {
    if (session.pageGrant && session.accountMarker?.hash)
      void this.checkAccountMarker(session, contents).catch(() => undefined);
  };
  contents.on("did-navigate", (_event, url) => {
    session.selectionDrag = undefined;
    session.partnerCenterStatus = undefined;
    session.figmaCanvasReview = undefined;
    session.pageRevision = (session.pageRevision ?? 0) + 1;
    session.documentRevision = (session.documentRevision ?? 0) + 1;
    invalidatePageScope(url);
    session.quickAction?.navigated();
    session.deviceUploads?.clear();
    session.currentUrl = url;
    this.comparisons.navigated(session.projectId, session.sessionId, url);
    recheckAccount();
    session.lastError = null;
    // Errors belong to the page that logged them.
    session.pageErrors = null;
    session.transientError = null;
    session.certificateError = null;
    session.crashRecoveryAttempts = 0;
    session.crashRecoveryWindowStartedAt = null;
    refreshNavigationState();
    this.emitState(session);
  });
  contents.on("certificate-error", (event, _url, error, _certificate, callback) => {
    event.preventDefault();
    session.figmaCanvasReview = undefined;
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
  contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
    if (mainFrame === false) return;
    session.inPageApprovalRevision = (session.inPageApprovalRevision ?? 0) + 1;
    if (session.workflowSubmission?.definition.url !== url) session.workflowSubmission = undefined;
    if (session.partnerCenterStatus?.page.url !== url) session.partnerCenterStatus = undefined;
    session.figmaCanvasReview = undefined;
    installSelectionDrag();
    invalidatePageScope(url);
    recheckAccount();
    session.quickAction?.navigated();
    session.deviceUploads?.clear();
    session.currentUrl = url;
    this.comparisons.navigated(session.projectId, session.sessionId, url);
    refreshNavigationState();
    this.emitState(session);
  });
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }
    session.loading = false;
    session.figmaCanvasReview = undefined;
    session.failedMainFrame = { contents, url: validatedUrl };
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
  });
  // A blank embed used to be indistinguishable from a crash: if the page's
  // renderer process died, the WebContentsView just painted its background color
  // with no indication. Surface it as an error (which the UI shows with a
  // reload affordance) instead of a silent black void.
  contents.on("render-process-gone", (_event, details) => {
    session.loading = false;
    session.partnerCenterStatus = undefined;
    session.figmaCanvasReview = undefined;
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
      ...(sanitizedSource.length > 0 ? { source: `${sanitizedSource}:${details.lineNumber}` } : {}),
    });
    if (details.level === "error") {
      // Count every error but publish at most a few times a second, so a page
      // logging in a loop cannot flood the renderer with state updates.
      const latest = {
        text: details.message.slice(0, 2000),
        at: new Date().toISOString(),
        ...(sanitizedSource.length > 0
          ? { source: `${sanitizedSource}:${details.lineNumber}` }
          : {}),
      };
      session.pageErrors = {
        count: (session.pageErrors?.count ?? 0) + 1,
        latest,
      };
      if (!session.pageErrorEmitTimer) {
        session.pageErrorEmitTimer = setTimeout(() => {
          session.pageErrorEmitTimer = undefined;
          this.emitState(session);
        }, 250);
      }
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
    if (session.verificationLease === this.attachmentEntryLease) return { action: "deny" };
    if (
      session.controller !== "human" &&
      (session.quickActionScope || (session.pageGrant && session.controller === "agent"))
    ) {
      session.controlEpoch++;
      return { action: "deny" };
    }
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
  // The page paints above the app's DOM, so the themed menu is drawn by the renderer over a
  // snapshot of this view (see openContextMenu). No native menu is ever popped here.
  contents.on("context-menu", (_event, params) => {
    void this.openContextMenu(session, params);
  });
}

/** Snapshots the page, hides its native view and asks the renderer to draw the themed menu. */
export async function openContextMenu(
  this: BrowserHostManager,
  session: BrowserSession,
  params: Electron.ContextMenuParams,
): Promise<void> {
  const window = this.getWindow();
  const contents = session.view.webContents;
  if (!window || window.isDestroyed() || contents.isDestroyed() || !session.bounds) return;
  if (this.activeKey !== session.key) return;
  for (const token of [...this.pendingContextMenus.keys()]) this.settleContextMenu(token, null);
  let snapshot: string;
  try {
    const image = await contents.capturePage();
    if (image.isEmpty()) return;
    snapshot = `data:image/jpeg;base64,${image.toJPEG(90).toString("base64")}`;
  } catch {
    return;
  }
  if (window.isDestroyed() || !session.bounds || this.activeKey !== session.key) return;
  const { pending, items } = pendingFromParams({
    x: params.x,
    y: params.y,
    linkURL: params.linkURL,
    srcURL: params.srcURL,
    mediaType: params.mediaType,
    selectionText: params.selectionText,
    isEditable: params.isEditable,
    misspelledWord: params.misspelledWord,
    dictionarySuggestions: params.dictionarySuggestions,
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
    canCut: params.editFlags.canCut,
    canCopy: params.editFlags.canCopy,
    canPaste: params.editFlags.canPaste,
    pageUrl: contents.getURL(),
  });
  const token = randomUUID();
  // Safety net: never leave the page hidden if the renderer goes away.
  const timer = setTimeout(() => this.settleContextMenu(token, null), 60_000);
  this.pendingContextMenus.set(token, { session, menu: pending, timer });
  const zoom = window.webContents.getZoomFactor() || 1;
  const bounds = session.bounds;
  window.webContents.send(BROWSER_CONTEXT_MENU_CHANNEL, {
    token,
    snapshot,
    bounds: {
      x: bounds.x / zoom,
      y: bounds.y / zoom,
      width: bounds.width / zoom,
      height: bounds.height / zoom,
    },
    point: {
      x: (bounds.x + params.x) / zoom,
      y: (bounds.y + params.y) / zoom,
    },
    items,
  });
}
