import { useEffect, useRef, useState } from "react";
import type {
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskUpsertInput,
  ScheduledTaskWebhookDelivery,
  ScheduledTaskWebhookDeliveryId,
  ScheduledTaskWebhookDeliverySummary,
} from "@tabs/contracts";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  PlayIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  KeyRoundIcon,
  CopyIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  ListIcon,
} from "lucide-react";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { newCommandId } from "../../lib/utils";
import type { WorkspaceAgentContext } from "./WorkspaceAgents";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useConfirm } from "../../hooks/useConfirm";
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function WorkspaceAutomations(props: {
  context: WorkspaceAgentContext;
  environmentId?: string | undefined;
  readonly?: boolean;
}) {
  return (
    <ScopedWorkspaceAutomations
      key={JSON.stringify([props.environmentId, props.context.thread.id])}
      {...props}
    />
  );
}

function ScopedWorkspaceAutomations({
  context,
  environmentId,
  readonly = false,
}: {
  context: WorkspaceAgentContext;
  environmentId?: string | undefined;
  readonly?: boolean;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [tasks, setTasks] = useState<readonly ScheduledTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Edit / Add state
  const [editing, setEditing] = useState<ScheduledTask | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"interval" | "fixed_time" | "webhook">("interval");
  const [minutes, setMinutes] = useState(60);
  const [time, setTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());

  // Webhook edit fields
  const [signatureEnabled, setSignatureEnabled] = useState(false);
  const [signatureHeader, setSignatureHeader] = useState("x-hub-signature-256");
  const [signaturePrefix, setSignaturePrefix] = useState("");
  const [signatureEncoding, setSignatureEncoding] = useState<"hex" | "base64">("hex");
  const [signatureSecret, setSignatureSecret] = useState("");
  const [maxDeliveryAgeMinutes, setMaxDeliveryAgeMinutes] = useState<number | "">("");

  // Webhook inspection & credential display state
  const [revealedTaskId, setRevealedTaskId] = useState<string | null>(null);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [inspectingTaskId, setInspectingTaskId] = useState<ScheduledTaskId | null>(null);
  const [deliveries, setDeliveries] = useState<readonly ScheduledTaskWebhookDeliverySummary[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<ScheduledTaskWebhookDelivery | null>(
    null,
  );
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const deliveryRequest = useRef(0);
  const detailRequest = useRef(0);
  useEffect(
    () => () => {
      deliveryRequest.current++;
      detailRequest.current++;
    },
    [],
  );

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

  const openEditor = (task: ScheduledTask | null) => {
    setEditing(task);
    setTitle(task?.title ?? "");
    setPrompt(task?.prompt ?? "");
    setError(null);
    setSignatureEnabled(false);
    setSignatureHeader("x-hub-signature-256");
    setSignaturePrefix("");
    setSignatureEncoding("hex");
    setSignatureSecret("");
    setMaxDeliveryAgeMinutes("");
    setWeekdays(new Set());
    setTime("09:00");

    if (task?.schedule.type === "fixed_time") {
      setKind("fixed_time");
      setTime(task.schedule.timeOfDay);
      setWeekdays(new Set(task.schedule.weekdays ?? []));
    } else if (task?.schedule.type === "webhook") {
      setKind("webhook");
      setSignatureEnabled(Boolean(task.schedule.signature));
      setSignatureHeader(task.schedule.signature?.header ?? "x-hub-signature-256");
      setSignaturePrefix(task.schedule.signature?.prefix ?? "");
      setSignatureEncoding(task.schedule.signature?.encoding ?? "hex");
      setSignatureSecret("");
      setMaxDeliveryAgeMinutes(task.schedule.maxDeliveryAgeMinutes ?? "");
    } else {
      setKind("interval");
      setMinutes(task?.schedule.type === "interval" ? task.schedule.everyMs / 60000 : 60);
    }
  };

  const handleDelete = async (task: ScheduledTask) => {
    if (readonly) return;
    const ok = await confirm(`Delete automation "${task.title}"? This cannot be undone.`);
    if (!ok) return;
    await perform(`delete-${task.id}`, async () => {
      const api = await environmentApi(environmentId);
      await api.scheduledTasks.delete({ id: task.id });
    });
  };

  const handleRotateWebhookToken = async (task: ScheduledTask) => {
    if (readonly) return;
    const ok = await confirm(
      `Rotate webhook token for "${task.title}"? The previous URL will immediately stop receiving triggers.`,
    );
    if (!ok) return;
    await perform(`rotate-${task.id}`, async () => {
      const api = await environmentApi(environmentId);
      await api.scheduledTasks.rotateWebhookToken({ id: task.id });
    });
  };

  const handleCopyWebhookUrl = async (task: ScheduledTask) => {
    const url = task.webhook?.url ?? task.webhook?.path ?? "";
    if (!url) return;
    await perform(`copy-${task.id}`, async () => {
      await navigator.clipboard.writeText(url);
      setCopiedTaskId(task.id);
    });
  };

  const handleOpenDeliveries = async (task: ScheduledTask) => {
    const request = ++deliveryRequest.current;
    detailRequest.current++;
    setDeliveries([]);
    setInspectingTaskId(task.id);
    setSelectedDelivery(null);
    setDeliveriesLoading(true);
    try {
      const api = await environmentApi(environmentId);
      const res = await api.scheduledTasks.listWebhookDeliveries({ id: task.id });
      if (request === deliveryRequest.current) setDeliveries(res.deliveries);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === deliveryRequest.current) setDeliveriesLoading(false);
    }
  };

  const handleViewDeliveryDetail = async (deliveryId: ScheduledTaskWebhookDeliveryId) => {
    if (!inspectingTaskId) return;
    const request = ++detailRequest.current;
    try {
      const api = await environmentApi(environmentId);
      const res = await api.scheduledTasks.getWebhookDelivery({
        id: inspectingTaskId,
        deliveryId,
      });
      if (request === detailRequest.current) setSelectedDelivery(res.delivery);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleWeekday = (day: number) => {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  };

  const summary = (task: ScheduledTask) => {
    if (task.schedule.type === "interval") {
      return `Every ${task.schedule.everyMs / 60000} min`;
    }
    if (task.schedule.type === "fixed_time") {
      const days = task.schedule.weekdays;
      const daysStr =
        days && days.length > 0 && days.length < 7
          ? ` · ${days.map((d) => WEEKDAY_SHORT[d]).join(", ")}`
          : " · daily";
      return `At ${task.schedule.timeOfDay}${daysStr}`;
    }
    return "Webhook";
  };

  const isIntervalValid = kind !== "interval" || (Number.isFinite(minutes) && minutes >= 1);
  const isWebhookValid =
    kind !== "webhook" ||
    ((maxDeliveryAgeMinutes === "" ||
      (Number.isInteger(maxDeliveryAgeMinutes) &&
        maxDeliveryAgeMinutes >= 1 &&
        maxDeliveryAgeMinutes <= 1440)) &&
      (!signatureEnabled ||
        (signatureHeader.trim().length > 0 &&
          (signatureSecret.trim().length > 0 ||
            (editing?.schedule.type === "webhook" && editing.webhook?.hasSecret)))));
  const isTimeValid = kind !== "fixed_time" || Boolean(time);

  return (
    <>
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
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {tasks.map((task) => {
                const isWebhook = task.schedule.type === "webhook";
                const isRevealed = revealedTaskId === task.id;
                const webhookUrl = task.webhook?.url ?? task.webhook?.path ?? "";

                return (
                  <div key={task.id} className="rounded-lg border border-border/50 p-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="min-w-0 flex-1 truncate text-xs font-medium"
                        title={task.title}
                      >
                        {task.title}
                      </span>
                      <Switch
                        aria-label={`Enable ${task.title}`}
                        checked={task.enabled}
                        disabled={readonly || busy !== null}
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

                    {/* Webhook endpoint controls */}
                    {isWebhook && task.webhook && (
                      <div className="mt-2 rounded border border-border/40 bg-muted/30 p-1.5 text-[10px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {isRevealed ? webhookUrl : "••••••••••••••••••••••••••••••••"}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="rounded p-1 hover:bg-muted"
                              title={isRevealed ? "Hide webhook URL" : "Reveal webhook URL"}
                              aria-label={isRevealed ? "Hide URL" : "Reveal URL"}
                              onClick={() => setRevealedTaskId(isRevealed ? null : task.id)}
                            >
                              {isRevealed ? (
                                <EyeOffIcon className="size-3" />
                              ) : (
                                <EyeIcon className="size-3" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 hover:bg-muted"
                              title="Copy webhook URL"
                              aria-label="Copy webhook URL"
                              onClick={() => void handleCopyWebhookUrl(task)}
                            >
                              {copiedTaskId === task.id ? (
                                <CheckIcon className="size-3 text-emerald-500" />
                              ) : (
                                <CopyIcon className="size-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {!isWebhook && (
                        <button
                          type="button"
                          disabled={readonly || busy !== null || task.lastRunStatus === "running"}
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
                      )}

                      {!readonly && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="flex min-h-7 items-center gap-1 text-[11px] disabled:opacity-50"
                          onClick={() => openEditor(task)}
                        >
                          <PencilIcon aria-hidden="true" className="size-3" />
                          Edit
                        </button>
                      )}

                      {isWebhook && !readonly && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="flex min-h-7 items-center gap-1 text-[11px] disabled:opacity-50"
                          onClick={() => void handleRotateWebhookToken(task)}
                        >
                          <KeyRoundIcon aria-hidden="true" className="size-3" />
                          Rotate token
                        </button>
                      )}

                      {isWebhook && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="flex min-h-7 items-center gap-1 text-[11px] disabled:opacity-50"
                          onClick={() => void handleOpenDeliveries(task)}
                        >
                          <ListIcon aria-hidden="true" className="size-3" />
                          Deliveries
                        </button>
                      )}

                      {!readonly && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="flex min-h-7 items-center gap-1 text-[11px] text-destructive disabled:opacity-50"
                          onClick={() => void handleDelete(task)}
                        >
                          <Trash2Icon aria-hidden="true" className="size-3" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!readonly && (
              <button
                type="button"
                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-xs hover:bg-muted"
                onClick={() => openEditor(null)}
              >
                <PlusIcon aria-hidden="true" className="size-3.5" />
                Add automation
              </button>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="px-2 py-1 text-[11px] text-destructive">
            {error}
          </p>
        )}

        {/* Add / Edit automation dialog */}
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
                <label className="block text-xs font-medium">
                  Name
                  <input
                    aria-label="Name"
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="block text-xs font-medium">
                  Prompt
                  <textarea
                    aria-label="Prompt"
                    className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background p-2 text-sm"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </label>

                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium">Schedule</label>
                  <select
                    aria-label="Schedule type"
                    className="rounded-lg border border-border bg-background p-2 text-xs"
                    value={kind}
                    onChange={(e) =>
                      setKind(e.target.value as "interval" | "fixed_time" | "webhook")
                    }
                  >
                    <option value="interval">Repeat every</option>
                    <option value="fixed_time">Daily / Selected days</option>
                    <option value="webhook">Webhook trigger</option>
                  </select>
                </div>

                {kind === "interval" && (
                  <div>
                    <label className="block text-xs font-medium">
                      Minutes (minimum 1)
                      <input
                        type="number"
                        min={1}
                        step={1}
                        aria-label="Minutes"
                        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm"
                        value={minutes}
                        onChange={(e) => setMinutes(e.target.valueAsNumber)}
                      />
                    </label>
                    {minutes < 1 && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        Interval must be at least 1 minute.
                      </p>
                    )}
                  </div>
                )}

                {kind === "fixed_time" && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium">
                      Local time
                      <input
                        type="time"
                        aria-label="Time"
                        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    </label>

                    <div>
                      <span className="block text-xs font-medium mb-1">
                        Days of week (all unselected = daily)
                      </span>
                      <div className="flex gap-1">
                        {WEEKDAY_SHORT.map((dayName, idx) => {
                          const active = weekdays.has(idx);
                          return (
                            <button
                              key={dayName}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleWeekday(idx)}
                              className={`rounded px-2 py-1 text-xs border transition-colors ${
                                active
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                              }`}
                            >
                              {dayName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {kind === "webhook" && (
                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Require HMAC-SHA256 signature</span>
                      <Switch
                        aria-label="Require signature"
                        checked={signatureEnabled}
                        onCheckedChange={setSignatureEnabled}
                      />
                    </div>

                    {signatureEnabled && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs">
                          Header
                          <input
                            aria-label="Signature header"
                            className="mt-1 w-full rounded border border-border bg-background p-1.5 text-xs"
                            value={signatureHeader}
                            onChange={(e) => setSignatureHeader(e.target.value)}
                          />
                        </label>
                        <label className="block text-xs">
                          Prefix
                          <input
                            aria-label="Signature prefix"
                            placeholder="e.g. sha256="
                            className="mt-1 w-full rounded border border-border bg-background p-1.5 text-xs"
                            value={signaturePrefix}
                            onChange={(e) => setSignaturePrefix(e.target.value)}
                          />
                        </label>
                        <label className="block text-xs">
                          Encoding
                          <select
                            aria-label="Signature encoding"
                            className="mt-1 w-full rounded border border-border bg-background p-1.5 text-xs"
                            value={signatureEncoding}
                            onChange={(e) =>
                              setSignatureEncoding(e.target.value as "hex" | "base64")
                            }
                          >
                            <option value="hex">hex</option>
                            <option value="base64">base64</option>
                          </select>
                        </label>
                        <label className="block text-xs">
                          Secret
                          <input
                            type="password"
                            autoComplete="off"
                            aria-label="Signature secret"
                            placeholder={
                              editing?.schedule.type === "webhook" && editing.webhook?.hasSecret
                                ? "Leave empty to keep unchanged"
                                : "Shared signing secret"
                            }
                            className="mt-1 w-full rounded border border-border bg-background p-1.5 text-xs"
                            value={signatureSecret}
                            onChange={(e) => setSignatureSecret(e.target.value)}
                          />
                        </label>
                      </div>
                    )}

                    <label className="block text-xs">
                      Max delivery age (minutes, optional)
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        aria-label="Max delivery age"
                        placeholder="Default: accepts all held requests"
                        className="mt-1 w-full rounded border border-border bg-background p-1.5 text-xs"
                        value={maxDeliveryAgeMinutes}
                        onChange={(e) =>
                          setMaxDeliveryAgeMinutes(
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                      />
                    </label>
                  </div>
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
                    readonly ||
                    !title.trim() ||
                    !prompt.trim() ||
                    busy !== null ||
                    !isIntervalValid ||
                    !isTimeValid ||
                    !isWebhookValid
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
                            ? {
                                type: "interval",
                                everyMs: Math.max(60000, Math.round(minutes * 60000)),
                              }
                            : kind === "fixed_time"
                              ? {
                                  type: "fixed_time",
                                  timeOfDay: time,
                                  ...(weekdays.size > 0 && weekdays.size < 7
                                    ? { weekdays: Array.from(weekdays).sort() }
                                    : {}),
                                }
                              : {
                                  type: "webhook",
                                  signature: signatureEnabled
                                    ? {
                                        header: signatureHeader.trim() || "x-hub-signature-256",
                                        encoding: signatureEncoding,
                                        prefix: signaturePrefix,
                                        ...(signatureSecret.trim()
                                          ? { secret: signatureSecret.trim() }
                                          : {}),
                                      }
                                    : null,
                                  ...(typeof maxDeliveryAgeMinutes === "number" &&
                                  maxDeliveryAgeMinutes > 0
                                    ? { maxDeliveryAgeMinutes }
                                    : {}),
                                },
                        projectId: context.thread.projectId,
                        threadId: context.thread.id,
                        workspaceStrategy:
                          editing?.workspaceStrategy ??
                          (context.thread.worktreePath
                            ? {
                                type: "existing_worktree",
                                worktreePath: context.thread.worktreePath,
                              }
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

        {/* Deliveries inspection dialog */}
        <Dialog
          open={inspectingTaskId !== null}
          onOpenChange={(open) => {
            if (!open) {
              deliveryRequest.current++;
              detailRequest.current++;
              setInspectingTaskId(null);
              setSelectedDelivery(null);
            }
          }}
        >
          <DialogPopup>
            <DialogPanel>
              <DialogHeader>
                <DialogTitle>Webhook deliveries</DialogTitle>
                <DialogDescription>
                  Inspect recent HTTP deliveries received by this webhook.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-96 space-y-3 overflow-y-auto px-6 py-2">
                {deliveriesLoading && (
                  <p className="text-xs text-muted-foreground">Loading deliveries…</p>
                )}
                {!deliveriesLoading && deliveries.length === 0 && (
                  <p className="text-xs text-muted-foreground">No deliveries recorded yet.</p>
                )}
                <div className="space-y-1.5">
                  {deliveries.map((d) => (
                    <button
                      type="button"
                      key={d.id}
                      className="w-full rounded border border-border/50 p-2 text-left text-xs hover:bg-muted"
                      onClick={() => void handleViewDeliveryDetail(d.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{d.method}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            d.outcome === "accepted"
                              ? "bg-emerald-500/10 text-emerald-500"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {d.outcome}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(d.receivedAt).toLocaleString()} · {d.bodyBytes} bytes
                        {d.signatureVerified ? " · Verified" : ""}
                      </p>
                      {d.error && <p className="text-[10px] text-destructive">{d.error}</p>}
                    </button>
                  ))}
                </div>

                {selectedDelivery && (
                  <div className="mt-3 rounded border border-border bg-muted/40 p-3 text-xs space-y-2">
                    <div className="font-semibold">Delivery detail: {selectedDelivery.id}</div>
                    <div>
                      <span className="text-muted-foreground">Query: </span>
                      <code>{selectedDelivery.query || "none"}</code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Body: </span>
                      <pre className="max-h-32 overflow-x-auto whitespace-pre-wrap rounded bg-background p-1.5 text-[11px]">
                        {selectedDelivery.body || "<empty>"}
                      </pre>
                    </div>
                    {selectedDelivery.renderedPrompt && (
                      <div>
                        <span className="text-muted-foreground">Rendered prompt: </span>
                        <pre className="max-h-32 overflow-x-auto whitespace-pre-wrap rounded bg-background p-1.5 text-[11px]">
                          {selectedDelivery.renderedPrompt}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInspectingTaskId(null)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      </section>
      {confirmDialog}
    </>
  );
}
