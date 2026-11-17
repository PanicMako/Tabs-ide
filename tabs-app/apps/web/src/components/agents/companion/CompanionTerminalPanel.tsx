import { memo, useCallback, useMemo, useState } from "react";
import type { ThreadId } from "@tabs/contracts";
import { CompanionEmpty } from "./CompanionChrome";
import { useThreadTerminalState, terminalActions } from "~/state/terminal";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useComposerDraftStore } from "~/composerDraftStore";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { toastManager } from "~/components/ui/toast";
import { projectScriptRuntimeEnv } from "~/projectScripts";
import ThreadTerminalDrawer from "~/components/ThreadTerminalDrawer";
import { RotateCcwIcon, SquareSplitHorizontalIcon } from "lucide-react";
import { SurfaceSubTabs, type SubTab } from "./designs/shared";
import { showCustomConfirm } from "~/lib/customConfirm";

function createTerminalId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? `terminal-${crypto.randomUUID()}`
    : `terminal-${Math.random().toString(36).slice(2, 10)}`;
}

export interface CompanionTerminalPanelProps {
  threadId?: ThreadId | null | undefined;
}

export const CompanionTerminalPanel = memo(function CompanionTerminalPanel({
  threadId,
}: CompanionTerminalPanelProps) {
  const target = useActiveProjectTarget(threadId);
  const effectiveThreadId = threadId ?? target?.threadId ?? null;
  const runtimeEnv = useMemo(
    () =>
      target
        ? projectScriptRuntimeEnv({ project: { cwd: target.projectCwd }, worktreePath: target.cwd })
        : {},
    [target?.cwd, target?.projectCwd],
  );
  const terminalState = useThreadTerminalState(effectiveThreadId);
  const [focusRequestId, setFocusRequestId] = useState(0);

  const handleSplit = useCallback(() => {
    if (!effectiveThreadId || !terminalState) return;
    const terminalId = createTerminalId();
    terminalActions.split(effectiveThreadId, terminalId);
    setFocusRequestId((n) => n + 1);
  }, [effectiveThreadId, terminalState]);

  const handleNew = useCallback(() => {
    if (!effectiveThreadId || !terminalState) return;
    const terminalId = createTerminalId();
    terminalActions.new(effectiveThreadId, terminalId);
    setFocusRequestId((n) => n + 1);
  }, [effectiveThreadId, terminalState]);

  const handleActiveChange = useCallback(
    (terminalId: string) => {
      if (!effectiveThreadId) return;
      terminalActions.setActive(effectiveThreadId, terminalId);
    },
    [effectiveThreadId],
  );

  const handleClose = useCallback(
    (terminalId: string) => {
      if (!effectiveThreadId || !target) return;
      void environmentApi(target.environmentId)
        .then(async (api) => {
          await api.terminal.close({
            threadId: effectiveThreadId,
            terminalId,
            deleteHistory: true,
          });
          terminalActions.close(effectiveThreadId, terminalId);
        })
        .catch((error: unknown) =>
          toastManager.add({
            type: "error",
            title: "Could not close terminal",
            description: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    [effectiveThreadId, target],
  );

  const handleKill = useCallback(
    (terminalId: string) => {
      if (!effectiveThreadId || !target) return;
      void environmentApi(target.environmentId)
        .then(async (api) => {
          await api.terminal.close({
            threadId: effectiveThreadId,
            terminalId,
            deleteHistory: true,
          });
          terminalActions.close(effectiveThreadId, terminalId);
          terminalActions.new(effectiveThreadId, createTerminalId());
          setFocusRequestId((n) => n + 1);
        })
        .catch((error: unknown) =>
          toastManager.add({
            type: "error",
            title: "Could not restart terminal",
            description: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    [effectiveThreadId, target],
  );

  if (!effectiveThreadId || !target || !terminalState) {
    return (
      <CompanionEmpty kind="terminal" title="A shell for this thread">
        Start a thread in a project to open its terminal.
      </CompanionEmpty>
    );
  }

  // Sessions are page-style tabs, like browser tabs, instead of the drawer's own floating
  // controls and side list.
  const sessionTabs: SubTab[] = terminalGroups(terminalState).map((group, index) => {
    const labels = group.map(
      (id) =>
        terminalState.terminalLabels?.[id] ??
        `Terminal ${terminalState.terminalIds.indexOf(id) + 1}`,
    );
    return {
      id: group.includes(terminalState.activeTerminalId)
        ? terminalState.activeTerminalId
        : group[0]!,
      label: group.length > 1 ? labels.join(" | ") : (labels[0] ?? `Terminal ${index + 1}`),
      title: `${labels.join(" | ")} · ${target.cwd}`,
      busy: group.some((id) => terminalState.runningTerminalIds?.includes(id)),
    };
  });
  return (
    <div className="companion-workspace">
      <SurfaceSubTabs
        label="Terminal sessions"
        tabs={sessionTabs}
        activeId={terminalState.activeTerminalId}
        onSelect={handleActiveChange}
        onClose={async (id) => {
          const group = terminalGroups(terminalState).find((item) => item.includes(id)) ?? [id];
          const running = group.some((terminalId) =>
            terminalState.runningTerminalIds?.includes(terminalId),
          );
          if (
            running &&
            !(await showCustomConfirm("Close this terminal? Its running process will stop."))
          )
            return;
          for (const terminalId of group) handleClose(terminalId);
        }}
        onNew={handleNew}
        newLabel="New terminal"
        actions={
          <>
            <button
              type="button"
              className="cd-icon"
              aria-label="Split terminal"
              title="Split terminal"
              onClick={handleSplit}
            >
              <SquareSplitHorizontalIcon aria-hidden="true" size={14} />
            </button>
            <button
              type="button"
              className="cd-icon"
              aria-label="Restart terminal"
              title="Restart terminal (kill process and start again)"
              onClick={() => handleKill(terminalState.activeTerminalId)}
            >
              <RotateCcwIcon aria-hidden="true" size={14} />
            </button>
          </>
        }
      />
      <ThreadTerminalDrawer
        environmentId={target.environmentId}
        runtimeEnv={runtimeEnv}
        threadId={effectiveThreadId}
        cwd={target.cwd}
        variant="embedded"
        height={400}
        showControls={false}
        terminalIds={terminalState.terminalIds}
        activeTerminalId={terminalState.activeTerminalId}
        terminalGroups={terminalState.terminalGroups}
        activeTerminalGroupId={terminalState.activeTerminalGroupId}
        focusRequestId={focusRequestId}
        onSplitTerminal={handleSplit}
        onNewTerminal={handleNew}
        onActiveTerminalChange={handleActiveChange}
        onCloseTerminal={handleClose}
        onKillTerminal={handleKill}
        onHeightChange={() => {}}
        onAddTerminalContext={(selection) => {
          const composerId = target.environmentId
            ? scopedComposerThreadId(target.environmentId, effectiveThreadId)
            : effectiveThreadId;
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

/** Terminal ids grouped the way they render: split panes share a group, every other id stands alone. */
function terminalGroups(state: {
  terminalIds: string[];
  terminalGroups?: ReadonlyArray<{ terminalIds: string[] }> | undefined;
}): string[][] {
  const known = new Set(state.terminalIds);
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const group of state.terminalGroups ?? []) {
    const ids = group.terminalIds.filter((id) => known.has(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (ids.length) groups.push(ids);
  }
  for (const id of state.terminalIds) if (!seen.has(id)) groups.push([id]);
  return groups;
}
