import { useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { appAtomRegistry } from "~/state/atomRegistry";
import { clientSettingsAtom } from "~/state/settings";
import { threadsAtom } from "~/state/threads";
import { useAgentCliStore } from "~/stores/agentCliStore";
import { agentCliActivityTracker, createAgentCliActivityTracker } from "~/stores/agentCliActivity";
import { useThreadSurfaceStore } from "~/stores/threadSurfaceStore";
import { toastManager } from "~/components/ui/toast";

/** `${environmentId}:${threadId}` scopes written by the CLI panel. */
function parseScope(scope: string): { environmentId: string | null; threadId: string } {
  const index = scope.indexOf(":");
  const environmentId = scope.slice(0, index);
  return {
    environmentId: environmentId === "local" ? null : environmentId,
    threadId: scope.slice(index + 1),
  };
}

/**
 * Watches every agent CLI session's output and tells the user when an agent
 * that was working goes quiet — it finished or is waiting for input — unless
 * they are already looking at that session. Mounted once by the workspace
 * shell so it keeps working while the panel is closed or in GUI mode.
 */
export function AgentCliActivityHost() {
  const navigate = useNavigate();
  const workspaces = useAgentCliStore((state) => state.workspaces);
  const threads = useAtomValue(threadsAtom);
  const latest = useRef({ workspaces, threads });
  latest.current = { workspaces, threads };

  const sessionIndex = useMemo(() => {
    const index = new Map<string, { scope: string; label: string }>();
    for (const [scope, workspace] of Object.entries(workspaces))
      for (const session of workspace.sessions)
        index.set(session.terminalId, { scope, label: session.label });
    return index;
  }, [workspaces]);
  const sessionIndexRef = useRef(sessionIndex);
  sessionIndexRef.current = sessionIndex;

  useEffect(() => {
    const tracker = createAgentCliActivityTracker({
      onNeedsAttention: (terminalId) => {
        const entry = sessionIndexRef.current.get(terminalId);
        if (!entry || !appAtomRegistry.get(clientSettingsAtom).agentCliEnabled) return;
        const workspace = latest.current.workspaces[entry.scope];
        const { environmentId, threadId } = parseScope(entry.scope);
        const onThread = window.location.href.includes(encodeURIComponent(threadId));
        const looking =
          document.hasFocus() &&
          onThread &&
          useThreadSurfaceStore.getState().surfaceByThread[entry.scope] === "cli" &&
          workspace?.activeTerminalId === terminalId;
        if (looking) return;
        const title = latest.current.threads.find((thread) => thread.id === threadId)?.title;
        const agent = entry.label.replace(/ · fork$/, "");
        toastManager.add({
          type: "info",
          title: `${agent} is waiting for you`,
          description: title ? `In “${title}”` : "An agent CLI session finished or needs input.",
          actionProps: {
            children: "Show",
            onClick: () => {
              useAgentCliStore.getState().setActive(entry.scope, terminalId);
              useThreadSurfaceStore.getState().setSurface(entry.scope, "cli");
              void navigate({
                to: environmentId ? "/$environmentId/$threadId" : "/$threadId",
                params: environmentId ? { environmentId, threadId } : { threadId },
              } as never).catch(() => undefined);
            },
          },
        });
      },
    });
    agentCliActivityTracker.current = tracker;
    return () => {
      tracker.dispose();
      if (agentCliActivityTracker.current === tracker) agentCliActivityTracker.current = null;
    };
  }, [navigate]);

  const environmentKey = useMemo(
    () =>
      [...new Set(Object.keys(workspaces).map((scope) => parseScope(scope).environmentId ?? ""))]
        .toSorted()
        .join("\n"),
    [workspaces],
  );

  useEffect(() => {
    if (environmentKey === "" && Object.keys(latest.current.workspaces).length === 0) return;
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    for (const key of environmentKey.split("\n")) {
      void environmentApi(key === "" ? null : key)
        .then((api) => {
          if (disposed) return;
          unsubscribers.push(
            api.terminal.onEvent((event) => {
              if (!sessionIndexRef.current.has(event.terminalId)) return;
              const tracker = agentCliActivityTracker.current;
              if (!tracker) return;
              if (event.type === "output") tracker.output(event.terminalId);
              else if (event.type === "exited") tracker.forget(event.terminalId);
            }),
          );
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [environmentKey]);

  return null;
}
