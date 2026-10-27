import { useEffect, useState } from "react";
import type { ScheduledTask, ScheduledTaskUpsertInput } from "@tabs/contracts";
import { CalendarClockIcon, ChevronDownIcon, PlayIcon, PlusIcon, PencilIcon } from "lucide-react";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { newCommandId } from "../../lib/utils";
import type { WorkspaceAgentContext } from "./WorkspaceAgents";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";

export function WorkspaceAutomations({
  context,
  environmentId,
}: {
  context: WorkspaceAgentContext;
  environmentId?: string | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tasks, setTasks] = useState<readonly ScheduledTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduledTask | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"interval" | "fixed_time">("interval");
  const [minutes, setMinutes] = useState(60);
  const [time, setTime] = useState("09:00");
  useEffect(() => {
    if (!expanded) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    setError(null);
    void environmentApi(environmentId)
      .then((api) => {
        if (disposed) return;
        unsubscribe = api.scheduledTasks.subscribe(
          (value) => {
            if (disposed) return;
            setTasks(value.tasks.filter((task) => task.threadId === context.thread.id));
            setLoaded(true);
            setError(null);
          },
          (cause) => {
            if (!disposed) setError(cause.message);
          },
        );
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [expanded, environmentId, context.thread.id]);
  const perform = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  const edit = (task: ScheduledTask | null) => {
    setEditing(task);
    setTitle(task?.title ?? "");
    setPrompt(task?.prompt ?? "");
    if (task?.schedule.type === "fixed_time") {
      setKind("fixed_time");
      setTime(task.schedule.timeOfDay);
    } else {
      setKind("interval");
      setMinutes(task?.schedule.type === "interval" ? task.schedule.everyMs / 60000 : 60);
    }
  };
  const summary = (task: ScheduledTask) =>
    task.schedule.type === "interval"
      ? `Every ${task.schedule.everyMs / 60000} min`
      : task.schedule.type === "fixed_time"
        ? `At ${task.schedule.timeOfDay}${task.schedule.weekdays?.length ? " · selected days" : " daily"}`
        : "Webhook";
  return (
    <section aria-label="Thread automations" className="mt-2 border-t border-border/60 pt-2">
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-xs hover:bg-muted"
        aria-expanded={expanded}
        aria-controls={`workspace-automations-${context.thread.id}`}
        onClick={() => setExpanded(!expanded)}
      >
        <CalendarClockIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-left font-medium">Automations</span>
        {loaded && <span className="text-[11px] text-muted-foreground">{tasks.length}</span>}
        <ChevronDownIcon
          aria-hidden="true"
          className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div id={`workspace-automations-${context.thread.id}`} className="space-y-2 px-1 pt-1">
          {!loaded && !error && (
            <p role="status" className="px-1 text-[11px] text-muted-foreground">
              Loading automations…
            </p>
          )}
          {loaded && tasks.length === 0 && (
            <p className="px-1 py-1 text-[11px] text-muted-foreground">
              Schedule recurring work in this conversation.
            </p>
          )}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-border/50 p-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium" title={task.title}>
                    {task.title}
                  </span>
                  <Switch
                    aria-label={`Enable ${task.title}`}
                    checked={task.enabled}
                    disabled={busy !== null}
                    onCheckedChange={(enabled) =>
                      void perform(task.id, async () => {
                        const api = await environmentApi(environmentId);
                        await api.scheduledTasks.setEnabled({ id: task.id, enabled });
                      })
                    }
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {summary(task)} · {task.lastRunStatus}
                </p>
                {task.nextRunAt && task.enabled && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Next: {new Date(task.nextRunAt).toLocaleString()}
                  </p>
                )}
                {task.lastRunError && (
                  <p className="mt-1 line-clamp-2 text-[10px] text-destructive">
                    {task.lastRunError}
                  </p>
                )}
                <div className="mt-1 flex gap-3">
                  <button
                    type="button"
                    disabled={busy !== null || task.lastRunStatus === "running"}
                    className="flex min-h-7 items-center gap-1 text-[11px] disabled:opacity-50"
                    onClick={() =>
                      void perform(task.id, async () => {
                        const api = await environmentApi(environmentId);
                        await api.scheduledTasks.runNow({ id: task.id });
                      })
                    }
                  >
                    <PlayIcon aria-hidden="true" className="size-3" />
                    Run now
                  </button>
                  {task.schedule.type !== "webhook" && (
                    <button
                      type="button"
                      className="flex min-h-7 items-center gap-1 text-[11px]"
                      onClick={() => edit(task)}
                    >
                      <PencilIcon aria-hidden="true" className="size-3" />
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-xs hover:bg-muted"
            onClick={() => edit(null)}
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            Add automation
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit automation" : "Add automation"}</DialogTitle>
              <DialogDescription>
                Runs in this conversation using its model and permissions. This machine must be
                running Tabs. Daily times use the workspace machine’s local time zone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 px-6 pb-3">
              <label className="block text-xs">
                Name
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="block text-xs">
                Prompt
                <textarea
                  className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background p-2 text-sm"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <label className="block text-xs">
                Schedule
                <select
                  className="ml-2 rounded-lg border border-border bg-background p-2"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as "interval" | "fixed_time")}
                >
                  <option value="interval">Repeat every</option>
                  <option value="fixed_time">Daily</option>
                </select>
              </label>
              {kind === "interval" ? (
                <label className="block text-xs">
                  Minutes
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="ml-2 rounded-lg border border-border bg-background p-2"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.valueAsNumber)}
                  />
                </label>
              ) : (
                <label className="block text-xs">
                  Local time
                  <input
                    type="time"
                    className="ml-2 rounded-lg border border-border bg-background p-2"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </label>
              )}
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(undefined)}>
                Cancel
              </Button>
              <Button
                disabled={
                  !title.trim() ||
                  !prompt.trim() ||
                  busy !== null ||
                  (kind === "interval" && (!Number.isFinite(minutes) || minutes < 1)) ||
                  !time
                }
                onClick={() =>
                  void perform("save", async () => {
                    const input: ScheduledTaskUpsertInput = {
                      ...(editing ? { id: editing.id, requireExisting: true } : {}),
                      commandId: newCommandId(),
                      title: title.trim(),
                      prompt: prompt.trim(),
                      enabled: editing?.enabled ?? true,
                      schedule:
                        kind === "interval"
                          ? { type: "interval", everyMs: Math.round(minutes * 60000) }
                          : {
                              type: "fixed_time",
                              timeOfDay: time,
                              ...(editing?.schedule.type === "fixed_time" &&
                              editing.schedule.weekdays
                                ? { weekdays: editing.schedule.weekdays }
                                : {}),
                            },
                      projectId: context.thread.projectId,
                      threadId: context.thread.id,
                      workspaceStrategy:
                        editing?.workspaceStrategy ??
                        (context.thread.worktreePath
                          ? { type: "existing_worktree", worktreePath: context.thread.worktreePath }
                          : { type: "root" }),
                      modelSelection: editing?.modelSelection ?? context.thread.modelSelection,
                      runtimeMode: editing?.runtimeMode ?? context.thread.runtimeMode,
                      interactionMode: editing?.interactionMode ?? context.thread.interactionMode,
                      createdBy: "user",
                      creationSource: "web",
                    };
                    const api = await environmentApi(environmentId);
                    await api.scheduledTasks.upsert(input);
                    setEditing(undefined);
                  })
                }
              >
                {busy === "save" ? "Saving…" : "Save automation"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
