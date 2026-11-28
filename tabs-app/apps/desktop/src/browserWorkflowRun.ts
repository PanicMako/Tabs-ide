import { isUserBrowserTab } from "@tabs/shared/preview";
import { matchesPageScope, pageOrigin, PAGE_READY_FOR_AGENT } from "./browserPageGrant";
import { browserWorkflowHostKey } from "./browserWorkflowHostId";
import { type BrowserAttachmentBookmark } from "./browserAttachmentBookmarks";
import { browserWorkflowPageScript } from "./browserWorkflowPage";
import { checkAttachmentPage } from "./browserScreenshotReceipts";
import { isLikelyAuthenticationUrl } from "./authClassifier";
import { isPersistentPartition } from "./profileStorage";
import { app } from "electron";
import * as Schema from "effect/Schema";
import {
  BrowserWorkflowBrowserRequest,
  type BrowserWorkflowHostResult,
  BrowserWorkflowPageResult,
  BrowserWorkflowSavedResult,
  type BrowserWorkflowReceipt,
  BrowserWorkflowStage,
} from "@tabs/contracts";
import {
  BrowserSession,
  CHROMIUM_ERROR_DOCUMENT,
  BrowserAutomationRequest,
  isBrowserAttachmentUrl,
  waitForExactBrowserPage,
  checkGuardedWorkflowDefinition,
} from "./browserHostSupport";
import type { BrowserHostManager } from "./browserHostManager";

export async function openSavedAttachment(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
  threadId: string,
  saved: BrowserAttachmentBookmark | undefined,
  digests?: readonly string[],
  options?: {
    reload?: boolean;
    matchesDestination?: (url: string) => boolean;
    verifyResult?: (readPage: (expression: string) => Promise<unknown>) => Promise<void>;
  },
): Promise<{ url: string }> {
  const wrongTab = "Open the saved attachment in its original desktop browser tab and profile.";
  if (
    !saved ||
    saved.threadId !== threadId ||
    saved.partition !== session.partition ||
    (saved.managerId === this.attachmentManagerId && saved.instanceId !== session.instanceId)
  )
    throw new Error(wrongTab);
  const { contents, browserSession, storagePath } = this.requireSavedBrowserTarget(
    session,
    request,
    saved,
    wrongTab,
  );
  if (
    session.controller === "agent" ||
    session.verificationLease ||
    session.pendingPermission ||
    session.loading ||
    contents.isLoadingMainFrame() ||
    session.actionTimeline.some((action) => action.status === "running") ||
    session.journeyRecorder?.status().recording
  )
    throw new Error("The saved attachment's browser tab is already in use.");

  const url = saved.url;
  const current = contents.getURL();
  const matchesDestination = options?.matchesDestination ?? ((candidate) => candidate === url);
  const needsNavigation = !matchesDestination(current) || options?.reload === true;
  const restingUrl = session.resting?.snapshot.currentUrl;
  const protectedPage = "Finish signing in or leave protected content in the browser tab.";
  const isProtectedAddress = (address: string | null | undefined) =>
    !!address && address !== "about:blank" && !isBrowserAttachmentUrl(address);
  if (!isBrowserAttachmentUrl(url) || isProtectedAddress(current) || isProtectedAddress(restingUrl))
    throw new Error(protectedPage);

  const { instanceId, assignedTaskId, controlEpoch } = session;
  const lease = this.attachmentEntryLease;
  const changed = "The browser tab could not open the exact saved attachment URL.";
  const checkSession = () => {
    if (
      this.sessions.get(session.key) !== session ||
      session.view.webContents !== contents ||
      contents.isDestroyed() ||
      contents.session !== browserSession ||
      browserSession.storagePath !== storagePath ||
      session.partition !== saved.partition ||
      (session.profileId ?? "default") !== saved.profileId ||
      session.instanceId !== instanceId ||
      session.assignedTaskId !== assignedTaskId ||
      session.controller === "agent" ||
      session.verificationLease !== lease
    )
      throw new Error(changed);
  };
  const checkUnprotectedPage = async (address: string, requiredDigests?: readonly string[]) => {
    const { pageRevision, mainFrameNavigationRevision, controlEpoch } = session;
    const page = await checkAttachmentPage(
      contents,
      address,
      requiredDigests,
      saved.verifyScreenshotImages === true,
    );
    checkSession();
    if (
      contents.getURL() !== address ||
      contents.isLoadingMainFrame() ||
      session.mainFrameNavigationRevision !== mainFrameNavigationRevision ||
      session.pageRevision !== pageRevision ||
      session.controlEpoch !== controlEpoch
    )
      throw new Error(changed);
    if (page === "protected") throw new Error(protectedPage);
    if (page === "missing_receipt")
      throw new Error("The saved draft no longer shows the approved screenshot receipt.");
  };
  session.verificationLease = lease;
  try {
    if (needsNavigation && pageOrigin(current)) await checkUnprotectedPage(current);
    checkSession();
    if (contents.getURL() !== current || session.controlEpoch !== controlEpoch)
      throw new Error(changed);
    const placeholder = session.resting ? contents.navigationHistory.getActiveIndex() : undefined;
    session.resting = undefined;
    if (needsNavigation) {
      const grantWillExpire = session.pageGrant && !matchesPageScope(session.pageGrant, url);
      await waitForExactBrowserPage(
        contents,
        matchesDestination,
        changed,
        () => contents.loadURL(url),
        { cancelOnFailure: true, rejectAuthentication: true },
      );
      checkSession();
      if (session.controlEpoch !== controlEpoch + (grantWillExpire ? 1 : 0))
        throw new Error(changed);
    }
    const resultUrl = contents.getURL();
    if (!matchesDestination(resultUrl)) throw new Error(changed);
    await checkUnprotectedPage(resultUrl, digests);
    if (options?.verifyResult) {
      const { controlEpoch, pageRevision } = session;
      const checkResultPage = () => {
        checkSession();
        if (
          contents.getURL() !== resultUrl ||
          contents.isLoadingMainFrame() ||
          session.controlEpoch !== controlEpoch ||
          session.pageRevision !== pageRevision
        )
          throw new Error(changed);
      };
      await options.verifyResult(async (expression) => {
        checkResultPage();
        const value: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [
          {
            code: `location.href === ${JSON.stringify(resultUrl)} ? (${expression}) : "scope"`,
          },
        ]);
        checkResultPage();
        return value;
      });
    }
    checkSession();
    if (contents.getURL() !== resultUrl || contents.isLoadingMainFrame()) throw new Error(changed);
    if (placeholder !== undefined && placeholder !== contents.navigationHistory.getActiveIndex())
      contents.navigationHistory.removeEntryAtIndex(placeholder);
    return {
      url: resultUrl,
      ...(digests && { receiptKind: "image" as const }),
    };
  } finally {
    if (session.verificationLease === lease) session.verificationLease = undefined;
  }
}

export function requireSavedBrowserTarget(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
  target: Pick<BrowserAttachmentBookmark, "projectId" | "tabId" | "profileId" | "hostKey">,
  wrongTab: string,
) {
  const contents = session.view.webContents;
  const profileId = session.profileId ?? "default";
  if (contents.isDestroyed()) throw new Error(wrongTab);
  const browserSession = contents.session;
  const storagePath = browserSession.storagePath;
  if (
    target.projectId !== request.projectId ||
    target.projectId !== session.projectId ||
    target.tabId !== request.sessionId ||
    target.tabId !== session.sessionId ||
    target.profileId !== profileId ||
    !isPersistentPartition(session.partition) ||
    !storagePath ||
    !browserSession.isPersistent()
  )
    throw new Error(wrongTab);
  let hostKey: string;
  try {
    hostKey = browserWorkflowHostKey(app.getPath("userData"), storagePath, false);
  } catch {
    throw new Error(wrongTab);
  }
  if (target.hostKey !== hostKey) throw new Error(wrongTab);
  return { contents, browserSession, storagePath };
}

export async function enterBrowserWorkflowResult(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
): Promise<BrowserWorkflowReceipt> {
  const { target, definition, stage, pendingAction, submitRequiresUser } = Schema.decodeUnknownSync(
    BrowserWorkflowSavedResult,
  )(request.input);
  checkGuardedWorkflowDefinition(definition);
  const { contents, browserSession, storagePath } = this.requireSavedBrowserTarget(
    session,
    request,
    target,
    "Open the saved result in its original desktop browser tab and profile.",
  );
  const assignedTaskId = session.assignedTaskId;
  if (assignedTaskId && assignedTaskId !== request.taskId)
    throw new Error("The saved result's browser tab belongs to another thread.");
  if (
    session.verificationLease ||
    this.workflowRefreshes.has(session) ||
    session.actionTimeline.some((action) => action.status === "running") ||
    session.journeyRecorder?.status().recording
  )
    throw new Error("The saved result's browser tab is already in use.");

  const url = definition.url;
  const protectedPage = "Finish signing in or go back from protected content in the browser tab.";
  const isWebPage = (address: string) =>
    !!pageOrigin(address) && !isLikelyAuthenticationUrl(address);
  if (!isWebPage(url) || new URL(url).href !== url) throw new Error(protectedPage);
  const isProtectedAddress = (address: string | null | undefined) =>
    !!address && address !== "about:blank" && !isWebPage(address);
  const partition = session.partition;
  const token = Symbol("enter-browser-workflow-result");
  session.verificationLease = token;
  const changedPage = "The browser tab or page changed while opening the saved result.";
  const checkSession = () => {
    if (
      this.sessions.get(session.key) !== session ||
      session.view.webContents !== contents ||
      contents.isDestroyed() ||
      session.partition !== partition ||
      contents.session !== browserSession ||
      browserSession.storagePath !== storagePath ||
      session.assignedTaskId !== assignedTaskId ||
      session.verificationLease !== token
    )
      throw new Error(changedPage);
  };
  const readPage = async (address: string, code: string, allowErrorDocument = false) => {
    const { pageRevision, mainFrameNavigationRevision, controlEpoch } = session;
    const result: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `location.href === ${JSON.stringify(address)} ? (${code}) :
          ${allowErrorDocument ? `location.href === ${JSON.stringify(CHROMIUM_ERROR_DOCUMENT)}` : "null"}`,
      },
    ]);
    checkSession();
    if (
      contents.getURL() !== address ||
      session.pageRevision !== pageRevision ||
      session.mainFrameNavigationRevision !== mainFrameNavigationRevision ||
      session.controlEpoch !== controlEpoch ||
      contents.isLoadingMainFrame()
    )
      throw new Error(changedPage);
    return result;
  };
  try {
    const current = contents.getURL();
    const loading = session.loading || contents.isLoadingMainFrame();
    const readOnly = definition.readOnly === true;
    if (readOnly && current !== url && session.workflowSubmission)
      throw new Error("Finish reviewing the current draft before opening the saved result.");
    const checkingSubmit =
      !readOnly &&
      stage === "uploaded" &&
      (pendingAction === "submit" || submitRequiresUser === true);
    const checkingUpload = !readOnly && stage === "ready_to_upload" && pendingAction === "upload";
    const checkingWrite = checkingSubmit || checkingUpload;
    const failure = session.failedMainFrame;
    const recoveringError =
      checkingWrite &&
      failure?.contents === contents &&
      (current === CHROMIUM_ERROR_DOCUMENT || current === failure.url) &&
      isWebPage(failure.url) &&
      pageOrigin(failure.url) === pageOrigin(url);
    // Read a healthy upload draft in place so that checking cannot clear its file.
    // A failed navigation or a different page can return to the saved draft with a GET.
    const refresh =
      !loading && (checkingSubmit || (checkingUpload && (recoveringError || current !== url)));
    if (
      (isProtectedAddress(current) && !recoveringError) ||
      isProtectedAddress(session.resting?.snapshot.currentUrl) ||
      (checkingWrite && session.pendingPermission)
    )
      throw new Error(protectedPage);
    if (current !== url && loading)
      throw new Error("Wait for the browser tab's current page to finish loading.");
    if (
      (current !== url || refresh) &&
      isWebPage(current) &&
      (await readPage(current, PAGE_READY_FOR_AGENT, recoveringError)) !== true
    )
      throw new Error(protectedPage);
    if (current !== url || loading || session.resting || refresh) {
      const placeholder = session.resting ? contents.navigationHistory.getActiveIndex() : undefined;
      session.resting = undefined;
      if (current !== url || loading || refresh) {
        await waitForExactBrowserPage(
          contents,
          (candidate) => candidate === url,
          "The browser tab could not open the exact saved result URL.",
          // A saved result can follow a form POST. Load with GET to avoid replaying it.
          () =>
            refresh
              ? contents.loadURL(url, {
                  extraHeaders: "Cache-Control: no-cache\n",
                })
              : current !== url
                ? contents.loadURL(url)
                : undefined,
          {
            cancelOnFailure: true,
            preservePageNavigation: checkingWrite,
            rejectAuthentication: checkingWrite,
          },
        );
      }
      checkSession();
      if (contents.getURL() !== url) throw new Error(changedPage);
      if (placeholder !== undefined && placeholder !== contents.navigationHistory.getActiveIndex())
        contents.navigationHistory.removeEntryAtIndex(placeholder);
    }
    const operation = browserWorkflowPageScript(definition, false, true);
    const result = await readPage(url, `(${PAGE_READY_FOR_AGENT}) ? (${operation}) : null`);
    if (result === null) throw new Error(protectedPage);
    const checked = Schema.decodeUnknownSync(BrowserWorkflowPageResult)(result);
    if (checked.disposition !== "observed" || !checked.observation)
      throw new Error(
        checked.reason ?? "The saved draft's identity or status could not be verified.",
      );
    const observed = checked.observation.stage;
    const stages = BrowserWorkflowStage.literals;
    if (
      definition.states[observed] !== checked.observation.statusText ||
      stages.indexOf(observed) < stages.indexOf(stage)
    )
      throw new Error("The visible draft no longer shows the saved workflow stage.");
    return {
      target,
      stage: observed,
      statusText: checked.observation.statusText,
      ...(checked.observation.identityText !== undefined && {
        identityText: checked.observation.identityText,
      }),
      observedAt: new Date().toISOString(),
    };
  } finally {
    if (session.verificationLease === token) session.verificationLease = undefined;
  }
}

export async function monitorBrowserWorkflow(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
  workflow: BrowserWorkflowBrowserRequest,
): Promise<BrowserWorkflowHostResult> {
  const { definition, target } = workflow;
  checkGuardedWorkflowDefinition(definition);
  if (
    request.source !== "agent" ||
    !isUserBrowserTab(session.sessionId) ||
    !target ||
    !workflow.workflowId ||
    workflow.statusOnly !== true
  )
    throw new Error("Monitor requires a saved workflow and its approved browser tab.");

  const partition = session.partition;
  const wrongTarget = "The workflow belongs to another browser host, profile or tab.";
  if (workflow.profileId !== target.profileId) throw new Error(wrongTarget);
  const { contents, browserSession, storagePath } = this.requireSavedBrowserTarget(
    session,
    request,
    target,
    wrongTarget,
  );

  const url = definition.url;
  const grant = session.pageGrant;
  const epoch = session.controlEpoch;
  const checkPage = () => {
    if (
      !grant ||
      !request.taskId ||
      grant.taskId !== request.taskId ||
      session.assignedTaskId !== request.taskId ||
      session.pageGrant !== grant ||
      grant.partition !== partition ||
      session.controlEpoch !== epoch ||
      session.controller === "human"
    )
      throw new Error("Approve access to the original page and profile in Browser tools.");
    if (
      this.sessions.get(session.key) !== session ||
      session.view.webContents !== contents ||
      contents.isDestroyed() ||
      session.partition !== partition ||
      contents.session !== browserSession ||
      browserSession.storagePath !== storagePath ||
      session.resting ||
      contents.getURL() !== url ||
      !matchesPageScope(grant, url)
    )
      throw new Error("The browser tab must be on the original workflow URL.");
  };
  checkPage();
  if (session.loading || contents.isLoadingMainFrame())
    throw new Error("Wait for the original workflow page to finish loading.");

  const operation = browserWorkflowPageScript(definition, false, true);
  const readStatus = async (): Promise<BrowserWorkflowHostResult> => {
    checkPage();
    const revision = session.pageRevision;
    const result: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `location.href === ${JSON.stringify(url)} && (${PAGE_READY_FOR_AGENT})
          ? (${operation}) : null`,
      },
    ]);
    checkPage();
    if (session.pageRevision !== revision || contents.isLoadingMainFrame())
      throw new Error("The workflow page changed while reading its status.");
    const page =
      result === null ? undefined : Schema.decodeUnknownSync(BrowserWorkflowPageResult)(result);
    if (page?.disposition === "observed" && page.observation) {
      const { stage, statusText, identityText } = page.observation;
      return {
        target,
        disposition: "observed",
        observation: {
          stage,
          statusText,
          breakpoint: "irrelevant",
          submitAvailable: false,
          ...(identityText !== undefined && { identityText }),
        },
      };
    }
    return {
      target,
      disposition: "unobservable",
      reason: page?.reason ?? "Protected input or a frame requires human review.",
    };
  };

  const current = await readStatus();
  if (
    workflow.refresh !== true ||
    current.disposition !== "observed" ||
    (this.activeKey === session.key && session.bounds !== null) ||
    (session.pictureInPictureWindow && !session.pictureInPictureWindow.isDestroyed()) ||
    session.devToolsOpen ||
    session.pendingPermission ||
    session.workflowSubmission ||
    (definition.readOnly === true && this.submissionGuards.has(partition, url)) ||
    session.verificationLease ||
    this.workflowRefreshes.has(session) ||
    session.actionTimeline.some((action) => action.status === "running") ||
    session.journeyRecorder?.status().recording ||
    session.loading ||
    contents.isLoadingMainFrame()
  )
    return current;

  checkPage();
  this.workflowRefreshes.add(session);
  try {
    await waitForExactBrowserPage(
      contents,
      (candidate) => candidate === url,
      "The browser tab could not refresh the original workflow URL.",
      // Load with GET so a status page reached through POST cannot replay the submission.
      () => contents.loadURL(url),
      { cancelOnFailure: true, preservePageNavigation: true },
    );
    return await readStatus();
  } finally {
    this.workflowRefreshes.delete(session);
  }
}
