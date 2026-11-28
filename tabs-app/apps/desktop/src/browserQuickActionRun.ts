import { isUserBrowserTab } from "@tabs/shared/preview";
import { getBrowserPageScope, matchesPageScope } from "./browserPageGrant";
import {
  BrowserQuickActionState,
  matchingQuickActionPause,
  quickActionPageLabel,
  replayBrowserQuickAction,
  revealBrowserQuickActionFile,
  validatedBrowserQuickAction,
} from "./browserQuickAction";
import { browserQuickActionPicker } from "./browserQuickActionDom";
import {
  browserQuickActionFilenameParameters,
  browserQuickActionPage,
  browserQuickActionParameters,
  isBrowserQuickActionSemantic,
  isBrowserQuickActionSelector,
  prepareBrowserQuickActionValues,
} from "@tabs/shared/browserQuickAction";
import type { BrowserQuickActionTarget } from "@tabs/contracts";
import { checkSubmissionGuard } from "./browserSubmissionGuard";
import { isLikelyAuthenticationUrl } from "./authClassifier";
import { isPersistentPartition } from "./profileStorage";
import { randomUUID } from "node:crypto";
import {
  BrowserSession,
  BrowserAutomationRequest,
  isBrowserAttachmentUrl,
  automationInput,
} from "./browserHostSupport";
import type { BrowserHostManager } from "./browserHostManager";

export function quickActionTargets(
  this: BrowserHostManager,
  projectId: string,
  rawAction: unknown,
): BrowserQuickActionTarget[] {
  const action = validatedBrowserQuickAction(rawAction);
  return [...this.sessions.values()].flatMap((session) => {
    const contents = session.view.webContents;
    if (session.projectId !== projectId || session.resting || contents.isDestroyed()) return [];
    const url = contents.getURL();
    if (browserQuickActionPage(url)?.origin !== action.origin || isLikelyAuthenticationUrl(url))
      return [];
    const state = (session.quickAction ??= new BrowserQuickActionState());
    const token = this.quickActionToken(session);
    const approval = state.approval;
    const pause = matchingQuickActionPause(state, action, this.quickActionPageToken(session));
    const lockedParameters = pause
      ? browserQuickActionParameters(action, pause.startAt).filter((parameter) =>
          pause.lockedValues?.has(parameter),
        )
      : [];
    return [
      {
        sessionId: session.sessionId,
        token,
        profileId: session.profileId ?? "default",
        page: quickActionPageLabel(url),
        visible: session.bounds !== null,
        assignedTaskId: session.assignedTaskId,
        ...(approval?.action.id === action.id && approval.token === token
          ? { approval: { id: approval.id, taskId: approval.taskId } }
          : {}),
        ...(pause ? { pausedAt: pause.startAt, repairAt: pause.repairAt } : {}),
        ...(lockedParameters.length > 0 && { lockedParameters }),
        ...(pause?.unconfirmedStep && {
          unconfirmedStepId: pause.unconfirmedStep.id,
        }),
        ...(pause?.agent && {
          pauseOwner: {
            pauseId: pause.agent.pauseId,
            taskId: pause.agent.taskId,
          },
        }),
        ...(state.running?.actionId === action.id ? { running: true } : {}),
      },
    ];
  });
}

export async function pickQuickActionControl(
  this: BrowserHostManager,
  session: BrowserSession,
  origin: string,
) {
  const deadline = Date.now() + 1_500;
  while (this.activeKey === null && session.bounds && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 40));
  if (
    this.activeKey !== session.key ||
    !session.bounds ||
    session.resting ||
    session.loading ||
    session.verificationLease ||
    session.view.webContents.isDestroyed() ||
    browserQuickActionPage(session.view.webContents.getURL())?.origin !== origin ||
    isLikelyAuthenticationUrl(session.view.webContents.getURL())
  )
    throw new Error("Bring the intended browser page into view before choosing a control.");
  const lease = Symbol("browser-quick-action-pick");
  session.verificationLease = lease;
  session.controlEpoch++;
  const contents = session.view.webContents;
  const pageToken = this.quickActionPageToken(session);
  try {
    const choice = (await contents.executeJavaScriptInIsolatedWorld(999, [
      { code: browserQuickActionPicker(origin) },
    ])) as { selector?: string; tag?: string; semantic?: unknown } | null;
    if (!choice) return null;
    if (
      this.sessions.get(session.key) !== session ||
      session.view.webContents !== contents ||
      contents.isDestroyed() ||
      this.quickActionPageToken(session) !== pageToken
    )
      throw new Error("The browser page changed while choosing a control.");
    const selector =
      choice.selector && isBrowserQuickActionSelector(choice.selector) ? choice.selector : "";
    const semantic = isBrowserQuickActionSemantic(choice.semantic) ? choice.semantic : undefined;
    if (!selector && !semantic)
      throw new Error("Choose an element with a stable selector or an accessible name.");
    return {
      selector,
      ...(choice.tag ? { tag: choice.tag } : {}),
      ...(semantic ? { semantic } : {}),
    };
  } finally {
    if (session.verificationLease === lease) session.verificationLease = undefined;
  }
}

export async function runQuickActionOperation(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
) {
  const input = automationInput(request.input);
  const state = (session.quickAction ??= new BrowserQuickActionState());
  const contents = session.view.webContents;
  const human = request.source === "human";
  const pageToken = this.quickActionPageToken(session);
  const targetToken = this.quickActionToken(session);
  if (!human && request.operation !== "runQuickAction")
    throw new Error("Choose the browser action in the Quick Actions launcher.");
  const pauseOwner = state.paused?.agent;
  if (
    input.pauseId !== undefined &&
    (!pauseOwner ||
      pauseOwner.pauseId !== input.pauseId ||
      pauseOwner.taskId !== request.taskId ||
      pauseOwner.url !== contents.getURL() ||
      pauseOwner.partition !== session.partition ||
      state.paused?.pageToken !== pageToken)
  )
    throw new Error("This Quick Action pause has changed. Open its latest review.");
  if (request.operation === "pickQuickActionOutcome") {
    return this.pickQuickActionControl(session, String(input.origin ?? ""));
  }
  if (request.operation === "revokeQuickAction") {
    if (state.approval?.action.id === input.actionId) {
      state.revoke();
      this.emitState(session);
    }
    if (state.running?.actionId === input.actionId) this.takeControl(request);
    return;
  }
  if (contents.isDestroyed()) throw new Error("The selected browser tab was closed.");
  if (request.operation === "enterQuickActionPause") {
    const pause = state.paused;
    const url = contents.getURL();
    if (
      !pause ||
      input.pauseId === undefined ||
      (session.assignedTaskId && session.assignedTaskId !== request.taskId) ||
      pause.action.id !== input.actionId ||
      session.resting ||
      session.loading ||
      browserQuickActionPage(url)?.origin !== pause.action.origin ||
      isLikelyAuthenticationUrl(url)
    )
      throw new Error("This Quick Action pause is no longer available in its original tab.");
    return { url };
  }
  const grant = human ? undefined : state.approval;
  if (
    !human &&
    (request.source !== "agent" ||
      !request.taskId ||
      !grant ||
      grant.taskId !== request.taskId ||
      grant.token !== targetToken ||
      grant.url !== contents.getURL() ||
      grant.partition !== session.partition ||
      grant.id !== input.approvalId ||
      grant.action.id !== input.actionId)
  )
    throw new Error("Ask the user to approve this action on the exact tab and thread.");
  let action = grant?.action ?? validatedBrowserQuickAction(input.action);
  const isInScope = (url: string) =>
    browserQuickActionPage(url)?.origin === action.origin && !isLikelyAuthenticationUrl(url);
  if (
    session.resting ||
    session.loading ||
    contents.isDestroyed() ||
    !isInScope(contents.getURL()) ||
    (human && targetToken !== input.token)
  )
    throw new Error("Recheck the selected browser tab and profile before continuing.");
  if (session.verificationLease || state.running || session.journeyRecorder?.status().recording)
    throw new Error("This browser tab is already in use.");
  const pause = matchingQuickActionPause(state, action, pageToken);
  if (input.pauseId !== undefined && !pause)
    throw new Error("This Quick Action pause has changed. Open its latest review.");
  if (request.operation === "resolveQuickActionStep") {
    if (
      !pause?.unconfirmedStep ||
      input.unconfirmedStepId !== pause.unconfirmedStep.id ||
      pause.unconfirmedStep.url !== contents.getURL() ||
      pause.unconfirmedStep.partition !== session.partition ||
      typeof input.applied !== "boolean" ||
      (pause.agent &&
        (input.pauseId !== pause.agent.pauseId ||
          (session.assignedTaskId && session.assignedTaskId !== request.taskId)))
    )
      throw new Error("This unconfirmed Quick Action step changed. Open its original review.");
    const { unconfirmedStep: _, ...resolved } = pause;
    const startAt = pause.startAt + (input.applied ? 1 : 0);
    state.paused = { ...resolved, startAt, repairAt: startAt };
    state.revoke();
    this.emitState(session);
    return;
  }
  if (state.paused?.pageToken === pageToken && state.paused.unconfirmedStep)
    throw new Error("Confirm whether the last Quick Action step took effect before continuing.");
  if (pause) action = pause.action;
  const scopedContents = (checkControl: (url?: string) => void) => ({
    executeJavaScriptInIsolatedWorld: (
      world: number,
      scripts: Electron.WebSource[],
      userGesture?: boolean,
    ) => {
      const url = contents.getURL();
      checkControl(url);
      // Check the guest URL in the same turn as the probe or mutation.
      return contents.executeJavaScriptInIsolatedWorld(
        world,
        scripts.map((script) => ({
          ...script,
          code: `location.href === ${JSON.stringify(url)} ? (${script.code}) : "scope"`,
        })),
        userGesture,
      );
    },
  });
  if (request.operation === "repairQuickAction") {
    if (!pause || !session.bounds)
      throw new Error("Bring the paused browser tab into view before choosing a replacement.");
    const url = contents.getURL();
    const partition = session.partition;
    const choice = await this.pickQuickActionControl(session, action.origin);
    if (!choice) return null;
    if (
      state.paused !== pause ||
      this.quickActionPageToken(session) !== pageToken ||
      contents.getURL() !== url ||
      session.partition !== partition
    )
      throw new Error("The browser page changed while choosing a replacement.");
    const { description, filenamePattern } = action.outcome;
    const { selector, semantic, tag } = choice;
    const target = { selector, ...(semantic ? { semantic } : {}) };
    const repaired = validatedBrowserQuickAction({
      ...action,
      steps: action.steps.map((step, index) => {
        if (index !== pause.repairAt) return step;
        const { action, parameter } = step;
        return {
          action,
          ...target,
          ...(tag ? { tag } : {}),
          ...(parameter ? { parameter } : {}),
        };
      }),
      outcome:
        pause.repairAt === action.steps.length
          ? {
              description,
              ...target,
              ...(filenamePattern ? { filenamePattern } : {}),
            }
          : action.outcome,
    });
    const fileOutcomeRepair = !!filenamePattern && pause.repairAt === action.steps.length;
    const verifyReplacement = fileOutcomeRepair && pause.startAt === action.steps.length;
    const savedAction = pause.savedAction ?? (fileOutcomeRepair ? action : undefined);
    const pendingFileVerification = !verifyReplacement && savedAction !== undefined;
    if (verifyReplacement) {
      const scope = getBrowserPageScope(url);
      if (!scope || session.verificationLease)
        throw new Error("The browser tab is no longer available for file verification.");
      const lease = Symbol("browser-quick-action-repair");
      const epoch = session.controlEpoch;
      const checkRepair = () => {
        this.checkSubmissionGuard(session);
        if (
          this.sessions.get(session.key) !== session ||
          session.view.webContents !== contents ||
          contents.isDestroyed() ||
          state.paused !== pause ||
          this.quickActionPageToken(session) !== pageToken ||
          session.controlEpoch !== epoch ||
          session.partition !== partition ||
          contents.getURL() !== url
        )
          throw new Error("File verification interrupted by a change of browser page or control.");
      };
      session.verificationLease = lease;
      try {
        const result = await replayBrowserQuickAction(
          scopedContents(checkRepair),
          repaired,
          prepareBrowserQuickActionValues(repaired, {}, pause.startAt, pause.lockedValues),
          pause.startAt,
          checkRepair,
          scope.resource === null && scope.accountRoute === null,
          pause.fileBaseline,
        );
        checkRepair();
        if (result.status !== "pass" || !result.fileReceipt) throw new Error(result.message);
      } finally {
        if (session.verificationLease === lease) session.verificationLease = undefined;
      }
    }
    state.paused = {
      ...pause,
      action: repaired,
      ...(savedAction && { savedAction }),
      pendingFileVerification,
    };
    state.revoke();
    this.emitState(session);
    return {
      action: repaired,
      pendingFileVerification,
      ...(verifyReplacement &&
        savedAction && {
          verifiedRepair: { previous: savedAction, replacement: repaired },
        }),
    };
  }
  this.checkSubmissionGuard(session);
  const startAt = grant?.startAt ?? (input.resume === true ? pause?.startAt : 0);
  if (startAt === undefined || (pause && startAt !== pause.startAt))
    throw new Error("The previous run is paused here. Continue from its unfinished step.");
  const values =
    grant?.values ??
    prepareBrowserQuickActionValues(action, input.values, startAt, pause?.lockedValues);
  if (request.operation === "authorizeQuickAction") {
    if (
      typeof request.taskId !== "string" ||
      !request.taskId ||
      (session.assignedTaskId && session.assignedTaskId !== request.taskId) ||
      (pause?.agent &&
        (pause.agent.taskId !== request.taskId ||
          pause.agent.url !== contents.getURL() ||
          pause.agent.partition !== session.partition))
    )
      throw new Error("Choose a browser tab available to this conversation.");
    if (session.humanControlLocked)
      throw new Error("Return browser control to the agent before approving this run.");
    const id = randomUUID();
    state.authorize(
      {
        id,
        taskId: request.taskId,
        action,
        values,
        token: targetToken,
        startAt,
        url: contents.getURL(),
        partition: session.partition,
      },
      () => this.emitState(session),
    );
    this.emitState(session);
    return { id };
  }
  if (human && session.controller === "human") await this.resumeAgent(request);
  const epoch = session.controlEpoch;
  const assignedTaskId = session.assignedTaskId;
  const approvedUrl = contents.getURL();
  const lease = Symbol("browser-quick-action");
  const replayScope = getBrowserPageScope(approvedUrl);
  if (!replayScope || replayScope.origin !== action.origin)
    throw new Error("Open the approved website before running this Quick Action.");
  const partition = session.partition;
  const checkControl = (url?: string) => {
    this.checkSubmissionGuard(session);
    if (
      this.sessions.get(session.key) !== session ||
      session.view.webContents !== contents ||
      contents.isDestroyed() ||
      session.controlEpoch !== epoch ||
      session.controller === "human" ||
      session.assignedTaskId !== assignedTaskId ||
      session.partition !== partition ||
      !matchesPageScope(replayScope, url ?? contents.getURL())
    )
      throw new Error("Browser action interrupted by control or session changes.");
  };
  state.revoke();
  state.paused = undefined;
  state.running = { actionId: action.id };
  session.verificationLease = lease;
  session.quickActionScope = replayScope;
  try {
    return await this.trackAutomation(
      session,
      "run browser quick action",
      async () => {
        if (contents.getURL() !== approvedUrl || this.quickActionPageToken(session) !== pageToken)
          throw new Error("The approved browser page changed before replay started.");
        const { websiteFile, fileBaseline, unconfirmedStep, ...result } =
          await replayBrowserQuickAction(
            scopedContents(checkControl),
            action,
            values,
            startAt,
            checkControl,
            replayScope.resource === null && replayScope.accountRoute === null,
            pause?.fileBaseline,
          );
        if (result.status === "paused") {
          const agent = grant
            ? {
                pauseId: randomUUID(),
                taskId: grant.taskId,
                url: contents.getURL(),
                partition,
              }
            : undefined;
          const completedParameters = new Set(
            action.steps.slice(0, result.completedSteps).map((step) => step.parameter),
          );
          if (unconfirmedStep)
            completedParameters.add(action.steps[result.completedSteps]?.parameter);
          const lockedParameters = new Set(
            browserQuickActionParameters(action, result.completedSteps).filter((parameter) =>
              completedParameters.has(parameter),
            ),
          );
          if (fileBaseline)
            for (const parameter of browserQuickActionFilenameParameters(action))
              lockedParameters.add(parameter);
          const lockedValues = new Map<string, string>();
          for (const parameter of lockedParameters) {
            const value = values.get(parameter);
            if (value !== undefined) lockedValues.set(parameter, value);
          }
          state.paused = {
            action,
            pageToken: this.quickActionPageToken(session),
            startAt: result.completedSteps,
            repairAt: result.repairAt ?? result.completedSteps,
            ...(agent && { agent }),
            ...(unconfirmedStep && {
              unconfirmedStep: {
                id: randomUUID(),
                url: contents.getURL(),
                partition,
              },
            }),
            ...(lockedValues.size > 0 && { lockedValues }),
            ...(fileBaseline && { fileBaseline }),
            ...(pause?.savedAction && { savedAction: pause.savedAction }),
            ...(pause?.pendingFileVerification && {
              pendingFileVerification: true,
            }),
          };
          if (agent) {
            return {
              ...result,
              resumeRequest: {
                actionId: action.id,
                pause: {
                  pauseId: agent.pauseId,
                  tabId: session.sessionId,
                  profileId: session.profileId ?? "default",
                },
              },
            };
          }
        }
        if (result.status !== "pass" || !result.fileReceipt) return result;
        checkControl();
        const verifiedRepair =
          pause?.pendingFileVerification && pause.savedAction
            ? { previous: pause.savedAction, replacement: action }
            : undefined;
        if (grant) {
          const url = contents.getURL();
          const resultId = state.rememberFileResult({
            action: { origin: action.origin, outcome: action.outcome },
            receipt: result.fileReceipt,
            taskId: grant.taskId,
            instanceId: session.instanceId,
            url,
            pageToken: this.quickActionPageToken(session),
            partition,
          });
          let restorable = false;
          if (
            websiteFile &&
            isUserBrowserTab(session.sessionId) &&
            !session.temporaryAgentTab &&
            isPersistentPartition(partition) &&
            isBrowserAttachmentUrl(url)
          ) {
            try {
              const browserSession = contents.session;
              const storagePath = browserSession.storagePath;
              if (storagePath && browserSession.isPersistent()) {
                this.attachmentBookmarks.saveQuickActionFile(resultId, {
                  ...this.attachmentBookmark(session, grant.taskId, url, storagePath),
                  outcome: action.outcome,
                  receipt: result.fileReceipt,
                });
                restorable = true;
              }
            } catch {
              // The verified link can still be entered while its original page remains open.
            }
          }
          return {
            ...result,
            ...(verifiedRepair && { verifiedRepair }),
            fileResult: {
              resultId,
              tabId: session.sessionId,
              profileId: session.profileId ?? "default",
              filename: result.fileReceipt.filename,
              ...(restorable && { restorable: true }),
            },
          };
        }
        return verifiedRepair ? { ...result, verifiedRepair } : result;
      },
      request.taskId ?? assignedTaskId ?? undefined,
      request.source,
    );
  } finally {
    state.running = undefined;
    session.quickActionScope = undefined;
    if (session.verificationLease === lease) session.verificationLease = undefined;
    this.emitState(session);
  }
}

export async function enterQuickActionFileResult(
  this: BrowserHostManager,
  session: BrowserSession,
  request: BrowserAutomationRequest,
) {
  const id = automationInput(request.input).resultId;
  if (request.source !== "human" || !request.sessionId || typeof id !== "string" || !request.taskId)
    throw new Error("Open the verified file from its original thread and tab.");
  const result = session.quickAction?.fileResults.get(id);
  if (!result) {
    const saved = this.attachmentBookmarks.readQuickActionFile(id);
    if (!saved || saved.threadId !== request.taskId)
      throw new Error("Open the verified file from its original thread and tab.");
    const taskId = this.attachmentThread(session, request, saved.profileId);
    const scope = getBrowserPageScope(saved.url);
    if (!scope || scope.resource !== null || scope.accountRoute !== null)
      throw new Error("The verified file's browser page is unavailable.");
    return this.openSavedAttachment(session, request, taskId, saved, undefined, {
      verifyResult: (read) =>
        revealBrowserQuickActionFile(
          read,
          {
            action: { origin: scope.origin, outcome: saved.outcome },
            receipt: saved.receipt,
          },
          true,
        ),
    });
  }
  if (request.taskId !== result.taskId)
    throw new Error("Open the verified file from its original thread and tab.");
  if (
    session.verificationLease ||
    session.quickAction?.running ||
    session.journeyRecorder?.status().recording
  )
    throw new Error("Wait for the current browser operation to finish.");
  const contents = session.view.webContents;
  const epoch = session.controlEpoch;
  const scope = getBrowserPageScope(result.url);
  if (!scope) throw new Error("The verified file's browser page is unavailable.");
  const check = () => {
    if (
      this.sessions.get(session.key) !== session ||
      session.view.webContents !== contents ||
      session.instanceId !== result.instanceId ||
      session.partition !== result.partition ||
      session.controlEpoch !== epoch ||
      (session.assignedTaskId !== null && session.assignedTaskId !== result.taskId) ||
      session.resting ||
      session.loading ||
      contents.isDestroyed() ||
      contents.getURL() !== result.url ||
      this.quickActionPageToken(session) !== result.pageToken
    )
      throw new Error("The verified file's original browser page changed.");
  };
  const lease = Symbol("quick-action-file-result");
  session.verificationLease = lease;
  try {
    await revealBrowserQuickActionFile(
      async (expression) => {
        check();
        const value = await contents.executeJavaScriptInIsolatedWorld(999, [
          {
            code: `location.href === ${JSON.stringify(result.url)} ? (${expression}) : "scope"`,
          },
        ]);
        check();
        return value;
      },
      result,
      scope.accountRoute === null && scope.resource === null,
    );
    return { url: result.url };
  } finally {
    if (session.verificationLease === lease) session.verificationLease = undefined;
  }
}
