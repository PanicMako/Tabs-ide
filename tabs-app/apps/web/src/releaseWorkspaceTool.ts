import { ThreadId } from "@tabs/contracts";
import type { ProjectToolDefinition } from "@tabs/contracts/settings";
import { environmentApi } from "./connection/environmentApiRegistry";
import { getThreadTerminalState, terminalActions } from "./state/terminal";
import { DEFAULT_THREAD_TERMINAL_ID, type Project } from "./types";

/** Release live resources before removing a tool's saved definition. */
export async function releaseWorkspaceTool(
  project: Pick<Project, "id" | "environmentId">,
  tool: ProjectToolDefinition,
): Promise<void> {
  if (tool.kind === "custom_embed" && tool.customEmbedId) {
    await window.desktopBridge?.destroyBrowserSession?.({
      projectId: project.id,
      sessionId: `custom-${tool.customEmbedId}`,
    });
  } else if (tool.kind === "custom_process" && tool.terminalProcessId) {
    const threadId = ThreadId.makeUnsafe(`server:${project.id}:custom:${tool.terminalProcessId}`);
    const ids =
      getThreadTerminalState(threadId)?.terminalIds.filter(
        (id) => id !== DEFAULT_THREAD_TERMINAL_ID || id === tool.terminalProcessId,
      ) ?? [];
    if (ids.length) {
      const api = await environmentApi(project.environmentId);
      for (const terminalId of ids) await api.terminal.close({ threadId, terminalId });
    }
    terminalActions.clear(threadId);
  }
}
