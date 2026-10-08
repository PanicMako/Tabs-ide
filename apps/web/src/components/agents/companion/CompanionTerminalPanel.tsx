import { memo, useCallback, useState } from "react";
import type { ThreadId } from "@tabs/contracts";
import { CompanionHeading, CompanionEmpty } from "./CompanionChrome";
import { useThreadTerminalState, terminalActions } from "~/state/terminal";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useComposerDraftStore } from "~/composerDraftStore";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { toastManager } from "~/components/ui/toast";
import ThreadTerminalDrawer from "~/components/ThreadTerminalDrawer";

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

  return (
    <div className="companion-workspace">
      <CompanionHeading kind="terminal" detail={target.cwd} />
      <ThreadTerminalDrawer
        threadId={effectiveThreadId}
        cwd={target.cwd}
        variant="embedded"
        height={400}
        showControls={true}
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
