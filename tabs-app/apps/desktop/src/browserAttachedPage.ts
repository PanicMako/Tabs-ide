import { BROWSER_SELECTION_MAX_LENGTH, isUserBrowserTab } from "@tabs/shared/preview";
import { matchesPageScope, pageOrigin, READ_BROWSER_SELECTION } from "./browserPageGrant";
import { browserWorkflowHostKey } from "./browserWorkflowHostId";
import { type BrowserAttachmentBookmark } from "./browserAttachmentBookmarks";
import { checkAttachmentPage } from "./browserScreenshotReceipts";
import { isLikelyAuthenticationUrl } from "./authClassifier";
import { isPersistentPartition } from "./profileStorage";
import { app } from "electron";
import {
  BrowserSession,
  BrowserAutomationRequest,
  isBrowserAttachmentUrl,
  waitForExactBrowserPage,
  automationInput,
  matchesScreenshotDraftUrl,
} from "./browserHostSupport";
import { openSavedAttachment } from "./browserWorkflowRun";
import type { BrowserHostManager } from "./browserHostManager";

export async function readBrowserSelection(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
) {
  const { pageRef, instanceId, profileId, dragToken, droppedText } = automationInput(request.input);
  const contents = session.view.webContents;
  if (
    request.source !== "human" ||
    typeof request.taskId !== "string" ||
    !request.taskId.trim() ||
    !isUserBrowserTab(session.sessionId)
  )
    throw new Error("Review a text selection from a browser tab in the conversation.");

  const pageChanged = "The tab, page or profile changed. Select the text again.";
  if (contents.isDestroyed()) throw new Error(pageChanged);
  const url = contents.getURL();
  const revision = session.pageRevision;
  const epoch = session.controlEpoch;
  const isDrop = dragToken !== undefined || droppedText !== undefined;
  const excerpt =
    typeof droppedText === "string" ? droppedText.replaceAll("\r\n", "\n") : undefined;
  const dragChanged = "The dragged selection changed. Select the text and drag it again.";
  if (
    isDrop &&
    (typeof dragToken !== "string" ||
      !excerpt?.trim() ||
      excerpt.length > BROWSER_SELECTION_MAX_LENGTH)
  )
    throw new Error(dragChanged);
  const checkPage = () => {
    if (
      this.sessions.get(session.key) !== session ||
      session.view.webContents !== contents ||
      contents.isDestroyed() ||
      session.loading ||
      session.resting ||
      session.pageRevision !== revision ||
      session.controlEpoch !== epoch ||
      instanceId !== session.instanceId ||
      profileId !== (session.profileId ?? "default") ||
      (session.assignedTaskId && session.assignedTaskId !== request.taskId) ||
      contents.getURL() !== url ||
      pageRef !== this.pageReference(session, url)
    )
      throw new Error(pageChanged);
    if (session.controller === "agent" || session.verificationLease)
      throw new Error("Take control of the tab before reviewing a text selection.");
    if (
      isDrop &&
      (session.selectionDrag?.token !== dragToken || session.selectionDrag?.url !== url)
    )
      throw new Error(dragChanged);
  };
  if (!pageOrigin(url) || isLikelyAuthenticationUrl(url))
    throw new Error("Finish signing in before sharing a text selection.");
  checkPage();
  const text: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [
    {
      code: `location.href === ${JSON.stringify(url)} ? (${READ_BROWSER_SELECTION}) : null`,
    },
  ]);
  checkPage();
  if (typeof text !== "string" || !text.trim() || text.length > BROWSER_SELECTION_MAX_LENGTH)
    throw new Error(
      "Select up to 1,000 characters of visible page text outside editable or protected fields.",
    );
  if (isDrop && excerpt !== text.replaceAll("\r\n", "\n")) throw new Error(dragChanged);
  return { text };
}

export async function enterAttachedPage(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
) {
  const target = automationInput(request.input);
  const contents = session.view.webContents;
  if (
    request.source !== "human" ||
    !request.taskId ||
    (session.assignedTaskId && session.assignedTaskId !== request.taskId) ||
    target.profileId !== (session.profileId ?? "default") ||
    typeof target.pageRef !== "string" ||
    !/^[a-f0-9]{64}$/.test(target.pageRef)
  )
    throw new Error("Open the original attachment in its approved browser profile and thread.");

  const receiptFor = (grantId: unknown) =>
    session.screenshotDrafts?.find(
      (entry) =>
        entry.grantId === grantId &&
        entry.taskId === request.taskId &&
        entry.partition === session.partition &&
        entry.pageRef === target.pageRef &&
        entry.pageRef === this.pageReference(session, entry.url) &&
        entry.verifiedUrl &&
        matchesScreenshotDraftUrl(entry, entry.verifiedUrl),
    );
  const draft = receiptFor(target.grantId);
  const paired = target.pairedGrantId === undefined ? undefined : receiptFor(target.pairedGrantId);
  if (
    target.pairedGrantId !== undefined &&
    (!draft ||
      !paired ||
      draft.pairedGrantId !== paired.grantId ||
      paired.pairedGrantId !== draft.grantId ||
      draft.verifiedUrl !== paired.verifiedUrl)
  )
    throw new Error("Both screenshot receipts must belong to the same approved draft.");
  if (draft?.pairedGrantId !== undefined && !paired)
    throw new Error("Open the attachment with both approved screenshot receipts.");
  const desired = draft?.verifiedUrl
    ? this.pageReference(session, draft.verifiedUrl)
    : target.pageRef;
  const matches = (url: string) =>
    !!pageOrigin(url) &&
    !isLikelyAuthenticationUrl(url) &&
    this.pageReference(session, url) === desired;
  const isCurrent = (epoch: number) =>
    this.sessions.get(session.key) === session &&
    session.view.webContents === contents &&
    !contents.isDestroyed() &&
    session.controlEpoch === epoch &&
    matches(contents.getURL());
  const onCurrentPage = matches(contents.getURL());
  if (!onCurrentPage || session.loading || session.resting) {
    const history = contents.navigationHistory;
    const entries = history.getAllEntries();
    const index = onCurrentPage ? undefined : entries.findLastIndex((entry) => matches(entry.url));
    if (index === -1) throw new Error("The attached page is no longer in this tab’s history.");
    const placeholder = session.resting ? history.getActiveIndex() : undefined;
    session.resting = undefined;
    const destination = index === undefined ? contents.getURL() : entries[index]!.url;
    if (session.pageGrant && !matchesPageScope(session.pageGrant, destination))
      session.pageGrant = undefined;
    this.takeControl(request);
    const epoch = session.controlEpoch;
    if (index !== undefined || session.loading)
      await waitForExactBrowserPage(
        contents,
        matches,
        "The tab could not return to the exact attached page.",
        () => {
          if (index !== undefined) history.goToIndex(index);
        },
      );
    if (!isCurrent(epoch)) throw new Error("The tab could not return to the exact attached page.");
    if (placeholder !== undefined && placeholder !== history.getActiveIndex())
      history.removeEntryAtIndex(placeholder);
  }
  if (!draft?.verifiedUrl) return { result: "attached_page" };
  const epoch = session.controlEpoch;
  const stillVerified = await checkAttachmentPage(
    contents,
    draft.verifiedUrl,
    paired ? [draft.digest, paired.digest] : [draft.digest],
    draft.verifyScreenshotImages === true || paired?.verifyScreenshotImages === true,
  );
  if (stillVerified !== "ready" || !isCurrent(epoch))
    throw new Error("The saved draft no longer shows the approved screenshot receipt.");
  return { result: "verified_draft", receiptKind: "image" as const };
}

export function attachmentThread(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
  profileId: unknown,
): string {
  if (
    request.source !== "human" ||
    typeof request.taskId !== "string" ||
    !request.taskId.trim() ||
    request.projectId !== session.projectId ||
    request.sessionId !== session.sessionId ||
    !isUserBrowserTab(session.sessionId) ||
    session.temporaryAgentTab ||
    (session.assignedTaskId && session.assignedTaskId !== request.taskId) ||
    profileId !== (session.profileId ?? "default")
  )
    throw new Error("Use the original browser tab, profile and thread for this attachment.");
  return request.taskId;
}

export function attachmentBookmark(
  this: BrowserHostManager,
  session: BrowserSession,
  threadId: string,
  url: string,
  storagePath: string,
): BrowserAttachmentBookmark {
  return {
    projectId: session.projectId,
    tabId: session.sessionId,
    profileId: session.profileId ?? "default",
    hostKey: browserWorkflowHostKey(app.getPath("userData"), storagePath),
    partition: session.partition,
    threadId,
    instanceId: session.instanceId,
    managerId: this.attachmentManagerId,
    url,
  };
}

export async function captureAttachedPage(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
): Promise<{ attachmentId: string | null }> {
  const { pageRef, instanceId, profileId } = automationInput(request.input);
  const threadId = this.attachmentThread(session, request, profileId);
  const contents = session.view.webContents;
  const changed = "The browser tab, page or profile changed. Attach the page again.";
  if (contents.isDestroyed()) throw new Error(changed);
  const url = contents.getURL();
  const { pageRevision, controlEpoch, partition, assignedTaskId, controller, verificationLease } =
    session;
  const checkPage = () => {
    if (
      this.sessions.get(session.key) !== session ||
      session.view.webContents !== contents ||
      contents.isDestroyed() ||
      session.loading ||
      contents.isLoadingMainFrame() ||
      session.resting ||
      session.pageRevision !== pageRevision ||
      session.controlEpoch !== controlEpoch ||
      session.partition !== partition ||
      session.assignedTaskId !== assignedTaskId ||
      session.controller !== controller ||
      session.verificationLease !== verificationLease ||
      session.instanceId !== instanceId ||
      (session.profileId ?? "default") !== profileId ||
      contents.getURL() !== url ||
      pageRef !== this.pageReference(session, url)
    )
      throw new Error(changed);
  };
  checkPage();
  const browserSession = contents.session;
  const storagePath = browserSession.storagePath;
  if (
    controller === "agent" ||
    verificationLease ||
    !isPersistentPartition(partition) ||
    !storagePath ||
    !browserSession.isPersistent() ||
    !isBrowserAttachmentUrl(url)
  )
    return { attachmentId: null };
  const page = await checkAttachmentPage(contents, url);
  checkPage();
  if (contents.session !== browserSession || browserSession.storagePath !== storagePath)
    throw new Error(changed);
  if (page !== "ready") return { attachmentId: null };
  try {
    return {
      attachmentId: this.attachmentBookmarks.save(
        this.attachmentBookmark(session, threadId, url, storagePath),
      ),
    };
  } catch {
    return { attachmentId: null };
  }
}

export async function enterSavedAttachedPage(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
): Promise<{ url: string }> {
  const { attachmentId, profileId } = automationInput(request.input);
  const threadId = this.attachmentThread(session, request, profileId);
  return this.openSavedAttachment(
    session,
    request,
    threadId,
    this.attachmentBookmarks.read(attachmentId),
  );
}
