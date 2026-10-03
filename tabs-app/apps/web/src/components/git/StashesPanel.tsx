import type { GitStashEntry } from "@tabs/contracts";
import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Card, SectionLabel } from "./gitPrimitives";

export function StashesPanel({
  stashes,
  hasChanges,
  behindCount,
  hasConflict,
  onOpenStash,
  onOpenStashPullReapply,
  onApplyStash,
  onDropStash,
}: {
  stashes: ReadonlyArray<GitStashEntry>;
  hasChanges: boolean;
  behindCount: number;
  hasConflict: boolean;
  onOpenStash: () => void;
  onOpenStashPullReapply: () => void;
  onApplyStash: (ref: string) => void | Promise<void>;
  onDropStash: (ref: string) => void | Promise<void>;
}) {
  const [actionStashMap, setActionStashMap] = useState<Record<string, "apply" | "drop">>({});
  const nothingToDo = !hasChanges && behindCount === 0;

  const handleApply = async (ref: string) => {
    setActionStashMap((prev) => ({ ...prev, [ref]: "apply" }));
    try {
      await onApplyStash(ref);
    } finally {
      setActionStashMap((prev) => {
        const next = { ...prev };
        delete next[ref];
        return next;
      });
    }
  };

  const handleDrop = async (ref: string) => {
    setActionStashMap((prev) => ({ ...prev, [ref]: "drop" }));
    try {
      await onDropStash(ref);
    } finally {
      setActionStashMap((prev) => {
        const next = { ...prev };
        delete next[ref];
        return next;
      });
    }
  };

  return (
    <div>
      <SectionLabel>Update safely</SectionLabel>
      <Card className="p-4 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed max-w-2xl">
            Set your current changes aside, pull the latest commits — from your own branch or a
            teammate's — then bring your changes back. Each step is reported as it happens. If your
            changes conflict with what came in, you'll resolve it right here.
          </p>
          {nothingToDo && (
            <div className="text-[10px] text-muted-foreground/70">
              Nothing to stash, and already up to date.
            </div>
          )}
          {hasConflict && (
            <div className="text-[10px] font-medium" style={{ color: "var(--sem-amber)" }}>
              Resolve the merge in progress before running this again.
            </div>
          )}
        </div>
        <div className="shrink-0 sm:ml-auto">
          <Button size="sm" disabled={hasConflict || nothingToDo} onClick={onOpenStashPullReapply}>
            <RefreshCw /> Stash, pull &amp; reapply
          </Button>
        </div>
      </Card>

      <SectionLabel
        action={
          <Button variant="ghost" size="sm" disabled={!hasChanges} onClick={onOpenStash}>
            Stash current changes
          </Button>
        }
      >
        Stashes
      </SectionLabel>
      {stashes.length === 0 ? (
        <div className="text-center text-[11px] text-muted-foreground/50 py-6 border border-border/50 rounded-lg">
          {hasChanges
            ? 'No manual stashes yet. Set aside what you have right now with "Stash current changes" above.'
            : "No manual stashes, and nothing to stash right now."}
        </div>
      ) : (
        <Card className="p-2">
          {stashes.map((s) => {
            const action = actionStashMap[s.stashRef];
            return (
              <div
                key={s.stashRef}
                className="flex items-center gap-3 px-2 py-2.5 border-b border-border/50 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-foreground/90">{s.message}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/70">
                    {s.stashRef} &middot; {s.createdAt}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(action)}
                  onClick={() => void handleApply(s.stashRef)}
                >
                  {action === "apply" ? <Loader2 size={12} className="animate-spin" /> : null}
                  {action === "apply" ? "Applying…" : "Apply"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(action)}
                  onClick={() => void handleDrop(s.stashRef)}
                >
                  {action === "drop" ? <Loader2 size={12} className="animate-spin" /> : null}
                  {action === "drop" ? "Dropping…" : "Drop"}
                </Button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
