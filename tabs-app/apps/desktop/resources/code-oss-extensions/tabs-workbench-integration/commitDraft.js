const crypto = require("node:crypto");

function createCommitDraftController(vscode, send, isConnected) {
  const pending = new Map();
  function settle(id, error, message) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timeout);
    request.cancellation?.dispose();
    if (error) request.reject(new Error(error));
    else request.resolve(message);
  }
  return {
    receive(message) {
      if (message.type !== "commitDraftResult" || typeof message.requestId !== "string") return;
      settle(
        message.requestId,
        typeof message.error === "string" ? message.error : null,
        typeof message.message === "string" ? message.message : "",
      );
    },
    disconnect() {
      for (const id of pending.keys()) settle(id, "Tabs disconnected. Try generating again.");
    },
    async generate(rootUri, _context, token) {
      if (token?.isCancellationRequested) return;
      if (!isConnected()) throw new Error("Tabs is reconnecting. Try again shortly.");
      if (!vscode.workspace.isTrusted)
        throw new Error("Trust this workspace before sending changes to an AI provider.");
      const extension = vscode.extensions.getExtension("vscode.git");
      const git =
        extension && (extension.isActive ? extension.exports : await extension.activate());
      const repositories = git?.getAPI(1).repositories ?? [];
      const repository = rootUri
        ? repositories.find((r) => r.rootUri.toString() === rootUri.toString())
        : repositories.length === 1
          ? repositories[0]
          : null;
      if (!repository)
        throw new Error("Choose a repository in Source Control before generating a message.");
      const original = repository.inputBox.value;
      const id = crypto.randomUUID();
      let cancelled = false;
      const message = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          send({ type: "cancelCommitDraft", requestId: id });
          settle(id, "Commit generation timed out. Try again.");
        }, 95_000);
        pending.set(id, { resolve, reject, timeout });
        const cancellation = token?.onCancellationRequested(() => {
          cancelled = true;
          send({ type: "cancelCommitDraft", requestId: id });
          settle(id, null, "");
        });
        if (pending.has(id)) pending.get(id).cancellation = cancellation;
        else cancellation?.dispose();
        if (token?.isCancellationRequested) {
          cancelled = true;
          settle(id, null, "");
          return;
        }
        send({ type: "generateCommitDraft", requestId: id, cwd: repository.rootUri.fsPath });
      });
      if (cancelled || token?.isCancellationRequested || !message) return;
      if (repository.inputBox.value !== original) {
        await vscode.window.showInformationMessage(
          "Your commit message changed while generating. Your edits were kept; generate again when ready.",
        );
        return;
      }
      repository.inputBox.value = message;
    },
  };
}
module.exports = { createCommitDraftController };
