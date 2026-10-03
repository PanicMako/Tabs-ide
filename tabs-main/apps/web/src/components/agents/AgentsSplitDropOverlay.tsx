import { Columns2Icon } from "lucide-react";
import { cn } from "../../lib/utils";

export interface AgentsSplitDropOverlayProps {
  side: "left" | "right";
  isReorder?: boolean;
  threadTitle?: string | null | undefined;
}

export function AgentsSplitDropOverlay({
  side,
  isReorder = false,
  threadTitle,
}: AgentsSplitDropOverlayProps) {
  const label = isReorder
    ? side === "left"
      ? "Reorder to left"
      : "Reorder to right"
    : side === "left"
      ? "Split and place on left"
      : "Split and place on right";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-y-0 z-50 flex items-center justify-center p-4 transition-all duration-150 ease-out",
        side === "left" ? "left-0 w-1/2" : "right-0 w-1/2",
      )}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-primary/10 shadow-2xl backdrop-blur-md transition-all duration-150 dark:border-primary/50 dark:bg-primary/15 animate-in fade-in zoom-in-95">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/30 bg-background/80 text-foreground shadow-lg backdrop-blur-sm dark:bg-zinc-900/80">
          <Columns2Icon className="size-6" />
        </div>
        <div className="text-center px-4">
          <p className="text-sm font-semibold tracking-tight text-foreground">{label}</p>
          {threadTitle ? (
            <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">{threadTitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
