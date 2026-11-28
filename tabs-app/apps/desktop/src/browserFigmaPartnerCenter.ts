import { isUserBrowserTab } from "@tabs/shared/preview";
import { figmaDesignSelection } from "@tabs/shared/figmaUrl";
import { pageOrigin, PAGE_READY_FOR_AGENT } from "./browserPageGrant";
import { checkAttachmentPage } from "./browserScreenshotReceipts";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import * as Schema from "effect/Schema";
import {
  type FigmaCanvasApproval,
  type FigmaCanvasAuthorization,
  FigmaCanvasBrowserRequest,
  FigmaCanvasReceipt,
  type FigmaCanvasTarget,
  type FigmaCanvasWrite,
  type PartnerCenterStatusApproval,
  type PartnerCenterStatusAuthorization,
  PartnerCenterStatusRequest,
  PreviewTabId,
  StoreSubmissionId,
} from "@tabs/contracts";
import {
  BrowserSession,
  BrowserAutomationRequest,
  FigmaCanvasReview,
  FIGMA_ATTACHMENT_REQUIRED,
  FIGMA_PAGE_CHANGED,
  FIGMA_REVIEW_REQUIRED,
  isBrowserAttachmentUrl,
  automationInput,
  matchesVisibleStoreSubmission,
} from "./browserHostSupport";
import type { BrowserHostManager } from "./browserHostManager";

export function livePartnerCenterStatus(this: BrowserHostManager, session: BrowserSession) {
  const consent = session.partnerCenterStatus;
  if (consent && this.matchesBrowserConsentPage(session, consent.page)) return consent;
}

export function liveFigmaCanvasReview(this: BrowserHostManager, session: BrowserSession) {
  const review = session.figmaCanvasReview;
  if (
    review &&
    session.controller === "none" &&
    !session.humanControlLocked &&
    !session.verificationLease &&
    !session.pendingPermission &&
    !session.lastError &&
    !session.transientError &&
    session.currentUrl === review.page.url &&
    this.matchesBrowserConsentPage(session, review.page)
  )
    return review;
}

export async function runPartnerCenterStatus(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
): Promise<
  PartnerCenterStatusAuthorization | { approved: true; approval: PartnerCenterStatusApproval }
> {
  const human = request.operation === "authorizePartnerCenterStatus";
  const review =
    "Review the current Microsoft Store status request in its original tab and thread.";
  if (
    request.source !== (human ? "human" : "agent") ||
    !isUserBrowserTab(session.sessionId) ||
    !request.taskId
  )
    throw new Error(review);

  const pending = this.livePartnerCenterStatus(session);
  if (
    human &&
    (!pending ||
      pending.approved ||
      pending.page.grant.taskId !== request.taskId ||
      pending.approval.id !== automationInput(request.input).approvalId)
  )
    throw new Error(review);

  const { verifyApprovalId, ...statusRequest } =
    human && pending
      ? pending.request
      : Schema.decodeUnknownSync(PartnerCenterStatusRequest)(request.input);
  const lookup = session.partnerCenterLookup;
  const previous = verifyApprovalId === undefined ? pending : lookup?.consent;
  const wasApproved = previous?.approved;
  const currentLookup = () =>
    lookup &&
    session.partnerCenterLookup === lookup &&
    lookup.expiresAt > Date.now() &&
    lookup.consent.approval.id === verifyApprovalId &&
    this.matchesBrowserConsentPage(session, lookup.consent.page);
  if (verifyApprovalId !== undefined && !currentLookup()) throw new Error(review);
  const { definition, target, workflowId, applicationId, tenantId, clientId } = statusRequest;
  const { url, identitySelector, resourceId: submissionId } = definition;
  if (
    pageOrigin(url) !== "https://partner.microsoft.com" ||
    new URL(url).href !== url ||
    !Schema.is(StoreSubmissionId)(submissionId)
  )
    throw new Error(
      "Status access requires an exact HTTPS Partner Center URL and a Store submission ID.",
    );

  const wrongTarget =
    "Open the Microsoft Store submission in its original desktop browser tab and profile.";
  const { contents, browserSession, storagePath } = this.requireSavedBrowserTarget(
    session,
    request,
    target,
    wrongTarget,
  );
  const grant = session.pageGrant;
  const scopeChanged =
    "Approve access to the original Microsoft Store page and profile in Browser tools.";
  if (!grant || grant.taskId !== request.taskId) throw new Error(scopeChanged);
  const page = {
    contents,
    browserSession,
    storagePath,
    profileId: target.profileId,
    instanceId: session.instanceId,
    revision: session.pageRevision,
    grant,
    epoch: session.controlEpoch,
    url,
  };
  if (!this.matchesBrowserConsentPage(session, page)) throw new Error(scopeChanged);
  if (previous && !isDeepStrictEqual(previous.request, statusRequest))
    throw new Error("The current Store status consent belongs to a different request.");

  const code = `(${PAGE_READY_FOR_AGENT}) && (${matchesVisibleStoreSubmission.toString()})(${JSON.stringify(url)}, ${JSON.stringify(identitySelector)}, ${JSON.stringify(submissionId)})`;
  const matches: unknown = await contents
    .executeJavaScriptInIsolatedWorld(999, [{ code }])
    .catch(() => false);
  if (
    !this.matchesBrowserConsentPage(session, page) ||
    (verifyApprovalId === undefined
      ? this.livePartnerCenterStatus(session) !== previous
      : !currentLookup()) ||
    previous?.approved !== wasApproved
  )
    throw new Error(review);
  this.requireSavedBrowserTarget(session, request, target, wrongTarget);

  if (matches !== true) {
    if (verifyApprovalId === undefined) session.partnerCenterStatus = undefined;
    else session.partnerCenterLookup = undefined;
    this.emitState(session);
    throw new Error("The visible Store submission ID did not uniquely match the saved draft.");
  }

  if (previous) {
    const { approval } = previous;
    if (human) {
      previous.approved = true;
      this.emitState(session);
      return { approved: true, approval };
    }
    if (wasApproved) {
      if (verifyApprovalId !== undefined) return { status: "approved", approval };
      session.partnerCenterStatus = undefined;
      session.partnerCenterLookup = {
        consent: previous,
        expiresAt: Date.now() + 30_000,
      };
      this.emitState(session);
      return { status: "approved", approval };
    }
    return { status: "approval_required", approval };
  }

  const approval = {
    id: randomUUID(),
    workflowId,
    applicationId,
    submissionId,
    tenantId,
    clientId,
  };
  session.partnerCenterStatus = {
    request: statusRequest,
    approval,
    page,
    approved: false,
  };
  this.emitState(session);
  return { status: "approval_required", approval };
}

export function requireCurrentFigmaCanvasReview(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
  review: FigmaCanvasReview,
) {
  if (
    this.liveFigmaCanvasReview(session) !== review ||
    !isDeepStrictEqual(this.attachmentBookmarks.read(review.target.attachmentId), review.attachment)
  )
    this.rejectFigmaCanvasReview(session, review);
  try {
    this.requireSavedBrowserTarget(session, request, review.target, FIGMA_ATTACHMENT_REQUIRED);
  } catch {
    this.rejectFigmaCanvasReview(session, review);
  }
}

export function rejectFigmaCanvasReview(
  this: BrowserHostManager,
  session: BrowserSession,
  review: FigmaCanvasReview,
): never {
  if (session.figmaCanvasReview === review) {
    session.figmaCanvasReview = undefined;
    if (review.consent) this.emitState(session);
  }
  throw new Error(FIGMA_PAGE_CHANGED);
}

export async function inspectFigmaCanvas(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
  { attachmentId, profileId }: Extract<FigmaCanvasBrowserRequest, { action: "inspect" }>,
): Promise<FigmaCanvasTarget> {
  const attachment = this.attachmentBookmarks.read(attachmentId);
  if (
    !attachment ||
    attachment.threadId !== request.taskId ||
    attachment.profileId !== profileId ||
    attachment.partition !== session.partition ||
    (attachment.managerId === this.attachmentManagerId &&
      attachment.instanceId !== session.instanceId)
  )
    throw new Error(FIGMA_ATTACHMENT_REQUIRED);
  const { contents, browserSession, storagePath } = this.requireSavedBrowserTarget(
    session,
    request,
    attachment,
    FIGMA_ATTACHMENT_REQUIRED,
  );
  const grant = session.pageGrant;
  if (!grant || grant.taskId !== request.taskId)
    throw new Error("Approve browser access to the attached Figma page first.");

  const url = contents.getURL();
  const attached = URL.canParse(attachment.url) && figmaDesignSelection(new URL(attachment.url));
  const selection = URL.canParse(url) && figmaDesignSelection(new URL(url));
  if (!attached || !selection || !isDeepStrictEqual(selection, attached))
    throw new Error("Select the same Figma Design file, branch and node as the attachment.");
  const target = {
    projectId: session.projectId,
    tabId: PreviewTabId.make(session.sessionId),
    profileId,
    hostKey: attachment.hostKey,
    attachmentId,
    ...selection,
  };
  const previous = this.liveFigmaCanvasReview(session);
  const sameAttachment =
    previous &&
    isDeepStrictEqual(previous.target, target) &&
    isDeepStrictEqual(previous.attachment, attachment);
  if (previous?.consent && !sameAttachment)
    throw new Error("The current Figma consent belongs to a different attachment.");
  const review: FigmaCanvasReview = sameAttachment
    ? previous
    : {
        target,
        attachment,
        page: {
          contents,
          browserSession,
          storagePath,
          profileId,
          instanceId: session.instanceId,
          revision: session.pageRevision,
          grant,
          epoch: session.controlEpoch,
          url,
        },
        inspected: false,
      };
  session.figmaCanvasReview = review;
  await this.verifyFigmaCanvasPage(session, request, review);
  this.requireCurrentFigmaCanvasReview(session, request, review);
  review.inspected = true;
  return target;
}

export async function verifyFigmaCanvasPage(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
  review: FigmaCanvasReview,
) {
  this.requireCurrentFigmaCanvasReview(session, request, review);
  if ((await checkAttachmentPage(review.page.contents, review.page.url)) !== "ready")
    this.rejectFigmaCanvasReview(session, review);
}

export async function runFigmaCanvas(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
): Promise<
  | FigmaCanvasTarget
  | FigmaCanvasAuthorization
  | { approved: true; approval: FigmaCanvasApproval }
  | true
> {
  const human = request.operation === "authorizeFigmaCanvas";
  if (
    request.source !== (human ? "human" : "agent") ||
    !request.taskId ||
    request.sessionId !== session.sessionId ||
    !isUserBrowserTab(session.sessionId) ||
    session.temporaryAgentTab
  )
    throw new Error(FIGMA_REVIEW_REQUIRED);

  const input = human
    ? undefined
    : Schema.decodeUnknownSync(FigmaCanvasBrowserRequest)(request.input);
  if (input?.action === "inspect") return this.inspectFigmaCanvas(session, request, input);

  const review = this.liveFigmaCanvasReview(session);
  if (!review?.inspected || review.attachment.threadId !== request.taskId)
    throw new Error(FIGMA_REVIEW_REQUIRED);
  if (input?.action === "dispatch") {
    const approval = review.dispatchApproval;
    if (!approval || !isDeepStrictEqual(input.approval, approval))
      throw new Error(FIGMA_REVIEW_REQUIRED);
    await this.verifyFigmaCanvasPage(session, request, review);
    this.requireCurrentFigmaCanvasReview(session, request, review);
    if (review.dispatchApproval !== approval) throw new Error(FIGMA_REVIEW_REQUIRED);
    delete review.dispatchApproval;
    return true;
  }
  const consent = review.consent;
  const wasApproved = consent?.approved;
  if (
    human &&
    (!consent || wasApproved || consent.approval.id !== automationInput(request.input).approvalId)
  )
    throw new Error(FIGMA_REVIEW_REQUIRED);
  let write: FigmaCanvasWrite | undefined;
  if (input) {
    const { target, operationId, email, frame } = input;
    if (!isDeepStrictEqual(target, review.target)) throw new Error(FIGMA_PAGE_CHANGED);
    write = { target: review.target, operationId, email, frame };
    if (consent) {
      const { target, operationId, email, frame } = consent.approval;
      if (!isDeepStrictEqual(write, { target, operationId, email, frame }))
        throw new Error("The current Figma consent belongs to a different frame request.");
    }
  }

  await this.verifyFigmaCanvasPage(session, request, review);
  this.requireCurrentFigmaCanvasReview(session, request, review);
  if (review.consent !== consent || consent?.approved !== wasApproved)
    throw new Error(FIGMA_REVIEW_REQUIRED);

  if (consent) {
    const { approval } = consent;
    if (human) {
      consent.approved = true;
      this.emitState(session);
      return { approved: true, approval };
    }
    if (wasApproved) {
      delete review.consent;
      review.dispatchApproval = approval;
      this.emitState(session);
      return { status: "approved", approval };
    }
    return { status: "approval_required", approval };
  }

  if (!write) throw new Error(FIGMA_REVIEW_REQUIRED);
  const approval = { id: randomUUID(), ...write };
  review.consent = { approval, approved: false };
  this.emitState(session);
  return { status: "approval_required", approval };
}

export function enterFigmaCanvasResult(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
) {
  const { target, frameNodeId, textNodeId } = Schema.decodeUnknownSync(FigmaCanvasReceipt)(
    request.input,
  );
  const threadId = this.attachmentThread(session, request, target.profileId);
  const attachment = this.attachmentBookmarks.read(target.attachmentId);
  if (
    !attachment ||
    !URL.canParse(attachment.url) ||
    attachment.projectId !== target.projectId ||
    attachment.tabId !== target.tabId ||
    attachment.profileId !== target.profileId ||
    attachment.hostKey !== target.hostKey ||
    frameNodeId === target.nodeId ||
    textNodeId === target.nodeId ||
    textNodeId === frameNodeId
  )
    throw new Error(FIGMA_ATTACHMENT_REQUIRED);
  const url = new URL(attachment.url);
  const selected = figmaDesignSelection(url);
  if (
    !selected ||
    selected.mainFileKey !== target.mainFileKey ||
    selected.fileKey !== target.fileKey ||
    selected.nodeId !== target.nodeId
  )
    throw new Error(FIGMA_ATTACHMENT_REQUIRED);
  url.searchParams.set("node-id", frameNodeId.replace(":", "-"));
  const otherQueryParameters = (address: URL) => {
    const parameters = new URLSearchParams(address.search);
    parameters.delete("node-id");
    parameters.sort();
    return parameters.toString();
  };
  const expectedQuery = otherQueryParameters(url);
  return this.openSavedAttachment(
    session,
    request,
    threadId,
    { ...attachment, url: url.href },
    undefined,
    {
      matchesDestination: (candidate) => {
        if (!isBrowserAttachmentUrl(candidate)) return false;
        const destination = new URL(candidate);
        const selection = figmaDesignSelection(destination);
        return (
          selection !== null &&
          destination.origin === url.origin &&
          destination.hash === url.hash &&
          otherQueryParameters(destination) === expectedQuery &&
          selection.mainFileKey === target.mainFileKey &&
          selection.fileKey === target.fileKey &&
          selection.nodeId === frameNodeId
        );
      },
    },
  );
}
