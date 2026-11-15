import {
  listOvermindTasks,
  summarizeOvermindSubagents,
  type OvermindWorkerChoice,
} from "@tabs/shared/overmind";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import { OvermindWorkerPicker, type OvermindProviderOption } from "./OvermindWorkerPicker";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

const ACTIVE_STATUSES = new Set(["pending", "running", "waiting", "starting", "queued"]);
const FAILED_STATUSES = new Set(["failed", "interrupted", "cancelled"]);

/** Plain words for the delegated-task status the sub-thread row already carries. */
function statusLabel(status: string): string {
  switch (status) {
    case "running":
    case "starting":
      return "Working";
    case "waiting":
      return "Needs attention";
    case "idle":
      return "Idle";
    case "pending":
    case "queued":
      return "Queued";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "interrupted":
      return "Stopped";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export interface OvermindSectionProps {
  readonly subagents: ReadonlyArray<{
    readonly id: string;
    readonly title?: string | null;
    readonly status: string;
    readonly childThreadId?: string | null;
    readonly result?: string | null;
  }>;
  readonly rowClassName: string;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly onOpenThread: (threadId: string) => void;
  readonly onStop: (subagentId: string, childThreadId: string) => void;
  /** Providers a sub-agent may run on; the picker is hidden when empty. */
  readonly providers?: ReadonlyArray<OvermindProviderOption>;
  readonly onStart: (goal: string, workers: OvermindWorkerChoice | null) => Promise<void>;
}

/**
 * The lead thread's Overmind plan: one row per sub-thread with its live
 * status, and the action that hands the lead a goal to plan and fan out.
 */
export function OvermindSection(props: OvermindSectionProps) {
  const goalInputId = useId();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [workers, setWorkers] = useState<OvermindWorkerChoice | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = listOvermindTasks(props.subagents);
  const summary = summarizeOvermindSubagents(props.subagents);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await props.onStart(goal, workers);
      setGoal("");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div aria-label="Overmind" className="space-y-1">
      <button
        type="button"
        className={props.rowClassName}
        disabled={props.disabled}
        title={props.disabledReason ?? "Plan a big goal and run it as parallel sub-threads"}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Run with Overmind
      </button>

      {summary !== null && (
        <p className="px-2 text-[11px] tabular-nums text-muted-foreground" role="status">
          Overmind: {summary.done} of {summary.total} done
          {summary.active > 0 ? ` · ${summary.active} running` : ""}
          {summary.attention > 0 ? ` · ${summary.attention} need attention` : ""}
          {summary.failed > 0 ? ` · ${summary.failed} failed` : ""}
        </p>
      )}

      {tasks.length > 0 && (
        <details
          className="group/tasks space-y-1"
          open={summary !== null && summary.attention + summary.failed > 0 ? true : undefined}
        >
          <summary className="cursor-pointer px-2 text-[11px] text-muted-foreground hover:text-foreground">
            {tasks.length} sub-{tasks.length === 1 ? "thread" : "threads"} · shown nested under this
            thread in the sidebar
          </summary>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {tasks.map((task) => {
              const failed = FAILED_STATUSES.has(task.status);
              const active = ACTIVE_STATUSES.has(task.status);
              return (
                <li
                  key={task.subagentId}
                  className="rounded-lg border border-border/50 px-2 py-1.5 text-xs"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {task.taskKey}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                    <span
                      className={
                        failed || task.status === "waiting"
                          ? "shrink-0 text-[10px] font-medium text-destructive"
                          : "shrink-0 text-[10px] text-muted-foreground"
                      }
                    >
                      {statusLabel(task.status)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    {task.childThreadId !== null && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => props.onOpenThread(task.childThreadId!)}
                      >
                        Open
                      </button>
                    )}
                    {active && task.childThreadId !== null && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => props.onStop(task.subagentId, task.childThreadId!)}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                  {task.result !== null && task.result !== "" && (
                    <details className="mt-1 text-[11px] text-muted-foreground">
                      <summary>Result</summary>
                      <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
                        {task.result}
                      </p>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Run with Overmind</DialogTitle>
              <DialogDescription>
                This thread plans the goal, splits it into tasks, and runs them in parallel
                sub-threads. Each one works in its own git worktree and is merged back when it
                finishes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 px-6 pt-2">
              <label className="block text-xs font-medium" htmlFor={goalInputId}>
                Goal
              </label>
              <textarea
                id={goalInputId}
                className="min-h-28 w-full rounded-xl border border-border bg-background p-3 text-sm focus:border-primary focus:outline-none"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Describe the large piece of work…"
              />
              <OvermindWorkerPicker
                providers={props.providers ?? []}
                value={workers}
                onChange={setWorkers}
              />
              {error !== null && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={starting || goal.trim() === ""} onClick={() => void start()}>
                {starting ? "Starting…" : "Start"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
