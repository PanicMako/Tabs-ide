import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";
import { MAX_TERMINALS_PER_GROUP, type ThreadTerminalGroup } from "~/types";

/**
 * Agent CLI sessions shown in the companion panel's CLI mode, per thread.
 *
 * The PTYs live on the server under the thread's terminal namespace, so this
 * store only remembers which terminal ids are CLI sessions and what launched
 * them. It is kept apart from the thread's ordinary terminal state so the GUI
 * Terminal surface and the CLI mode never show each other's shells.
 */
export interface AgentCliSession {
  readonly terminalId: string;
  /** Provider instance whose environment the session runs with; null = plain shell. */
  readonly instanceId: string | null;
  readonly driver: string | null;
  readonly label: string;
  readonly command: string | null;
}

export interface AgentCliWorkspace {
  readonly sessions: ReadonlyArray<AgentCliSession>;
  readonly groups: ReadonlyArray<ThreadTerminalGroup>;
  readonly activeTerminalId: string | null;
}

export const EMPTY_AGENT_CLI_WORKSPACE: AgentCliWorkspace = {
  sessions: [],
  groups: [],
  activeTerminalId: null,
};

interface AgentCliState {
  readonly workspaces: Record<string, AgentCliWorkspace>;
  /** Add a session as a new tab, or split it into the active session's group. */
  add: (scope: string, session: AgentCliSession, options?: { split?: boolean }) => void;
  remove: (scope: string, terminalId: string) => void;
  /** Swap one session for another in place (restart / relaunch). */
  replace: (scope: string, terminalId: string, session: AgentCliSession) => void;
  setActive: (scope: string, terminalId: string) => void;
}

export function addAgentCliSession(
  workspace: AgentCliWorkspace,
  session: AgentCliSession,
  options: { split?: boolean } = {},
): AgentCliWorkspace {
  const activeGroup = workspace.groups.find((group) =>
    group.terminalIds.includes(workspace.activeTerminalId ?? ""),
  );
  const canSplit =
    options.split === true &&
    activeGroup !== undefined &&
    activeGroup.terminalIds.length < MAX_TERMINALS_PER_GROUP;
  return {
    sessions: [...workspace.sessions, session],
    groups: canSplit
      ? workspace.groups.map((group) =>
          group === activeGroup
            ? { ...group, terminalIds: [...group.terminalIds, session.terminalId] }
            : group,
        )
      : [
          ...workspace.groups,
          { id: `group-${session.terminalId}`, terminalIds: [session.terminalId] },
        ],
    activeTerminalId: session.terminalId,
  };
}

export function removeAgentCliSession(
  workspace: AgentCliWorkspace,
  terminalId: string,
): AgentCliWorkspace {
  const order = workspace.groups.flatMap((group) => group.terminalIds);
  const index = order.indexOf(terminalId);
  const remaining = order.filter((id) => id !== terminalId);
  return {
    sessions: workspace.sessions.filter((session) => session.terminalId !== terminalId),
    groups: workspace.groups
      .map((group) => ({
        ...group,
        terminalIds: group.terminalIds.filter((id) => id !== terminalId),
      }))
      .filter((group) => group.terminalIds.length > 0),
    activeTerminalId:
      workspace.activeTerminalId === terminalId
        ? (remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null)
        : workspace.activeTerminalId,
  };
}

export function replaceAgentCliSession(
  workspace: AgentCliWorkspace,
  terminalId: string,
  session: AgentCliSession,
): AgentCliWorkspace {
  if (!workspace.sessions.some((entry) => entry.terminalId === terminalId)) {
    return addAgentCliSession(workspace, session);
  }
  return {
    sessions: workspace.sessions.map((entry) =>
      entry.terminalId === terminalId ? session : entry,
    ),
    groups: workspace.groups.map((group) => ({
      ...group,
      terminalIds: group.terminalIds.map((id) => (id === terminalId ? session.terminalId : id)),
    })),
    activeTerminalId:
      workspace.activeTerminalId === terminalId ? session.terminalId : workspace.activeTerminalId,
  };
}

export const useAgentCliStore = create<AgentCliState>()(
  persist(
    (set) => {
      const update = (scope: string, fn: (workspace: AgentCliWorkspace) => AgentCliWorkspace) =>
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [scope]: fn(state.workspaces[scope] ?? EMPTY_AGENT_CLI_WORKSPACE),
          },
        }));
      return {
        workspaces: {},
        add: (scope, session, options) =>
          update(scope, (workspace) => addAgentCliSession(workspace, session, options)),
        remove: (scope, terminalId) =>
          update(scope, (workspace) => removeAgentCliSession(workspace, terminalId)),
        replace: (scope, terminalId, session) =>
          update(scope, (workspace) => replaceAgentCliSession(workspace, terminalId, session)),
        setActive: (scope, terminalId) =>
          update(scope, (workspace) =>
            workspace.sessions.some((session) => session.terminalId === terminalId)
              ? { ...workspace, activeTerminalId: terminalId }
              : workspace,
          ),
      };
    },
    {
      name: "tabs:agent-cli-sessions:v1",
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
      ),
    },
  ),
);
