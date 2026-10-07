import { memo, useCallback, useState } from "react";
import type { ThreadId } from "@tabs/contracts";
import { TerminalSquare } from "lucide-react";
import { useThreadTerminalState, terminalActions } from "~/state/terminal";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useComposerDraftStore } from "~/composerDraftStore";
import { scopedComposerThreadId } from "~/state/composerDrafts";
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
      if (!effectiveThreadId) return;
      terminalActions.close(effectiveThreadId, terminalId);
    },
    [effectiveThreadId],
  );

  const handleKill = useCallback(
    (terminalId: string) => {
      if (!effectiveThreadId) return;
      // Close and immediately open a fresh terminal at the same ID.
      // This is a "reset": terminate the current process, start fresh.
      terminalActions.close(effectiveThreadId, terminalId);
      const newId = createTerminalId();
      terminalActions.new(effectiveThreadId, newId);
      setFocusRequestId((n) => n + 1);
    },
    [effectiveThreadId],
  );

  if (!effectiveThreadId || !target || !terminalState) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-muted-foreground">
        <TerminalSquare className="mb-2 size-8 opacity-40" />
        <p className="text-xs font-medium">No active terminal session</p>
        <p className="text-[11px] text-muted-foreground/80 mt-1">
          Open a thread or project to launch a companion terminal.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
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
