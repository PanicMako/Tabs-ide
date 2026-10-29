import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createCommitDraftController,
} = require("../resources/code-oss-extensions/tabs-workbench-integration/commitDraft.js");

function setup() {
  const inputBox = { value: "" };
  const rootUri = { fsPath: "/project", toString: () => "file:///project" };
  const send = vi.fn();
  const showInformationMessage = vi.fn();
  const controller = createCommitDraftController(
    {
      workspace: { isTrusted: true },
      window: { showInformationMessage },
      extensions: {
        getExtension: () => ({
          isActive: true,
          exports: { getAPI: () => ({ repositories: [{ rootUri, inputBox }] }) },
        }),
      },
    },
    send,
    () => true,
  );
  return { controller, send, rootUri, inputBox, showInformationMessage };
}

describe("commit draft input integration", () => {
  it("fills the selected repository input without committing", async () => {
    const { controller, send, rootUri, inputBox } = setup();
    const request = controller.generate(rootUri);
    const { requestId } = send.mock.calls[0]![0];
    controller.receive({ type: "commitDraftResult", requestId, message: "Improve documentation" });
    await request;
    expect(inputBox.value).toBe("Improve documentation");
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "generateCommitDraft",
      requestId,
      cwd: "/project",
    });
  });
  it("keeps a message edited while generation is pending", async () => {
    const { controller, send, rootUri, inputBox, showInformationMessage } = setup();
    const request = controller.generate(rootUri);
    inputBox.value = "My own edit";
    controller.receive({
      type: "commitDraftResult",
      requestId: send.mock.calls[0]![0].requestId,
      message: "Generated",
    });
    await request;
    expect(inputBox.value).toBe("My own edit");
    expect(showInformationMessage).toHaveBeenCalledOnce();
  });
  it("cancels a pending generation and ignores late results", async () => {
    const { controller, send, rootUri, inputBox } = setup();
    let cancel = () => {};
    const dispose = vi.fn();
    const request = controller.generate(rootUri, [], {
      isCancellationRequested: false,
      onCancellationRequested: (fn: () => void) => {
        cancel = fn;
        return { dispose };
      },
    });
    const { requestId } = send.mock.calls[0]![0];
    cancel();
    controller.receive({ type: "commitDraftResult", requestId, message: "Late" });
    await request;
    expect(inputBox.value).toBe("");
    expect(send).toHaveBeenLastCalledWith({ type: "cancelCommitDraft", requestId });
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("rejects pending work on disconnect", async () => {
    const { controller, rootUri } = setup();
    const request = controller.generate(rootUri);
    controller.disconnect();
    await expect(request).rejects.toThrow("disconnected");
  });
});
