import type {
  DesktopBridge,
  DesktopBrowserDemonstrationReceipt,
  DesktopBrowserSessionState,
} from "@tabs/contracts";
import { isUserBrowserTab } from "@tabs/shared/preview";

export type BrowserHandoffAction = "browser-my-turn" | "browser-stop" | "browser-return";

const browserActivityLabels = new Map([
  ["snapshot", "Inspecting the page"],
  ["navigate", "Opening a page"],
  ["click", "Clicking a control"],
  ["type", "Entering text"],
  ["press", "Pressing a key"],
  ["scroll", "Scrolling the page"],
  ["waitFor", "Waiting for the page"],
  ["attach device screenshot", "Attaching a device screenshot"],
  ["run browser quick action", "Running a Quick Action"],
  ["check breakpoint and submit", "Checking the breakpoint before submitting"],
  ["inspect workflow status", "Checking the draft status"],
]);

export function browserHandoffStatus(state: DesktopBrowserSessionState) {
  if (state.controller === "human") return "Your turn";
  if (state.controller === "agent" && state.activeAgentAction)
    return browserActivityLabels.get(state.activeAgentAction) ?? "Agent is using this page";
  return state.browserPageAuthorized || state.deviceScreenshotAuthorized
    ? "Has page access"
    : "Assigned";
}

export interface BrowserHandoffCandidate {
  sessionId: string;
  label: string;
  toolId?: string;
  surfaceId?: string;
}

export async function browserHandoffOptions(
  bridge: Pick<DesktopBridge, "getBrowserSessionState">,
  projectId: string,
  candidates: readonly BrowserHandoffCandidate[],
  selectedSessionId: string | undefined,
  action: BrowserHandoffAction,
) {
  const requested = selectedSessionId
    ? candidates.filter((candidate) => candidate.sessionId === selectedSessionId)
    : candidates;
  const results = await Promise.allSettled(
    requested.map(async (candidate) => ({
      ...candidate,
      state: await bridge.getBrowserSessionState({ projectId, sessionId: candidate.sessionId }),
    })),
  );
  return results.flatMap((result) => {
    if (result.status === "rejected") {
      if (selectedSessionId) throw result.reason;
      return [];
    }
    const { state, sessionId } = result.value;
    return state.projectId === projectId &&
      state.sessionId === sessionId &&
      browserHandoffAvailable(state, action)
      ? [result.value]
      : [];
  });
}

export function browserHandoffAvailable(
  state: DesktopBrowserSessionState,
  action: BrowserHandoffAction,
) {
  if (!state.instanceId || !state.assignedTaskId || !isUserBrowserTab(state.sessionId))
    return false;
  if (action === "browser-stop") return true;
  if (action === "browser-return")
    return state.controller === "human" && state.browserPageAuthorized === true;
  return (
    state.controller !== "human" &&
    (state.controller === "agent" ||
      state.browserPageAuthorized === true ||
      state.deviceScreenshotAuthorized === true)
  );
}

export async function runBrowserHandoff(
  bridge: Pick<
    DesktopBridge,
    "getBrowserSessionState" | "takeBrowserControl" | "resumeBrowserAgent" | "runBrowserAutomation"
  >,
  expected: DesktopBrowserSessionState,
  action: BrowserHandoffAction,
  meaning?: string,
) {
  const target = { projectId: expected.projectId, sessionId: expected.sessionId };
  const state = await bridge.getBrowserSessionState(target);
  if (
    state.projectId !== target.projectId ||
    state.sessionId !== target.sessionId ||
    state.instanceId !== expected.instanceId ||
    state.assignedTaskId !== expected.assignedTaskId ||
    state.controlEpoch !== expected.controlEpoch ||
    !browserHandoffAvailable(state, action)
  )
    throw new Error("The browser tab or its control changed. Select it again.");
  if (action === "browser-stop") {
    return bridge.runBrowserAutomation({
      ...target,
      taskId: state.assignedTaskId!,
      source: "human",
      operation: "revokeBrowserPage",
    });
  }
  if (action === "browser-my-turn" && bridge.takeBrowserControl) {
    return bridge.takeBrowserControl({ ...target, demonstrate: true });
  }
  if (action === "browser-return" && bridge.resumeBrowserAgent) {
    return bridge.resumeBrowserAgent({
      ...target,
      taskId: state.assignedTaskId!,
      ...(meaning ? { meaning } : {}),
      ...(state.controlEpoch === undefined
        ? {}
        : {
            expectedGeneration: { instanceId: state.instanceId!, controlEpoch: state.controlEpoch },
          }),
    });
  }
  throw new Error("Browser handoff is unavailable in this desktop session.");
}

export function isBrowserDemonstrationReceipt(
  value: unknown,
): value is DesktopBrowserDemonstrationReceipt {
  return (
    typeof value === "object" &&
    value !== null &&
    "demonstrationId" in value &&
    typeof value.demonstrationId === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.demonstrationId) &&
    "controlEpoch" in value &&
    Number.isSafeInteger(value.controlEpoch)
  );
}
