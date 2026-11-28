import { isUserBrowserTab } from "@tabs/shared/preview";
import { PAGE_READY_FOR_AGENT } from "./browserPageGrant";
import { checkSubmissionGuard } from "./browserSubmissionGuard";
import { SCREENSHOT_IMAGE_RECEIPTS, SCREENSHOT_RECEIPT_MODE } from "./deviceScreenshotInput";
import { isPersistentPartition } from "./profileStorage";
import { randomUUID } from "node:crypto";
import * as Schema from "effect/Schema";
import { DeviceComparisonResultRef } from "@tabs/contracts";
import {
  ScreenshotDraft,
  DeviceEvidencePage,
  DeviceScreenshotSource,
  DeviceScreenshotGrant,
  DeviceScreenshotAttempt,
  BrowserSession,
  BrowserAutomationRequest,
  isBrowserAttachmentUrl,
  automationInput,
  isDeviceEvidenceApproval,
  distinctScreenshotDevices,
  matchesPairedScreenshotDraft,
  pairedScreenshotDraft,
  comparisonDraftBookmark,
  currentThreadPageGrant,
} from "./browserHostSupport";
import { openSavedAttachment } from "./browserWorkflowRun";
import type { BrowserHostManager } from "./browserHostManager";
import { MAX_DEVICE_SCREENSHOT_GRANTS } from "./browserHostSupport";

export function bookmarkForScreenshotDraft(
  this: BrowserHostManager,
  session: BrowserSession,
  contents: Electron.WebContents,
  url: string,
  draft: ScreenshotDraft,
) {
  if (!isPersistentPartition(session.partition) || !isBrowserAttachmentUrl(url)) return;
  const browserSession = contents.session;
  const storagePath = browserSession.storagePath;
  if (!storagePath || !browserSession.isPersistent()) return;
  return {
    ...this.attachmentBookmark(session, draft.taskId, url, storagePath),
    ...(draft.verifyScreenshotImages && {
      verifyScreenshotImages: true as const,
    }),
  };
}

export function saveVerifiedScreenshotDraft(
  this: BrowserHostManager,
  session: BrowserSession,
  contents: Electron.WebContents,
  url: string,
  draft: ScreenshotDraft,
  paired?: ScreenshotDraft,
) {
  try {
    const bookmark = this.bookmarkForScreenshotDraft(session, contents, url, draft);
    if (!bookmark) return true;
    const { grantId, pairedGrantId, pageRef, digest } = draft;
    this.attachmentBookmarks.saveScreenshotDraft({
      ...bookmark,
      grantId,
      ...(pairedGrantId ? { pairedGrantId } : {}),
      pageRef,
      digest,
    });
    if (paired?.verifiedUrl === url) {
      const comparison = comparisonDraftBookmark(bookmark, draft, paired);
      if (comparison) this.attachmentBookmarks.saveDeviceComparisonDraft(comparison);
    }
    return true;
  } catch {
    // A later snapshot can retry writing the bookmark after rechecking the live receipt.
    return false;
  }
}

export function stageComparisonDraft(
  this: BrowserHostManager,
  session: BrowserSession,
  attempt: DeviceScreenshotAttempt,
  phase: "before-dispatch" | "selected",
) {
  const { draft, contents } = attempt;
  if (
    this.sessions.get(session.key) !== session ||
    session.view.webContents !== contents ||
    contents.isDestroyed() ||
    session.instanceId !== attempt.instanceId ||
    session.partition !== draft.partition ||
    session.assignedTaskId !== draft.taskId ||
    !draft.exactDraftUrl
  )
    return;
  let paired = pairedScreenshotDraft(session, draft);
  if (phase === "before-dispatch" && !paired && draft.pairedGrantId) {
    // The first input may have run even if its selection reply never reached the host.
    const candidate = session.screenshotAttempts?.get(draft.pairedGrantId);
    if (
      candidate?.contents === contents &&
      candidate.instanceId === session.instanceId &&
      candidate.pageRevision === session.pageRevision &&
      candidate.grant.epoch === session.controlEpoch &&
      !candidate.navigationStarted &&
      matchesPairedScreenshotDraft(draft, candidate.draft)
    )
      paired = candidate.draft;
  }
  if (
    !paired ||
    !paired.exactDraftUrl ||
    (phase === "before-dispatch" &&
      (!draft.verifyScreenshotImages || !paired.verifyScreenshotImages))
  )
    return;
  try {
    const bookmark = this.bookmarkForScreenshotDraft(session, contents, draft.url, draft);
    if (!bookmark) return;
    const comparison = comparisonDraftBookmark(bookmark, draft, paired);
    if (comparison) return this.attachmentBookmarks.saveDeviceComparisonDraft(comparison, true);
  } catch {
    // Live verification remains available if the restart checkpoint cannot be written.
  }
}

export function revokeScreenshotAttempts(
  this: BrowserHostManager,
  session: BrowserSession,
  grantId?: string,
  inFlightOnly = false,
) {
  for (const [id, attempt] of session.screenshotAttempts ?? []) {
    if (inFlightOnly && !attempt.dispatching) continue;
    if (grantId !== undefined && id !== grantId && attempt.grant.pairedGrantId !== grantId)
      continue;
    if (!attempt.recorded) attempt.cancelCheckpoint?.();
    if (grantId === undefined || id === grantId || !attempt.recorded)
      session.screenshotAttempts?.delete(id);
  }
}

export async function enterSavedScreenshotDraft(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
): Promise<{ url: string } | null> {
  const { grantId, pairedGrantId, pageRef, profileId } = automationInput(request.input);
  const threadId = this.attachmentThread(session, request, profileId);
  if (pairedGrantId !== undefined) {
    const saved = this.attachmentBookmarks.readPairedScreenshotDraft(grantId, pairedGrantId);
    if (!saved) return null;
    if (saved.bookmark.pageRef !== pageRef)
      throw new Error("Open both screenshot receipts from the original attachment.");
    return this.openSavedAttachment(session, request, threadId, saved.bookmark, saved.digests);
  }
  const saved = this.attachmentBookmarks.readScreenshotDraft(grantId);
  if (!saved) return null;
  if (saved.pageRef !== pageRef || saved.pairedGrantId !== undefined)
    throw new Error("Open the screenshot draft from its original attachment.");
  return this.openSavedAttachment(session, request, threadId, saved, [saved.digest]);
}

export function readDeviceComparisonDraft(
  this: BrowserHostManager,
  request: BrowserAutomationRequest,
  threadId: string,
) {
  if (!Schema.is(DeviceComparisonResultRef)(request.input)) return;
  const bookmark = this.attachmentBookmarks.readDeviceComparisonDraft({
    projectId: request.projectId,
    threadId,
    runId: request.input.runId,
    step: request.input.step,
  });
  if (
    bookmark &&
    (!bookmark.pending || bookmark.managerId !== this.attachmentManagerId) &&
    isUserBrowserTab(bookmark.tabId) &&
    isPersistentPartition(bookmark.partition) &&
    isBrowserAttachmentUrl(bookmark.url)
  )
    return bookmark;
}

export function findDeviceComparisonDraft(
  this: BrowserHostManager,
  request: BrowserAutomationRequest,
) {
  if (request.source !== "human")
    throw new Error("Find the saved comparison draft from its thread.");
  if (
    request.sessionId !== undefined ||
    typeof request.taskId !== "string" ||
    !request.taskId.trim()
  )
    return null;
  const saved = this.readDeviceComparisonDraft(request, request.taskId);
  return saved
    ? {
        tabId: saved.tabId,
        profileId: saved.profileId,
        ...(saved.pending && { pending: true }),
      }
    : null;
}

export async function enterDeviceComparisonDraft(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
): Promise<{ url: string }> {
  const { profileId } = automationInput(request.input);
  const threadId = this.attachmentThread(session, request, profileId);
  const saved = this.readDeviceComparisonDraft(request, threadId);
  if (!saved)
    throw new Error("No verified comparison draft was saved for this step on this desktop.");
  const { pending, ...bookmark } = saved;
  const result = await this.openSavedAttachment(
    session,
    request,
    threadId,
    bookmark,
    bookmark.digests,
    pending ? { reload: true } : undefined,
  );
  if (pending) {
    try {
      this.attachmentBookmarks.saveDeviceComparisonDraft(bookmark);
    } catch {
      // This opening verified both live receipts. A later opening can retry saving them.
    }
  }
  return result;
}

export function isCurrentDeviceEvidencePage(
  this: BrowserHostManager,
  session: BrowserSession,
  contents: Electron.WebContents,
  request: BrowserAutomationRequest,
  { url, pageRef, profileId }: DeviceEvidencePage & { url: string },
): boolean {
  return (
    request.projectId === session.projectId &&
    request.sessionId === session.sessionId &&
    isUserBrowserTab(session.sessionId) &&
    !session.temporaryAgentTab &&
    this.sessions.get(session.key) === session &&
    session.view.webContents === contents &&
    !session.humanControlLocked &&
    !session.verificationLease &&
    !session.resting &&
    !session.loading &&
    !session.certificateError &&
    !contents.isDestroyed() &&
    !contents.isCrashed() &&
    !contents.isLoadingMainFrame() &&
    session.currentUrl === url &&
    contents.getURL() === url &&
    profileId === (session.profileId ?? "default") &&
    pageRef === this.pageReference(session, url) &&
    !!currentThreadPageGrant(session, request.taskId, url)
  );
}

export async function authorizeDeviceComparisonEvidence(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
) {
  const { taskId, input } = request;
  if (request.source !== "human" || typeof taskId !== "string" || !taskId.trim())
    throw new Error("Approve first-difference evidence from the destination tab.");
  if (!isDeviceEvidenceApproval(input))
    throw new Error("Select the exact destination and both comparison devices before approving.");
  const { url, profileId, pageRef, instanceId, runId, source, target } = input;
  this.checkPageApproval(session, input.pageApprovalToken);
  if (!distinctScreenshotDevices([source, target]))
    throw new Error("Choose two distinct comparison devices.");

  const contents = session.view.webContents;
  if (
    instanceId !== session.instanceId ||
    !this.isCurrentDeviceEvidencePage(session, contents, request, input)
  )
    throw new Error("Approve access to the exact destination tab, page and profile first.");
  this.checkSubmissionGuard(session);
  const { pageRevision, controlEpoch } = session;
  const receiptMode: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [
    {
      code: `location.href === ${JSON.stringify(url)} && (${PAGE_READY_FOR_AGENT})
        ? (${SCREENSHOT_RECEIPT_MODE}) : null`,
    },
  ]);
  if (
    receiptMode === null ||
    session.pageRevision !== pageRevision ||
    session.controlEpoch !== controlEpoch ||
    !this.isCurrentDeviceEvidencePage(session, contents, request, input)
  )
    throw new Error("The approved draft changed. Review its page and profile again.");
  this.checkPageApproval(session, input.pageApprovalToken);
  this.checkSubmissionGuard(session);
  const imageReceipts =
    receiptMode === SCREENSHOT_IMAGE_RECEIPTS ? { verifyScreenshotImages: true as const } : {};
  const retained = this.currentDeviceScreenshotGrants(session, taskId, url).filter(
    (grant) => !grant.firstDifference || grant.firstDifference.runId === runId,
  );
  if (retained.length + 2 > MAX_DEVICE_SCREENSHOT_GRANTS)
    throw new Error("Finish or revoke a pending screenshot transfer before adding another.");
  return {
    grantIds: this.storeDeviceScreenshotGrants(
      session,
      taskId,
      url,
      [
        {
          hostId: source.hostId,
          deviceId: source.deviceId,
          pageRef,
          profileId,
          ...imageReceipts,
          firstDifference: { runId, side: "source" },
        },
        {
          hostId: target.hostId,
          deviceId: target.deviceId,
          pageRef,
          profileId,
          ...imageReceipts,
          firstDifference: { runId, side: "target" },
        },
      ],
      retained,
    ),
  };
}

export function currentDeviceScreenshotGrants(
  this: BrowserHostManager,
  session: BrowserSession,
  taskId: string,
  url: string,
) {
  return Array.from(session.deviceUploads?.values() ?? []).filter(
    (grant) =>
      session.controller !== "human" &&
      session.assignedTaskId === taskId &&
      grant.taskId === taskId &&
      grant.epoch === session.controlEpoch &&
      grant.partition === session.partition &&
      grant.url === url,
  );
}

export function storeDeviceScreenshotGrants(
  this: BrowserHostManager,
  session: BrowserSession,
  taskId: string,
  url: string,
  screenshots:
    | readonly [DeviceScreenshotSource]
    | readonly [DeviceScreenshotSource, DeviceScreenshotSource],
  retained?: readonly DeviceScreenshotGrant[],
) {
  const ids = screenshots.map(() => randomUUID());
  const [firstId, secondId] = ids;
  const grants = (session.deviceUploads ??= new Map());
  if (retained) {
    // A manual pair can also grant page control, which advances the epoch.
    grants.clear();
    for (const grant of retained) grants.set(grant.id, { ...grant, epoch: session.controlEpoch });
  }
  for (const [index, screenshot] of screenshots.entries()) {
    const id = ids[index]!;
    const pairedGrantId = index === 0 ? secondId : firstId;
    grants.set(id, {
      ...screenshot,
      id,
      ...(pairedGrantId ? { pairedGrantId } : {}),
      taskId,
      url,
      partition: session.partition,
      epoch: session.controlEpoch,
    });
  }
  this.emitState(session);
  return ids;
}
