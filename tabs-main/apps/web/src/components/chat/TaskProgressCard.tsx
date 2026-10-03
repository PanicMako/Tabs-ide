import { memo, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, ListChecksIcon, LoaderIcon, XIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import type { TaskNode } from "../../session-logic";
import { AnimatedHeight } from "../AnimatedHeight";

// ---------------------------------------------------------------------------
// Self-ticking elapsed timer (direct DOM mutation — no React re-renders)
// ---------------------------------------------------------------------------

function formatElapsed(startIso: string): string {
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(startIso)) / 1000));
  if (elapsed < 60) return `${elapsed}s`;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const TaskElapsed = memo(function TaskElapsed({ startedAt }: { startedAt: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.textContent = formatElapsed(startedAt);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <span
      ref={ref}
      className="tabular-nums text-[10px] font-sans text-muted-foreground/40 shrink-0"
    >
      {formatElapsed(startedAt)}
    </span>
  );
});

// ---------------------------------------------------------------------------
// Single task row — prototype style
// ---------------------------------------------------------------------------

const TaskRow = memo(function TaskRow({ task }: { task: TaskNode }) {
  const isRunning = task.status === "running";
  const isFailed = task.status === "failed";
  const isStopped = task.status === "stopped";
  const isDone = task.status === "completed";

  const description = task.description;

  return (
    <div className="flex items-center gap-3 py-1">
      {/* Status icon */}
      <span className="shrink-0 flex size-4 items-center justify-center">
        {isRunning ? (
          <LoaderIcon className="size-3 animate-spin text-foreground/70" />
        ) : isFailed || isStopped ? (
          <XIcon
            className={cn(
              "size-3",
              isFailed ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
            )}
          />
        ) : isDone ? (
          <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
        ) : (
          /* pending — empty circle */
          <svg viewBox="0 0 14 14" fill="none" className="size-3">
            <circle
              cx="7"
              cy="7"
              r="5.5"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="1.25"
              strokeDasharray="2 2"
            />
          </svg>
        )}
      </span>

      {/* Task name */}
      <span
        className={cn(
          "flex-1 min-w-0 truncate text-sm font-sans",
          isDone
            ? "text-muted-foreground/40"
            : isFailed || isStopped
              ? "text-red-600/90 dark:text-red-400/80"
              : "text-foreground/80",
        )}
        title={description}
      >
        {description}
      </span>

      {/* Type label */}
      {task.taskType && (
        <span className="text-[10px] font-sans uppercase tracking-wider text-muted-foreground/25 shrink-0">
          {task.taskType}
        </span>
      )}

      {/* Timer */}
      {isRunning && <TaskElapsed startedAt={task.startedAt} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// TaskProgressCard — collapsible, prototype-style
// ---------------------------------------------------------------------------

export const TaskProgressCard = memo(function TaskProgressCard({
  tasks,
}: {
  tasks: ReadonlyArray<TaskNode>;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  if (tasks.length === 0) return null;

  const completedCount = tasks.filter(
    (t) => t.status === "completed" || t.status === "failed" || t.status === "stopped",
  ).length;
  const failedCount = tasks.filter((t) => t.status === "failed" || t.status === "stopped").length;
  const runningCount = tasks.filter((t) => t.status === "running").length;
  const totalCount = tasks.length;
  const allSettled = completedCount === totalCount;

  const headerLabel = allSettled
    ? `${completedCount} of ${totalCount} task${totalCount === 1 ? "" : "s"} completed`
    : `Tasks (${completedCount}/${totalCount})`;

  return (
    <div className="w-full rounded-xl border border-border/50 bg-card/60 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/20"
      >
        <div className="flex items-center gap-2">
          <ListChecksIcon className="size-3.5 text-muted-foreground/50 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground/60">
            {headerLabel}
          </span>
          {failedCount > 0 && (
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-red-600 dark:text-red-400">
              · {failedCount} failed
            </span>
          )}
          {runningCount > 0 && (
            <span className="inline-flex items-center gap-[3px] ml-1">
              <span className="h-1 w-1 rounded-full bg-primary/60 animate-pulse" />
              <span className="h-1 w-1 rounded-full bg-primary/60 animate-pulse [animation-delay:200ms]" />
              <span className="h-1 w-1 rounded-full bg-primary/60 animate-pulse [animation-delay:400ms]" />
            </span>
          )}
        </div>
        <ChevronDownIcon
          className={cn(
            "size-3.5 text-muted-foreground/40 transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Task rows */}
      <AnimatedHeight>
        {expanded && (
          <div id={contentId} className="flex flex-col gap-0 px-4 pb-3">
            {tasks.map((task) => (
              <TaskRow key={task.taskId} task={task} />
            ))}
          </div>
        )}
      </AnimatedHeight>
    </div>
  );
});
