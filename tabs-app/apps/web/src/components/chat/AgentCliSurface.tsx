import { memo, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import type { ThreadId } from "@tabs/contracts";
import {
  ChevronDownIcon,
  Columns2Icon,
  GitForkIcon,
  MessagesSquareIcon,
  PlusIcon,
  SquareTerminalIcon,
} from "lucide-react";
import {
  agentCliSupportsFork,
  buildAgentCliCommand,
  findNativeSessionId,
  listAgentCliOptions,
  quoteShellArg,
  resolveAgentCliBinary,
  type AgentCliOption,
} from "~/agentCli";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { useComposerDraftStore } from "~/composerDraftStore";
import { WORKSPACE_FILE_MIME } from "~/lib/workspaceFileContext";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { useServerConfig } from "~/state/settings";
import {
  agentCliActivityTracker,
  useAgentCliActivityStore,
  type AgentCliActivity,
} from "~/stores/agentCliActivity";
import {
  EMPTY_AGENT_CLI_WORKSPACE,
  useAgentCliStore,
  type AgentCliSession,
} from "~/stores/agentCliStore";
import { threadSurfaceKey } from "~/stores/threadSurfaceStore";
import ThreadTerminalDrawer, {
  type TerminalLaunchProfile,
} from "~/components/ThreadTerminalDrawer";
import { resolveProviderIcon } from "~/components/providerIcons";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import "./threadSurface.css";

const ACTIVITY_LABEL: Record<AgentCliActivity, string> = {
  working: "Working",
  waiting: "Waiting for you",
  idle: "Ready",
};

/** Sentinel for a plain shell in the agent picker. */
const SHELL_OPTION: AgentCliOption = {
  instanceId: "",
  driver: "shell" as AgentCliOption["driver"],
  label: "Shell",
};

function newCliTerminalId(): string {
  return `agent-cli-${
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10)
  }`;
}

function acceptsDrop(event: DragEvent): boolean {
  return (
    event.dataTransfer.types.includes(WORKSPACE_FILE_MIME) ||
    event.dataTransfer.types.includes("text/plain")
  );
}

/** Absolute paths dropped onto the CLI, e.g. files dragged from the Files surface. */
function droppedPaths(event: DragEvent): string[] {
  const plain = event.dataTransfer.getData("text/plain").trim();
  if (!plain) return [];
  return plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/") || /^[A-Za-z]:[\\/]/.test(line));
}

function AgentIcon({ option, className }: { option: AgentCliOption; className?: string }) {
  const Icon =
    option === SHELL_OPTION || option.instanceId === ""
      ? SquareTerminalIcon
      : resolveProviderIcon(option.instanceId, option.driver);
  return <Icon aria-hidden="true" className={className ?? "size-3.5"} />;
}

export interface AgentCliSurfaceProps {
  threadId: ThreadId;
  environmentId: string | null;
  /** The thread's working tree (its worktree, or the project root). */
  cwd: string;
  runtimeEnv: Record<string, string>;
  /** Provider instance and model selected for this thread in the composer. */
  instanceId: string | null;
  model: string | null;
  /** The thread has a chat conversation that can be continued in the CLI. */
  hasConversation: boolean;
  /** Persist a draft thread before its first CLI session so it shows in the sidebar. */
  ensureThread?: ((agentLabel: string) => Promise<void>) | undefined;
  onSwitchToChat: () => void;
}

/**
 * The CLI surface of a thread: the thread's agent running as its own command
 * line program in a real terminal, in the thread's working tree, with the same
 * provider account. It replaces the chat timeline and composer while the
 * thread header (workspace actions, terminal drawer, side panel) stays.
 */
export const AgentCliSurface = memo(function AgentCliSurface({
  threadId,
  environmentId,
  cwd,
  runtimeEnv,
  instanceId,
  model,
  hasConversation,
  ensureThread,
  onSwitchToChat,
}: AgentCliSurfaceProps) {
  const serverConfig = useServerConfig();
  const options = useMemo(
    () => listAgentCliOptions(serverConfig?.providers ?? []),
    [serverConfig?.providers],
  );
  const threadOption = options.find((option) => option.instanceId === instanceId) ?? null;
  const [pickedInstanceId, setPickedInstanceId] = useState<string | null>(null);
  const selected =
    (pickedInstanceId === ""
      ? SHELL_OPTION
      : options.find((option) => option.instanceId === pickedInstanceId)) ??
    threadOption ??
    options[0] ??
    SHELL_OPTION;

  const scope = threadSurfaceKey(environmentId, threadId);
  const workspace = useAgentCliStore(
    (state) => state.workspaces[scope] ?? EMPTY_AGENT_CLI_WORKSPACE,
  );
  const activity = useAgentCliActivityStore((state) => state.activity);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const canForkWith = (option: AgentCliOption) =>
    hasConversation &&
    option !== SHELL_OPTION &&
    option.instanceId === instanceId &&
    agentCliSupportsFork(option.driver);

  const makeSession = useCallback(
    async (option: AgentCliOption, fork: boolean): Promise<AgentCliSession> => {
      const terminalId = newCliTerminalId();
      if (option === SHELL_OPTION || option.instanceId === "") {
        return { terminalId, instanceId: null, driver: null, label: "Shell", command: null };
      }
      const binary =
        resolveAgentCliBinary({
          driver: option.driver,
          instanceId: option.instanceId,
          settings: serverConfig?.settings,
        }) ?? option.driver;
      let forkFromSessionId: string | null = null;
      if (fork) {
        try {
          const api = await environmentApi(environmentId);
          const projection = await api.orchestration.getThreadProjection({ threadId });
          forkFromSessionId = findNativeSessionId(projection, { threadId, driver: option.driver });
        } catch {
          forkFromSessionId = null;
        }
        if (!forkFromSessionId) {
          toastManager.add({
            type: "info",
            title: "Starting a fresh session",
            description: `This thread has no ${option.label} session to continue yet.`,
          });
        }
      }
      // Only hand the composer's model to the agent it belongs to.
      const launch = buildAgentCliCommand({
        driver: option.driver,
        binary,
        model: option.instanceId === instanceId ? model : null,
        forkFromSessionId,
      });
      return {
        terminalId,
        instanceId: option.instanceId,
        driver: option.driver,
        label: launch?.forked ? `${option.label} · fork` : option.label,
        command: launch?.command ?? binary,
      };
    },
    [environmentId, instanceId, model, serverConfig?.settings, threadId],
  );

  const launch = useCallback(
    async (option: AgentCliOption, settings: { fork?: boolean; split?: boolean } = {}) => {
      if (launching) return;
      setLaunching(true);
      try {
        await ensureThread?.(option.label).catch((error: unknown) => {
          toastManager.add({
            type: "warning",
            title: "The thread could not be saved",
            description: error instanceof Error ? error.message : String(error),
          });
        });
        const session = await makeSession(option, settings.fork ?? false);
        useAgentCliStore
          .getState()
          .add(scope, session, settings.split ? { split: true } : undefined);
        setFocusRequestId((value) => value + 1);
      } finally {
        setLaunching(false);
      }
    },
    [ensureThread, launching, makeSession, scope],
  );

  const closeTerminal = useCallback(
    (terminalId: string) =>
      environmentApi(environmentId)
        .then((api) => api.terminal.close({ threadId, terminalId, deleteHistory: true }))
        .catch(() => undefined),
    [environmentId, threadId],
  );

  const closeSession = useCallback(
    (terminalId: string) => {
      useAgentCliStore.getState().remove(scope, terminalId);
      agentCliActivityTracker.current?.forget(terminalId);
      void closeTerminal(terminalId);
    },
    [closeTerminal, scope],
  );

  const restartSession = useCallback(
    (terminalId: string) => {
      const current = workspace.sessions.find((session) => session.terminalId === terminalId);
      if (!current) return;
      const next: AgentCliSession = { ...current, terminalId: newCliTerminalId() };
      agentCliActivityTracker.current?.forget(terminalId);
      void closeTerminal(terminalId).finally(() => {
        useAgentCliStore.getState().replace(scope, terminalId, next);
        setFocusRequestId((value) => value + 1);
      });
    },
    [closeTerminal, scope, workspace.sessions],
  );

  const activeSession =
    workspace.sessions.find((session) => session.terminalId === workspace.activeTerminalId) ??
    workspace.sessions[0] ??
    null;
  const launchProfiles = useMemo(
    () =>
      Object.fromEntries(
        workspace.sessions.map((session): [string, TerminalLaunchProfile] => [
          session.terminalId,
          { providerInstanceId: session.instanceId, command: session.command },
        ]),
      ),
    [workspace.sessions],
  );
  const terminalLabels = useMemo(
    () =>
      Object.fromEntries(
        workspace.sessions.map((session) => {
          const state = activity[session.terminalId];
          const marker = state === "working" ? " ◐" : state === "waiting" ? " ●" : "";
          return [session.terminalId, `${session.label}${marker}`];
        }),
      ),
    [activity, workspace.sessions],
  );
  const activeActivity = activeSession ? (activity[activeSession.terminalId] ?? "idle") : "idle";
  // Looking at a session that was waiting counts as having seen it.
  useEffect(() => {
    if (activeSession && activeActivity === "waiting" && document.hasFocus())
      agentCliActivityTracker.current?.acknowledge(activeSession.terminalId);
  }, [activeActivity, activeSession]);

  const writeToActive = useCallback(
    (data: string) => {
      if (!activeSession) return;
      agentCliActivityTracker.current?.input(activeSession.terminalId);
      void environmentApi(environmentId)
        .then((api) => api.terminal.write({ threadId, terminalId: activeSession.terminalId, data }))
        .catch(() => undefined);
      setFocusRequestId((value) => value + 1);
    },
    [activeSession, environmentId, threadId],
  );

  const allOptions = [...options, SHELL_OPTION];

  if (workspace.sessions.length === 0) {
    return (
      <div className="agent-cli agent-cli-launcher">
        <div className="agent-cli-launcher-inner">
          <div className="agent-cli-prompt" aria-hidden="true">
            <span className="agent-cli-prompt-path">{cwd}</span>
            <span>
              <span className="agent-cli-prompt-caret">❯</span>{" "}
              {selected === SHELL_OPTION ? "" : selected.label.toLowerCase()}
              <span className="agent-cli-cursor" />
            </span>
          </div>
          <h2>Run an agent in the terminal</h2>
          <p>
            The agent&apos;s own CLI, in this thread&apos;s working tree with the same account and
            settings. Workspace actions, the terminal drawer and the side panel stay one click away.
          </p>
          <div className="agent-cli-agent-grid" role="radiogroup" aria-label="Agent">
            {allOptions.map((option) => (
              <button
                key={option.instanceId || "shell"}
                type="button"
                role="radio"
                aria-checked={option.instanceId === selected.instanceId}
                className="agent-cli-agent"
                onClick={() => setPickedInstanceId(option.instanceId)}
                onDoubleClick={() => void launch(option)}
              >
                <AgentIcon option={option} className="size-4" />
                <span className="truncate">{option.label}</span>
                {option.instanceId === instanceId && option !== SHELL_OPTION && (
                  <span className="agent-cli-agent-tag">This thread</span>
                )}
              </button>
            ))}
          </div>
          <div className="agent-cli-actions">
            <button
              type="button"
              className="agent-cli-primary"
              onClick={() => void launch(selected)}
              disabled={launching}
            >
              {/* Brand marks are drawn in the foreground colour, which is this
                  button's background; a chip keeps every logo visible. */}
              <span className="agent-cli-icon-chip">
                <AgentIcon option={selected} />
              </span>
              Start {selected === SHELL_OPTION ? "shell" : selected.label}
            </button>
            {canForkWith(selected) && (
              <button
                type="button"
                className="agent-cli-secondary"
                onClick={() => void launch(selected, { fork: true })}
                disabled={launching}
                title="Start a CLI session with a copy of this conversation. The chat stays unchanged."
              >
                <GitForkIcon aria-hidden="true" className="size-3.5" />
                Continue this conversation
              </button>
            )}
            <button type="button" className="agent-cli-secondary" onClick={onSwitchToChat}>
              <MessagesSquareIcon aria-hidden="true" className="size-3.5" />
              Back to chat
            </button>
          </div>
          {options.length === 0 && (
            <p className="agent-cli-hint">
              No agent CLI is enabled. Turn on a provider in Settings → Providers, or start a shell.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="agent-cli agent-cli-running"
      data-drop-active={dropActive || undefined}
      onKeyDownCapture={() => {
        if (activeSession) agentCliActivityTracker.current?.input(activeSession.terminalId);
      }}
      onPasteCapture={() => {
        if (activeSession) agentCliActivityTracker.current?.input(activeSession.terminalId);
      }}
      onDragOver={(event) => {
        if (!acceptsDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={(event) => {
        setDropActive(false);
        const paths = droppedPaths(event);
        if (paths.length === 0) return;
        event.preventDefault();
        // Agents read file paths from the prompt; insert them where the cursor is.
        writeToActive(`${paths.map(quoteShellArg).join(" ")} `);
      }}
    >
      <div className="agent-cli-toolbar">
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="agent-cli-tool"
                aria-label="Start another agent session"
                disabled={launching}
              >
                <PlusIcon aria-hidden="true" className="size-3.5" />
                <span>New</span>
                <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
              </button>
            }
          />
          <MenuPopup align="start" className="w-60">
            <MenuGroup>
              <MenuGroupLabel>New tab</MenuGroupLabel>
              {allOptions.map((option) => (
                <MenuItem key={`tab-${option.instanceId}`} onClick={() => void launch(option)}>
                  <AgentIcon option={option} />
                  <span className="flex-1 truncate">{option.label}</span>
                </MenuItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Split beside current</MenuGroupLabel>
              {allOptions.map((option) => (
                <MenuItem
                  key={`split-${option.instanceId}`}
                  onClick={() => void launch(option, { split: true })}
                >
                  <Columns2Icon aria-hidden="true" className="size-3.5" />
                  <span className="flex-1 truncate">{option.label}</span>
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
        {canForkWith(threadOption ?? SHELL_OPTION) && threadOption && (
          <button
            type="button"
            className="agent-cli-tool"
            disabled={launching}
            onClick={() => void launch(threadOption, { fork: true })}
            title="Start a CLI session with a copy of this conversation. The chat stays unchanged."
          >
            <GitForkIcon aria-hidden="true" className="size-3.5" />
            <span>Continue conversation</span>
          </button>
        )}
        <span
          className="agent-cli-status"
          data-activity={activeActivity}
          role="status"
          aria-live="polite"
        >
          {activeSession?.label ?? "Agent"} · {ACTIVITY_LABEL[activeActivity]}
        </span>
        <span className="agent-cli-cwd" title={cwd}>
          {cwd}
        </span>
      </div>
      <ThreadTerminalDrawer
        environmentId={environmentId}
        runtimeEnv={runtimeEnv}
        threadId={threadId}
        cwd={cwd}
        variant="embedded"
        height={400}
        showControls={true}
        terminalIds={workspace.sessions.map((session) => session.terminalId)}
        activeTerminalId={activeSession?.terminalId ?? ""}
        terminalGroups={workspace.groups.map((group) => ({
          id: group.id,
          terminalIds: [...group.terminalIds],
        }))}
        activeTerminalGroupId={
          workspace.groups.find((group) =>
            group.terminalIds.includes(activeSession?.terminalId ?? ""),
          )?.id ?? ""
        }
        terminalLabels={terminalLabels}
        launchProfiles={launchProfiles}
        focusRequestId={focusRequestId}
        onSplitTerminal={() => {
          const option =
            options.find((entry) => entry.instanceId === activeSession?.instanceId) ?? SHELL_OPTION;
          void launch(option, { split: true });
        }}
        onNewTerminal={() => void launch(selected)}
        onActiveTerminalChange={(terminalId) =>
          useAgentCliStore.getState().setActive(scope, terminalId)
        }
        onCloseTerminal={closeSession}
        onKillTerminal={restartSession}
        onHeightChange={() => {}}
        onAddTerminalContext={(selection) => {
          const composerId = environmentId
            ? scopedComposerThreadId(environmentId as never, threadId)
            : threadId;
          useComposerDraftStore.getState().addTerminalContext(composerId, {
            id: crypto.randomUUID(),
            threadId: composerId,
            createdAt: new Date().toISOString(),
            ...selection,
          });
        }}
      />
    </div>
  );
});
