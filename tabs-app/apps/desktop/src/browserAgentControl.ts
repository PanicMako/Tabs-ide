import { isUserBrowserTab } from "@tabs/shared/preview";
import {
  demonstrateControlScript,
  grantedPageAddress,
  matchesPageScope,
  readBrowserDemonstrationScript,
} from "./browserPageGrant";
import { deriveBrowserPartition, extractProfileIdFromPartition } from "./profileStorage";
import { WebContentsView } from "electron";
import { randomUUID } from "node:crypto";
import { BROWSER_DEMONSTRATION_CHANGES } from "@tabs/contracts";
import type {
  DesktopBrowserDemonstrationReceipt,
  DesktopBrowserHostControlInput,
  DesktopBrowserHostEnsureSessionInput,
  DesktopBridge,
  PreviewAnnotationPayload,
  PickedElementPayload,
} from "@tabs/contracts";
import { BrowserCdpCoordinator } from "./browserCdpCoordinator";
import { BrowserSession, appendBounded } from "./browserHostSupport";
import { revokeScreenshotAttempts } from "./browserDeviceScreenshots";
import { observeProfileSession } from "./browserProfileStorage";
import { registerSessionEvents } from "./browserSessionEvents";
import { configurePartitionSession, type BrowserHostManager } from "./browserHostManager";
import {
  defaultPermissionMediator,
  DEFAULT_SESSION_ID,
  AGENT_PARTITION_PREFIX,
  withTimeout,
} from "./browserHostSupport";

export async function ensureSession(
  this: BrowserHostManager,
  input: DesktopBrowserHostEnsureSessionInput,
): Promise<void> {
  const key = this.sessionKey(input.projectId, input.sessionId);
  const existing = this.sessions.get(key);
  if (input.requireExisting && !existing) {
    throw new Error("The selected tab is no longer open. Attach the intended tab again.");
  }
  const sessionId = input.sessionId ?? DEFAULT_SESSION_ID;
  if (!existing && (input.temporaryAgentTab || input.taskId) && isUserBrowserTab(sessionId)) {
    throw new Error("Open the user’s browser tab before attaching it to a thread.");
  }
  const useExistingPartition =
    existing &&
    (existing.temporaryAgentTab ||
      input.temporaryAgentTab ||
      (input.taskId && isUserBrowserTab(sessionId)));
  const isolatedPartition =
    !existing && input.temporaryAgentTab ? `${AGENT_PARTITION_PREFIX}${randomUUID()}` : undefined;
  const partition =
    (useExistingPartition ? existing.partition : isolatedPartition) ??
    input.partition ??
    (input.profileId && input.profileId !== "default"
      ? deriveBrowserPartition({
          profileId: input.profileId,
          ephemeral: input.profileId === "incognito",
        })
      : ((input.profileId === "default" ? undefined : existing?.partition) ??
        `persist:tabs-browser:${input.projectId}`));
  if (existing) {
    const grant = existing.pageGrant;
    if (
      input.taskId &&
      isUserBrowserTab(existing.sessionId) &&
      (!grant ||
        grant.taskId !== input.taskId ||
        grant.partition !== existing.partition ||
        !matchesPageScope(grant, existing.view.webContents.getURL()))
    ) {
      throw new Error("Approve browser access in the selected tab’s Browser tools menu.");
    }
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

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition,
    },
  });
  this.recordPartition(partition);
  configurePartitionSession(view.webContents.session, partition);
  this.observeProfileSession(partition, view.webContents.session);
  view.setBackgroundColor("#111111");

  const initialZoom = this.getWindow()?.webContents?.getZoomFactor() ?? 1.0;
  view.webContents?.setZoomFactor(initialZoom);

  const session: BrowserSession = {
    instanceId: randomUUID(),
    projectId: input.projectId,
    sessionId,
    partition,
    profileId: isolatedPartition
      ? undefined
      : (input.profileId ?? extractProfileIdFromPartition(partition) ?? undefined),
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
  const firstLoad = (async () => {
    if (input.initialUrl) {
      await this.loadUrl(session, input.initialUrl);
    } else {
      await view.webContents.loadURL("about:blank");
    }
    await this.applyColorScheme(session);
  })();
  // An on-screen browser must be attachable while its first page loads;
  // waiting here left the view detached (a blank frame) for the whole load.
  if (input.waitForLoad === false) {
    firstLoad.catch(() => undefined);
    return;
  }
  await firstLoad;
}

export async function recreateSession(
  this: BrowserHostManager,
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
  session.partnerCenterStatus = undefined;
  session.figmaCanvasReview = undefined;
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
  configurePartitionSession(view.webContents.session, partition);
  this.observeProfileSession(partition, view.webContents.session);
  view.setBackgroundColor("#111111");

  const initialZoom = this.getWindow()?.webContents?.getZoomFactor() ?? 1.0;
  view.webContents?.setZoomFactor(initialZoom * session.zoomFactor);
  view.webContents.setAudioMuted(session.audioMuted);

  session.view = view;
  session.instanceId = randomUUID();
  if (session.partition !== partition) {
    this.revokeScreenshotAttempts(session);
    session.demonstration = undefined;
    session.pageGrant = undefined;
    session.actionTimeline = [];
    session.deviceUploads?.clear();
    session.profileId = extractProfileIdFromPartition(partition) ?? undefined;
    session.assignedTaskId = null;
    session.controller = "human";
    session.humanControlLocked = true;
  } else session.screenshotAttempts?.clear();
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

export async function pickElement(
  this: BrowserHostManager,
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
        zIndex: "2147483647", padding: "8px 12px", borderRadius: "36px",
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

export function takeControl(
  this: BrowserHostManager,
  input: DesktopBrowserHostControlInput & { demonstrate?: boolean },
): void {
  const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
  if (!session) return;
  session.controlEpoch = (session.controlEpoch ?? 0) + 1;
  this.revokeScreenshotAttempts(session);
  session.controller = "human";
  session.humanControlLocked = true;
  session.workflowSubmission = undefined;
  session.partnerCenterStatus = undefined;
  session.figmaCanvasReview = undefined;
  session.quickAction?.revoke();
  session.userRetained = true;
  this.clearHumanControlTimer(session);
  session.demonstration = undefined;
  session.returningDemonstration = undefined;
  const grant = session.pageGrant;
  const contents = session.view.webContents;
  if (
    input.demonstrate &&
    grant &&
    grant.taskId === session.assignedTaskId &&
    grant.partition === session.partition &&
    matchesPageScope(grant, contents.getURL())
  ) {
    const step: NonNullable<BrowserSession["demonstration"]> = {
      grant,
      token: randomUUID(),
      before: grantedPageAddress(contents.getURL()),
    };
    session.demonstration = step;
    void contents
      .executeJavaScriptInIsolatedWorld(999, [
        { code: demonstrateControlScript(contents.getURL(), step.token) },
      ])
      .then((observed: unknown) => {
        if (
          session.demonstration !== step ||
          session.pageGrant !== grant ||
          session.controller !== "human" ||
          !observed ||
          typeof observed !== "object"
        )
          return;
        const target = observed as Record<string, unknown>;
        const parts = [target.role, target.label, target.context, target.identifier].filter(
          (part): part is string =>
            typeof part === "string" && part.length > 0 && part.length <= 100,
        );
        if (!parts.length) return;
        step.control = parts.join(" · ");
        this.emitState(session);
      })
      .catch(() => undefined);
  }
  this.emitState(session);
}

export async function resumeAgent(
  this: BrowserHostManager,
  input: Parameters<NonNullable<DesktopBridge["resumeBrowserAgent"]>>[0],
): Promise<DesktopBrowserDemonstrationReceipt | void> {
  const session = this.sessions.get(this.sessionKey(input.projectId, input.sessionId));
  const expected = input.expectedGeneration;
  const handoffChanged = "The tab changed while returning control. Check the page and try again.";
  if (expected) {
    const grant = session?.pageGrant;
    const contents = session?.view.webContents;
    if (
      !session ||
      !grant ||
      !contents ||
      session.instanceId !== expected.instanceId ||
      session.controlEpoch !== expected.controlEpoch ||
      session.controller !== "human" ||
      !input.taskId ||
      session.assignedTaskId !== input.taskId ||
      grant.taskId !== input.taskId ||
      grant.partition !== session.partition ||
      contents.isDestroyed() ||
      contents.isCrashed() ||
      !matchesPageScope(grant, contents.getURL())
    )
      throw new Error(handoffChanged);
  }
  if (!session) return;
  if (input.taskId && session.assignedTaskId && session.assignedTaskId !== input.taskId) {
    throw new Error(`Cannot resume tab assigned to task "${session.assignedTaskId}".`);
  }
  const step = session.demonstration;
  if (session.returningDemonstration) throw new Error("The browser is already returning control.");
  let demonstrationId: string | undefined;
  if (step && step.grant === session.pageGrant && step.grant.taskId === input.taskId) {
    const contents = session.view.webContents;
    const url = contents.getURL();
    const { controlEpoch, pageRevision } = session;
    const meaning = input.meaning?.trim().slice(0, 320);
    if (
      (step.control || meaning) &&
      step.grant.partition === session.partition &&
      matchesPageScope(step.grant, url)
    ) {
      let changes: unknown;
      if (step.control) {
        session.returningDemonstration = step.token;
        try {
          changes = await withTimeout(
            contents.executeJavaScriptInIsolatedWorld(999, [
              {
                code: readBrowserDemonstrationScript(url, step.token),
              },
            ]),
            2_000,
            "The browser could not finish checking the demonstration.",
          );
        } catch {
          // The page may have navigated or no longer expose the demonstrated control.
        } finally {
          if (session.returningDemonstration === step.token)
            session.returningDemonstration = undefined;
        }
        if (
          this.sessions.get(session.key) !== session ||
          session.demonstration !== step ||
          session.pageGrant !== step.grant ||
          session.view.webContents !== contents ||
          contents.isDestroyed() ||
          contents.getURL() !== url ||
          session.controlEpoch !== controlEpoch ||
          session.pageRevision !== pageRevision ||
          (expected &&
            (session.instanceId !== expected.instanceId ||
              session.controller !== "human" ||
              contents.isCrashed()))
        )
          throw new Error(handoffChanged);
      }
      const observedChanges = Array.isArray(changes)
        ? BROWSER_DEMONSTRATION_CHANGES.filter((change) => changes.includes(change))
        : [];
      const after = grantedPageAddress(url);
      const action = [
        "User demonstration",
        step.control,
        meaning,
        step.before,
        after !== step.before ? after : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      const now = new Date().toISOString();
      const id = randomUUID();
      appendBounded(session.actionTimeline, {
        id,
        action,
        ...(observedChanges.length ? { observedChanges } : {}),
        status: "succeeded",
        startedAt: now,
        completedAt: now,
      });
      if (Array.isArray(changes) && changes.length === observedChanges.length) demonstrationId = id;
    }
  }
  this.returnControlToAgent(session);
  this.emitState(session);
  if (demonstrationId) return { demonstrationId, controlEpoch: session.controlEpoch };
}
