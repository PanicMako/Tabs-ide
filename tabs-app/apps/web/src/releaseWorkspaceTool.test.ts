import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";
import { DEFAULT_THREAD_TERMINAL_ID } from "./types";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  close: vi.fn(),
  state: vi.fn(),
  clear: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("./connection/environmentApiRegistry", () => ({ environmentApi: mocks.api }));
vi.mock("./state/terminal", () => ({
  getThreadTerminalState: mocks.state,
  terminalActions: { clear: mocks.clear },
}));
import { releaseWorkspaceTool } from "./releaseWorkspaceTool";
const project = {
  id: ProjectId.makeUnsafe("test-project"),
  environmentId: EnvironmentId.makeUnsafe("test-environment"),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.mockResolvedValue({ terminal: { close: mocks.close } });
  mocks.close.mockResolvedValue(undefined);
  vi.stubGlobal("window", { desktopBridge: { destroyBrowserSession: mocks.destroy } });
});
afterEach(() => vi.unstubAllGlobals());
it("releases the corresponding browser session", async () => {
  await releaseWorkspaceTool(project, {
    id: "scratch",
    kind: "custom_embed",
    label: "Scratch",
    visible: true,
    customEmbedId: "embed",
  });
  expect(mocks.destroy).toHaveBeenCalledWith({ projectId: project.id, sessionId: "custom-embed" });
});
it("stops all real shell sessions in the right environment before clearing their state", async () => {
  mocks.state.mockReturnValue({ terminalIds: [DEFAULT_THREAD_TERMINAL_ID, "shell", "split"] });
  await releaseWorkspaceTool(project, {
    id: "scratch-shell",
    kind: "custom_process",
    label: "Shell",
    visible: true,
    terminalProcessId: "shell",
  });
  expect(mocks.api).toHaveBeenCalledWith(project.environmentId);
  expect(mocks.close.mock.calls.map(([input]) => input.terminalId)).toEqual(["shell", "split"]);
  expect(mocks.clear).toHaveBeenCalledWith(ThreadId.makeUnsafe("server:test-project:custom:shell"));
});
it("keeps the local terminal state if stopping a session fails", async () => {
  mocks.state.mockReturnValue({ terminalIds: ["shell"] });
  mocks.close.mockRejectedValueOnce(new Error("Connection lost"));
  await expect(
    releaseWorkspaceTool(project, {
      id: "scratch-shell",
      kind: "custom_process",
      label: "Shell",
      visible: true,
      terminalProcessId: "shell",
    }),
  ).rejects.toThrow("Connection lost");
  expect(mocks.clear).not.toHaveBeenCalled();
});
