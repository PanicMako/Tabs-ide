import type { EnvironmentId, NativeApi, TerminalSummary, ThreadId } from "@tabs/contracts";
import { useEffect } from "react";
import { environmentApi } from "~/connection/environmentApiRegistry";

export interface TerminalAttachmentTarget {
  kind: "terminal";
  threadId: ThreadId;
  terminalId: string;
  instanceId: string;
}

function key(threadId: string, terminalId: string) {
  return JSON.stringify([threadId, terminalId]);
}

const instancesByEnvironment = new Map<EnvironmentId | null, Map<string, string>>();

/** Keep the synchronous drag payload tied to a backend PTY, including inactive session tabs. */
export function useTerminalAttachmentTargets(environmentId: EnvironmentId | null | undefined) {
  useEffect(() => {
    if (environmentId === undefined) return;
    const instances = new Map<string, string>();
    instancesByEnvironment.set(environmentId, instances);
    const updateInstance = (terminal: TerminalSummary) => {
      const terminalKey = key(terminal.threadId, terminal.terminalId);
      if (terminal.status === "running" && terminal.instanceId) {
        instances.set(terminalKey, terminal.instanceId);
      } else {
        instances.delete(terminalKey);
      }
    };
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void environmentApi(environmentId)
      .then((api) => {
        if (stopped) return;
        unsubscribe = api.terminal.onMetadata(
          (event) => {
            switch (event.type) {
              case "snapshot":
                instances.clear();
                event.terminals.forEach(updateInstance);
                break;
              case "upsert":
                updateInstance(event.terminal);
                break;
              case "remove":
                instances.delete(key(event.threadId, event.terminalId));
                break;
            }
          },
          { onResubscribe: () => instances.clear() },
        );
      })
      .catch(() => instances.clear());
    return () => {
      stopped = true;
      unsubscribe?.();
      if (instancesByEnvironment.get(environmentId) === instances) {
        instancesByEnvironment.delete(environmentId);
      }
    };
  }, [environmentId]);
}

export function terminalAttachmentTarget(
  environmentId: EnvironmentId | null,
  threadId: ThreadId,
  terminalId: string,
): TerminalAttachmentTarget | null {
  const instanceId = instancesByEnvironment.get(environmentId)?.get(key(threadId, terminalId));
  return instanceId ? { kind: "terminal", threadId, terminalId, instanceId } : null;
}

/** Ask the owning environment for a new snapshot before changing terminal focus. */
export async function terminalAttachmentIsCurrent(
  environmentId: EnvironmentId | null,
  target: TerminalAttachmentTarget,
): Promise<boolean> {
  return verifyTerminalAttachment((await environmentApi(environmentId)).terminal, target);
}

export function verifyTerminalAttachment(
  terminal: NativeApi["terminal"],
  target: TerminalAttachmentTarget,
): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const timeout = setTimeout(() => finish(false), 4000);
    let unsubscribe: (() => void) | undefined;
    const finish = (current: boolean) => {
      finished = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(current);
    };
    try {
      unsubscribe = terminal.onMetadata((event) => {
        if (finished || event.type !== "snapshot") return;
        finish(
          event.terminals.some(
            (terminal) =>
              terminal.threadId === target.threadId &&
              terminal.terminalId === target.terminalId &&
              terminal.instanceId === target.instanceId &&
              terminal.status === "running",
          ),
        );
      });
    } catch {
      finish(false);
    }
    if (finished) unsubscribe?.();
  });
}
