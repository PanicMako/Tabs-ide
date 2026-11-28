import type { DesktopBrowserHostControlInput } from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { emptyBrowserState } from "~/components/agents/companion/browserSession";
import { browserHandoffOptions, runBrowserHandoff } from "./browserHandoff";

function attached(sessionId: string, taskId = "owner-thread") {
  return {
    ...emptyBrowserState("project", sessionId),
    instanceId: `instance-${sessionId}`,
    assignedTaskId: taskId,
    browserPageAuthorized: true,
  };
}

it("targets the selected private toolbar browser, or returns both available tabs for an explicit choice", async () => {
  const candidates = [
    { sessionId: "custom-qa", label: "QA", toolId: "qa" },
    { sessionId: "agents-surface-companion", label: "QA", surfaceId: "companion" },
    { sessionId: "browser", label: "Browser", toolId: "browser" },
  ];
  const bridge = {
    getBrowserSessionState: vi.fn(
      async ({ sessionId = "browser" }: DesktopBrowserHostControlInput) =>
        sessionId === "browser" ? emptyBrowserState("project", sessionId) : attached(sessionId),
    ),
  };
  await expect(
    browserHandoffOptions(bridge, "project", candidates, "custom-qa", "browser-my-turn"),
  ).resolves.toMatchObject([{ toolId: "qa" }]);
  expect(bridge.getBrowserSessionState).toHaveBeenCalledExactlyOnceWith({
    projectId: "project",
    sessionId: "custom-qa",
  });
  await expect(
    browserHandoffOptions(bridge, "project", candidates, "browser", "browser-stop"),
  ).resolves.toEqual([]);
  await expect(
    browserHandoffOptions(bridge, "project", candidates, undefined, "browser-stop"),
  ).resolves.toMatchObject([{ sessionId: "custom-qa" }, { sessionId: "agents-surface-companion" }]);
});

it("takes a demonstration turn, returns its meaning, and stops the owning thread on the same tab", async () => {
  const initial = attached("custom-qa");
  const human = { ...initial, controller: "human" as const };
  const target = { projectId: initial.projectId, sessionId: initial.sessionId };
  const bridge = {
    getBrowserSessionState: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(human),
    takeBrowserControl: vi.fn(async () => {}),
    resumeBrowserAgent: vi.fn(async () => {}),
    runBrowserAutomation: vi.fn(async () => {}),
  };
  await runBrowserHandoff(bridge, initial, "browser-my-turn");
  expect(bridge.takeBrowserControl).toHaveBeenCalledExactlyOnceWith({
    ...target,
    demonstrate: true,
  });
  await runBrowserHandoff(bridge, human, "browser-return", "Export selected rows");
  expect(bridge.resumeBrowserAgent).toHaveBeenCalledExactlyOnceWith({
    ...target,
    taskId: "owner-thread",
    meaning: "Export selected rows",
  });
  await runBrowserHandoff(bridge, human, "browser-stop");
  expect(bridge.runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
    ...target,
    taskId: "owner-thread",
    source: "human",
    operation: "revokeBrowserPage",
  });
});

it("rejects a takeover or stop if the chosen tab was replaced or reassigned", async () => {
  const expected = attached("browser");
  const bridge = {
    getBrowserSessionState: vi
      .fn()
      .mockResolvedValueOnce({ ...expected, instanceId: "replacement" })
      .mockResolvedValueOnce(attached("browser", "another-thread")),
    takeBrowserControl: vi.fn(async () => {}),
    runBrowserAutomation: vi.fn(async () => {}),
  };
  await expect(runBrowserHandoff(bridge, expected, "browser-my-turn")).rejects.toThrow("changed");
  await expect(runBrowserHandoff(bridge, expected, "browser-stop")).rejects.toThrow("changed");
  expect(bridge.takeBrowserControl).not.toHaveBeenCalled();
  expect(bridge.runBrowserAutomation).not.toHaveBeenCalled();
});

it("binds browser return to the exact human control generation", async () => {
  const human = { ...attached("custom-qa"), controller: "human" as const, controlEpoch: 7 };
  const receipt = { demonstrationId: "6fd2be84-3acc-4682-869e-aa5574d1793d", controlEpoch: 8 };
  const bridge = {
    getBrowserSessionState: vi
      .fn()
      .mockResolvedValueOnce({ ...human, controlEpoch: 9 })
      .mockResolvedValueOnce(human),
    resumeBrowserAgent: vi.fn(async () => receipt),
    runBrowserAutomation: vi.fn(async () => {}),
  };

  await expect(runBrowserHandoff(bridge, human, "browser-return")).rejects.toThrow("changed");
  expect(bridge.resumeBrowserAgent).not.toHaveBeenCalled();
  await expect(
    runBrowserHandoff(bridge, human, "browser-return", "Selected rows"),
  ).resolves.toEqual(receipt);
  expect(bridge.resumeBrowserAgent).toHaveBeenCalledExactlyOnceWith({
    projectId: human.projectId,
    sessionId: human.sessionId,
    taskId: human.assignedTaskId,
    meaning: "Selected rows",
    expectedGeneration: { instanceId: human.instanceId, controlEpoch: human.controlEpoch },
  });
});
