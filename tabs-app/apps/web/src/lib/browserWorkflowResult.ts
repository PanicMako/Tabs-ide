import {
  BrowserWorkflowBrowserRequest,
  BrowserWorkflowHostResult,
  BrowserWorkflowSavedResult,
  BrowserWorkflowStage,
  ProjectId,
  type BrowserWorkflowResultRef,
  type BrowserWorkflowTarget,
  type DesktopBrowserSessionState,
  type EnvironmentId,
  type PreviewAutomationRequest,
  type ThreadId,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";

import { toastManager } from "~/components/ui/toast";
import { environmentApi, isPrimaryEnvironment } from "~/connection/environmentApiRegistry";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import { findBrowserLocation } from "./savedBrowserResult";

const decodeRequest = Schema.decodeUnknownSync(BrowserWorkflowBrowserRequest);
const decodeResult = Schema.decodeUnknownSync(BrowserWorkflowHostResult);
const decodeSavedResult = Schema.decodeUnknownSync(BrowserWorkflowSavedResult);
const isReopenedResult = Schema.is(Schema.Struct({ stage: BrowserWorkflowStage }));
const manualSubmissionTitle = "Submit in the original draft";
const unavailable = () =>
  new Error("The original browser tab or profile is unavailable in this thread.");

type BrowserLocation = NonNullable<ReturnType<typeof findBrowserLocation>>;

function sameLocation(original: BrowserLocation, current: BrowserLocation | undefined) {
  return (
    current?.id === original.id &&
    current.kind === original.kind &&
    (current.kind === "companion" ||
      (original.kind === "project-tool" && current.partition === original.partition))
  );
}

function matchesBrowserSession(
  state: DesktopBrowserSessionState,
  target: BrowserWorkflowTarget,
  threadId: ThreadId,
) {
  return (
    state.projectId === target.projectId &&
    state.sessionId === target.tabId &&
    (!state.assignedTaskId || state.assignedTaskId === threadId)
  );
}

function waitForActiveProject(projectId: ProjectId): Promise<boolean> {
  const { session } = useWorkspaceShellStore.getState();
  if (session.activeProjectId === projectId) return Promise.resolve(true);
  if (!session.openProjectIds.includes(projectId)) return Promise.resolve(false);

  // The router can finish loading before WorkspaceShell applies the thread's project.
  return new Promise((resolve) => {
    const unsubscribe = useWorkspaceShellStore.subscribe(({ session: current }) => {
      if (current.activeProjectId === projectId) finish(true);
      else if (
        current.activeProjectId !== session.activeProjectId ||
        current.activePendingTabId !== session.activePendingTabId ||
        !current.openProjectIds.includes(projectId)
      )
        finish(false);
    });
    const timeout = setTimeout(() => finish(false), 2_000);
    function finish(active: boolean) {
      clearTimeout(timeout);
      unsubscribe();
      resolve(active);
    }
  });
}

function activateWorkflowBrowser(
  location: BrowserLocation,
  scope: string,
  projectId: ProjectId,
  tabId: string,
  url: string,
) {
  if (location.kind === "companion") {
    const surfaces = useCompanionSurfaceStore.getState();
    surfaces.update(scope, location.id, { url });
    surfaces.activate(scope, location.id);
    useRightPanelStore.getState().openPanel("browser");
  } else {
    const workspace = useWorkspaceShellStore.getState();
    if (tabId === "browser") workspace.setBrowserCurrentUrl(projectId, url, tabId);
    else workspace.setBrowserSessionUrl(projectId, tabId, url);
    workspace.setActiveTool(projectId, location.id);
  }
}

export function readBrowserWorkflowReceipt(
  bridge: NonNullable<Window["desktopBridge"]>,
  environmentId: EnvironmentId,
  projectId: ProjectId,
  request: Pick<PreviewAutomationRequest, "threadId" | "tabId" | "tabIdExplicit" | "input">,
) {
  const saved = decodeSavedResult(request.input);
  const { tabId, profileId } = saved.target;
  const { threadId } = request;
  if (
    !request.tabIdExplicit ||
    request.tabId !== tabId ||
    saved.target.projectId !== projectId ||
    !findBrowserLocation(`${environmentId}:${threadId}`, projectId, tabId, profileId)
  )
    throw unavailable();
  return bridge.runBrowserAutomation({
    source: "human",
    taskId: threadId,
    projectId,
    sessionId: tabId,
    operation: "readWorkflowReceipt",
    input: saved,
  });
}

export async function openSavedBrowserWorkflowResult(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  projectId: string,
  reference: BrowserWorkflowResultRef,
  isCurrent: () => boolean,
): Promise<BrowserWorkflowResultRef | undefined> {
  const bridge = window.desktopBridge;
  if (!bridge || !isPrimaryEnvironment(environmentId))
    throw new Error("Open this result in the Tabs desktop app on its original machine.");
  const api = await environmentApi(environmentId);
  if (!isCurrent()) return;
  const input = {
    threadId,
    workflowId: reference.workflowId,
    stage: reference.stage,
  };
  const result = await api.preview.getWorkflowResult(input);
  if (!isCurrent()) return;
  const pendingUpload = result.pendingAction === "upload";
  const checkUpload = pendingUpload || reference.pendingAction === "upload";
  const reconcile =
    pendingUpload ||
    (!checkUpload && (result.pendingAction === "submit" || result.submitRequiresUser === true));
  // A stale upload link can open the verified draft independently of a later Submit.
  const saved =
    checkUpload && !pendingUpload
      ? { target: result.target, definition: result.definition, stage: result.stage }
      : result;
  const reopened = await revealSavedBrowserWorkflowResult(
    bridge,
    environmentId,
    threadId,
    projectId,
    saved,
    isCurrent,
    reconcile
      ? () => api.preview.getWorkflowResult({ ...input, reconcileSubmission: true })
      : undefined,
  );
  const referencedPendingSubmission = reference.pendingAction === "submit";
  if (!reopened || !isCurrent()) return;
  const {
    stage: savedStage,
    pendingAction,
    submitRequiresUser,
    definition,
    target,
  } = reopened.reconciled ?? result;
  const verified = {
    workflowId: reference.workflowId,
    stage: savedStage,
    ...(pendingAction && { pendingAction }),
    ...(submitRequiresUser && { submitRequiresUser }),
  };
  if (!(checkUpload || reconcile || referencedPendingSubmission || reference.submitRequiresUser))
    return verified;
  const stage = checkUpload ? savedStage : reopened.stage;
  if (checkUpload && stage === "ready_to_upload") {
    toastManager.add({
      type: "warning",
      title: "Upload outcome still unverified",
      description: definition.uploadInputSelector
        ? "The original draft still shows Ready to upload. If the transfer has ended, reload the draft and check again."
        : "The original draft still shows Ready to upload.",
    });
  } else if (!checkUpload && stage === "uploaded" && submitRequiresUser) {
    toastManager.add({
      type: "info",
      title: manualSubmissionTitle,
      description:
        "The original draft still shows Uploaded. If a previous Submit lost its reply, check the site before trying again.",
    });
  } else if (
    !checkUpload &&
    stage === "uploaded" &&
    (pendingAction === "submit" || referencedPendingSubmission)
  ) {
    toastManager.add({
      type: "warning",
      title: "Submission outcome still unverified",
      description: "The original draft still shows Uploaded.",
    });
  } else {
    toastManager.add({
      type: "info",
      title: `The page shows ${stage}`,
      description: `${definition.resourceId} · ${target.profileId}`,
    });
  }
  return verified;
}

export async function revealSavedBrowserWorkflowResult(
  bridge: NonNullable<Window["desktopBridge"]>,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  projectId: string,
  result: BrowserWorkflowSavedResult,
  isCurrent: () => boolean,
  readReceipt?: () => Promise<BrowserWorkflowSavedResult>,
) {
  const { tabId, profileId } = result.target;
  const scope = `${environmentId}:${threadId}`;
  if (!isCurrent()) return;
  if (result.target.projectId !== projectId) throw unavailable();
  const workspaceProjectId = ProjectId.makeUnsafe(projectId);
  const locate = () => findBrowserLocation(scope, workspaceProjectId, tabId, profileId);
  const original = locate();
  if (!original) throw unavailable();
  const target = { projectId, sessionId: tabId };
  let state = await bridge.getBrowserSessionState(target);
  if (!isCurrent()) return;
  if (!sameLocation(original, locate()) || !matchesBrowserSession(state, result.target, threadId))
    throw unavailable();
  if (!state.instanceId && !state.currentUrl) {
    // Restore a blank guest in the original partition before native verification.
    await bridge.ensureBrowserSession({
      ...target,
      ...(original.kind === "companion" ? { profileId } : { partition: original.partition }),
      initialUrl: "",
    });
    if (!isCurrent()) return;
    state = await bridge.getBrowserSessionState(target);
  }
  if (!isCurrent()) return;
  if (
    !sameLocation(original, locate()) ||
    !matchesBrowserSession(state, result.target, threadId) ||
    !state.instanceId ||
    (state.profileId ?? "default") !== profileId
  )
    throw unavailable();
  const reconciled = readReceipt ? await readReceipt() : undefined;
  const reopened = readReceipt
    ? reconciled
    : await bridge.runBrowserAutomation({
        ...target,
        source: "human",
        taskId: threadId,
        operation: "enterBrowserWorkflowResult",
        input: result,
      });
  if (!isCurrent()) return;
  if (
    !isReopenedResult(reopened) ||
    BrowserWorkflowStage.literals.indexOf(reopened.stage) <
      BrowserWorkflowStage.literals.indexOf(result.stage) ||
    (reconciled &&
      (reconciled.target.projectId !== projectId ||
        reconciled.target.tabId !== tabId ||
        reconciled.target.profileId !== profileId ||
        reconciled.target.hostKey !== result.target.hostKey ||
        reconciled.definition.url !== result.definition.url ||
        reconciled.definition.resourceId !== result.definition.resourceId))
  )
    throw new Error("The browser did not confirm the saved receipt.");
  const verified = await bridge.getBrowserSessionState(target);
  if (!isCurrent()) return;
  if (
    !sameLocation(original, locate()) ||
    !matchesBrowserSession(verified, result.target, threadId) ||
    verified.instanceId !== state.instanceId ||
    verified.loading ||
    (verified.profileId ?? "default") !== profileId ||
    verified.currentUrl !== result.definition.url
  )
    throw unavailable();
  activateWorkflowBrowser(original, scope, workspaceProjectId, tabId, result.definition.url);
  return { stage: reopened.stage, reconciled };
}

function isResolvedDraftUrl(publicUrl: string, draftUrl: string) {
  const parsed = URL.parse(draftUrl);
  return (
    parsed !== null &&
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    !parsed.username &&
    !parsed.password &&
    parsed.href === draftUrl &&
    draftUrl !== publicUrl &&
    `${parsed.origin}${parsed.pathname}` === publicUrl
  );
}

export function createBrowserWorkflowResultPresenter(
  bridge: NonNullable<Window["desktopBridge"]>,
  navigateToThread: (environmentId: EnvironmentId, threadId: ThreadId) => Promise<unknown>,
) {
  const verifiedStages = new Map<string, BrowserWorkflowStage>();
  const notices = new Map<string, string>();

  return (environmentId: EnvironmentId, threadId: ThreadId, input: unknown, response: unknown) => {
    const {
      phase,
      definition,
      statusOnly,
      target: savedTarget,
      workflowId,
      lastVerifiedStage,
    } = decodeRequest(input);
    const { disposition, observation, resolvedDraftUrl, target, submissionApproved } =
      decodeResult(response);
    // A dispatched action carries the observation from before it was sent.
    if (disposition === "dispatched") return;
    if (
      resolvedDraftUrl !== undefined &&
      (phase !== "inspect" ||
        savedTarget ||
        workflowId ||
        statusOnly ||
        disposition !== "observed" ||
        !observation ||
        !isResolvedDraftUrl(definition.url, resolvedDraftUrl))
    )
      return;
    const { breakpoint, readOnly } = definition;
    if (
      readOnly &&
      (disposition !== "observed" ||
        !observation ||
        definition.states[observation.stage] !== observation.statusText)
    )
      return;

    const draftUrl = resolvedDraftUrl ?? definition.url;
    const { projectId, tabId, profileId } = target;
    const scope = `${environmentId}:${threadId}`;

    async function reveal() {
      const workspaceProjectId = ProjectId.makeUnsafe(projectId);
      const locate = (allowInactiveProject = false) =>
        findBrowserLocation(scope, workspaceProjectId, tabId, profileId, { allowInactiveProject });
      const getState = () => bridge.getBrowserSessionState({ projectId, sessionId: tabId });
      const matchesDraft = (state: DesktopBrowserSessionState) =>
        matchesBrowserSession(state, target, threadId) &&
        state.assignedTaskId === threadId &&
        !!state.instanceId &&
        !state.loading &&
        (state.profileId ?? "default") === profileId &&
        state.currentUrl === draftUrl;
      const warn = () =>
        toastManager.add({
          type: "warning",
          title: "The workflow page has moved",
          description: "Return to the draft in its original tab and browser profile.",
        });
      const original = locate(true);
      if (!original) return warn();
      const state = await getState();
      if (!sameLocation(original, locate(true)) || !matchesDraft(state)) return warn();
      const returningToProject =
        original.kind === "project-tool" &&
        useWorkspaceShellStore.getState().session.activeProjectId !== workspaceProjectId;
      await navigateToThread(environmentId, threadId);
      if (returningToProject && !(await waitForActiveProject(workspaceProjectId))) return warn();
      const current = await getState();
      if (
        !sameLocation(original, locate()) ||
        !matchesDraft(current) ||
        current.instanceId !== state.instanceId
      )
        return warn();
      activateWorkflowBrowser(original, scope, workspaceProjectId, tabId, draftUrl);
    }
    const open = () => void reveal().catch(() => undefined);
    if (phase === "enter" && observation) open();

    const key = JSON.stringify([
      scope,
      projectId,
      tabId,
      profileId,
      target.hostKey,
      draftUrl,
      definition.resourceId,
    ]);
    if (!statusOnly && !readOnly && breakpoint) {
      const approvalNeeded = savedTarget && submissionApproved === false;
      const upload = observation?.stage === "ready_to_upload";
      const canAct = upload || observation?.stage === "uploaded";
      const available = upload ? observation.uploadAvailable : observation?.submitAvailable;
      const manualSubmit = observation?.stage === "uploaded" && observation.submitRequiresUser;
      const action = upload ? "Upload" : "Submit";
      const notice = !observation
        ? "draft"
        : observation.breakpoint === "matched"
          ? "matched"
          : canAct && observation.breakpoint === "unobservable"
            ? "condition"
            : manualSubmit && observation.breakpoint === "clear"
              ? "manual_submit"
              : canAct && !available
                ? "submit"
                : approvalNeeded && canAct && observation.breakpoint === "clear"
                  ? "approval"
                  : undefined;
      if (notice) {
        const noticeKey = `${action}:${notice}`;
        if (notices.get(key) !== noticeKey) {
          notices.set(key, noticeKey);
          const description = {
            matched: breakpoint.pauseText,
            draft: "Tabs could not verify this draft and its status.",
            condition: `The condition needs one visible match with a known value. ${action} is blocked.`,
            manual_submit:
              "The site did not provide a submission key. Use the site's Submit button.",
            submit: upload
              ? definition.uploadInputSelector
                ? "Upload needs one visible, empty and unobstructed file input."
                : "Upload needs a staged file and one visible, enabled and unobstructed button."
              : "Submit needs one visible, enabled and unobstructed button.",
            approval:
              upload && definition.uploadInputSelector
                ? "Open the draft in its original profile and choose a file for guarded upload."
                : `Review the draft in its original profile and choose Approve one ${upload ? "upload" : "submission"}.`,
          }[notice];
          toastManager.add({
            type: notice === "approval" || notice === "manual_submit" ? "info" : "warning",
            title:
              notice === "matched"
                ? "Browser workflow paused"
                : notice === "approval"
                  ? upload
                    ? "Upload needs your approval"
                    : "Submission needs your approval"
                  : notice === "manual_submit"
                    ? manualSubmissionTitle
                    : "Browser breakpoint unavailable",
            description,
            actionProps: { children: observation ? "Open draft" : "Open tab", onClick: open },
          });
        }
        return;
      }
      notices.delete(key);
    }
    const stage = observation?.stage;
    const previous = verifiedStages.get(key);
    const stages = BrowserWorkflowStage.literals;
    if (
      savedTarget &&
      stage &&
      (readOnly ||
        (stage !== "ready_to_upload" &&
          (stage !== "uploaded" ||
            !!(definition.uploadSelector || definition.uploadInputSelector)))) &&
      (phase !== "monitor" ||
        (lastVerifiedStage && stages.indexOf(stage) > stages.indexOf(lastVerifiedStage))) &&
      (previous === undefined || stages.indexOf(previous) < stages.indexOf(stage))
    ) {
      verifiedStages.set(key, stage);
      toastManager.add({
        type: "info",
        title: `The page shows ${stage}`,
        description: `${definition.resourceId} · ${profileId}`,
        actionProps: { children: "Open draft", onClick: open },
      });
    }
  };
}
