import {
  groupOvermindTasks,
  listOvermindTasks,
  summarizeOvermindSubagents,
  type OvermindTaskRow,
} from "@tabs/shared/overmind";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import type { ServerProvider } from "@tabs/contracts";
import { SUBAGENT_ROLE_LABELS, SubagentTeamCard, type TeamModel } from "./OvermindWorkerPicker";
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
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly onStart: (goal: string) => Promise<void>;
  /** This thread's model, which leads the plan. */
  readonly lead?: TeamModel | null | undefined;
}

/**
 * The lead thread's Overmind plan: one row per sub-thread with its live
 * status, and the action that hands the lead a goal to plan and fan out.
 */
export function OvermindSection(props: OvermindSectionProps) {
  const goalInputId = useId();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = listOvermindTasks(props.subagents);
  const groups = groupOvermindTasks(tasks);
  const summary = summarizeOvermindSubagents(props.subagents);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await props.onStart(goal);
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
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <div className="min-w-0">
          <p className="text-xs font-medium">Overmind</p>
          {summary === null && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Splits a big goal into parallel threads — research, design, build, test — and merges
              the result. Each task shows up in the sidebar.
            </p>
          )}
          {summary !== null && (
            <p className="truncate text-[11px] tabular-nums text-muted-foreground" role="status">
              {summary.done} of {summary.total} done
              {summary.active > 0 ? ` · ${summary.active} running` : ""}
              {summary.attention > 0 ? ` · ${summary.attention} need attention` : ""}
              {summary.failed > 0 ? ` · ${summary.failed} failed` : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          disabled={props.disabled}
          title={props.disabledReason ?? "Plan a big goal and run it as parallel sub-threads"}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {tasks.length > 0 ? "New plan" : "Start"}
        </button>
      </div>

      {groups.map((group) => (
        <section
          key={group.role ?? "other"}
          aria-label={`${group.role ? SUBAGENT_ROLE_LABELS[group.role] : "Other"} tasks`}
          className="pt-1"
        >
          {/* A plan from before task types has nothing to group by. */}
          {(group.role !== null || groups.length > 1) && (
            <div className="flex items-baseline justify-between gap-2 px-2 pb-0.5 text-[11px] text-muted-foreground">
              <span className="font-medium">
                {group.role ? SUBAGENT_ROLE_LABELS[group.role] : "Other"}
              </span>
              <span className="tabular-nums">
                {group.done} of {group.tasks.length}
              </span>
            </div>
          )}
          <ul>
            {group.tasks.map((task) => (
              <OvermindTaskItem
                key={task.subagentId}
                task={task}
                onOpenThread={props.onOpenThread}
                onStop={props.onStop}
              />
            ))}
          </ul>
        </section>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Overmind</DialogTitle>
              <DialogDescription>
                This thread leads: it splits the goal into tasks, runs each as its own thread in
                parallel, then merges, checks and reports back.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 px-6 pt-2">
              <label className="sr-only" htmlFor={goalInputId}>
                Goal
              </label>
              <textarea
                id={goalInputId}
                className="min-h-28 w-full resize-none rounded-[var(--radius-control)] border border-border/60 bg-background/40 p-3 text-sm placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="What should Overmind get done?"
              />
              <SubagentTeamCard providers={props.providers} lead={props.lead ?? null} />
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
                {starting ? "Starting…" : "Plan with Overmind"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

/** First line of a result, for the collapsed row. */
function resultPreview(result: string): string {
  return result.trim().split("\n", 1)[0] ?? "";
}

function OvermindTaskItem(props: {
  readonly task: OvermindTaskRow;
  readonly onOpenThread: (threadId: string) => void;
  readonly onStop: (subagentId: string, childThreadId: string) => void;
}) {
  const { task } = props;
  const [expanded, setExpanded] = useState(false);
  const failed = FAILED_STATUSES.has(task.status);
  const active = ACTIVE_STATUSES.has(task.status);
  const result = task.result?.trim() ?? "";
  return (
    <li className="border-b border-border/40 px-2 py-1.5 text-xs last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={task.title}>
          {task.title}
        </span>
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
      {result !== "" && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide result" : "Show result"}
          className="mt-0.5 block w-full min-w-0 text-left text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <span className="block whitespace-pre-wrap break-words">{result}</span>
          ) : (
            <span className="block truncate">{resultPreview(result)}</span>
          )}
        </button>
      )}
      <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="font-mono text-[10px]">{task.taskKey}</span>
        {task.childThreadId !== null && (
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => props.onOpenThread(task.childThreadId!)}
          >
            Open
          </button>
        )}
        {active && task.childThreadId !== null && (
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => props.onStop(task.subagentId, task.childThreadId!)}
          >
            Stop
          </button>
        )}
      </div>
    </li>
  );
}
