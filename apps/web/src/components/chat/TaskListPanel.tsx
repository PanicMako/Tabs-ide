import { memo, useState } from "react";
import { CheckIcon, LoaderIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import type { TaskNode } from "../../session-logic";

// ─────────────────────────────────────────────────────────────────────────────
// TaskListPanel — "2 out of 4 tasks completed" floating card above the composer
// Matches the UI in the design reference: numbered list, strikethrough for
// completed items, circle bullets for pending, collapsible header.
// ─────────────────────────────────────────────────────────────────────────────

function CollapseIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-3.5">
      {expanded ? (
        // chevron-up
        <path
          d="M4 10L8 6L12 10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        // chevron-down
        <path
          d="M4 6L8 10L12 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

interface TaskListPanelProps {
  tasks: ReadonlyArray<TaskNode>;
  /** When true the panel renders; when false it should not be mounted at all */
}

export const TaskListPanel = memo(function TaskListPanel({ tasks }: TaskListPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (tasks.length === 0) return null;

  const completedCount = tasks.filter(
    (t) => t.status === "completed" || t.status === "failed" || t.status === "stopped",
  ).length;
  const totalCount = tasks.length;
  const allDone = completedCount === totalCount;

  const headerLabel = allDone
    ? `All ${totalCount} task${totalCount === 1 ? "" : "s"} completed`
    : `${completedCount} out of ${totalCount} task${totalCount === 1 ? "" : "s"} completed`;

  return (
    <div
      className={cn(
        "mx-auto mb-2 w-full min-w-0 max-w-3xl overflow-hidden rounded-2xl border border-border/40 bg-card/70 shadow-sm backdrop-blur-sm",
        "transition-all duration-200",
      )}
    >
      {/* ── Header ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-muted/20"
      >
        <div className="flex items-center gap-2.5">
          {/* Drag handle dots */}
          <span className="flex items-center gap-[3px] opacity-35">
            <span className="flex flex-col gap-[3px]">
              <span className="h-[3px] w-[3px] rounded-full bg-foreground" />
              <span className="h-[3px] w-[3px] rounded-full bg-foreground" />
            </span>
            <span className="flex flex-col gap-[3px]">
              <span className="h-[3px] w-[3px] rounded-full bg-foreground" />
              <span className="h-[3px] w-[3px] rounded-full bg-foreground" />
            </span>
          </span>
          <span className="text-[12px] font-medium text-foreground/80">{headerLabel}</span>
        </div>
        <span className="text-muted-foreground/60 transition-transform duration-200">
          <CollapseIcon expanded={expanded} />
        </span>
      </button>

      {/* ── Task list ── */}
      {expanded && (
        <div className="px-4 pb-3 pt-0">
          <ol className="space-y-1.5">
            {tasks.map((task, index) => {
              const isDone =
                task.status === "completed" ||
                task.status === "failed" ||
                task.status === "stopped";
              const isRunning = task.status === "running";
              const label = task.latestDetail ?? task.lastToolName ?? task.description;

              return (
                <li key={task.taskId} className="flex items-start gap-2.5">
                  {/* Number / bullet */}
                  <span
                    className={cn(
                      "mt-[1px] shrink-0 font-mono text-[11px] tabular-nums",
                      isDone
                        ? "text-muted-foreground/50"
                        : isRunning
                          ? "text-foreground/70"
                          : "text-foreground/30",
                    )}
                  >
                    {isDone ? (
                      <CheckIcon className="mt-0.5 size-3.5" />
                    ) : isRunning ? (
                      <LoaderIcon className="mt-0.5 size-3.5 animate-spin" />
                    ) : (
                      // Circle outline for pending
                      <svg viewBox="0 0 14 14" fill="none" className="mt-0.5 size-3.5">
                        <circle
                          cx="7"
                          cy="7"
                          r="5.5"
                          stroke="currentColor"
                          strokeWidth="1.25"
                          strokeDasharray="2 2"
                        />
                      </svg>
                    )}
                  </span>

                  {/* Task text */}
                  <span
                    className={cn(
                      "text-[12px] leading-[1.5]",
                      isDone ? "text-muted-foreground/50" : "text-foreground/80",
                    )}
                  >
                    {`${index + 1}. `}
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
});
