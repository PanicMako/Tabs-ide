import { WorkspaceAutomations } from "./WorkspaceAutomations";
import {
  ThreadId,
  isProviderNativeSubagentThread,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
} from "@tabs/contracts";
import { useState, useId } from "react";
import {
  BotIcon,
  ChevronDownIcon,
  GitForkIcon,
  CornerLeftUpIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { newCommandId } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";

export type WorkspaceAgentContext = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "subagents"
>;

/** Consumes the parent conversation's existing stream. No second subscription or polling. */
export function WorkspaceAgents({
  context,
  environmentId,
  onOpenThread,
}: {
  context: WorkspaceAgentContext;
  environmentId?: string | undefined;
  onOpenThread: (id: ThreadId) => void;
}) {
  const nativeChild = isProviderNativeSubagentThread(context.thread);
  const taskInputId = useId();
  const [expanded, setExpanded] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parentRun = context.runs
    .filter((run) => run.rootNodeId && ["starting", "running", "waiting"].includes(run.status))
    .toSorted((a, b) => b.ordinal - a.ordinal)[0];
  const activeCount = context.subagents.filter((agent) =>
    ["pending", "running", "waiting"].includes(agent.status),
  ).length;
  const dispatch = async (command: OrchestrationV2Command) => {
    const api = await environmentApi(environmentId);
    return api.orchestration.dispatchCommand(command);
  };
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
  const row =
    "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-muted disabled:opacity-50";
  return (
    <>
      <section aria-label="Agent workflow" className="mt-3 border-t border-border/60 pt-2">
        <button
          type="button"
          className={row}
          aria-expanded={expanded}
          aria-controls={`workspace-agents-${context.thread.id}`}
          onClick={() => setExpanded(!expanded)}
        >
          <BotIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="flex-1 font-medium">Sub-agents</span>
          <span className="text-[11px] text-muted-foreground">
            {activeCount ? `${activeCount} active` : context.subagents.length}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {expanded && (
          <div id={`workspace-agents-${context.thread.id}`} className="space-y-1 pt-1">
            {context.thread.lineage.parentThreadId && (
              <button
                type="button"
                className={row}
                onClick={() => onOpenThread(context.thread.lineage.parentThreadId!)}
              >
                <CornerLeftUpIcon aria-hidden="true" className="size-3.5" />
                Open parent conversation
              </button>
            )}
            {context.subagents.length === 0 && (
              <p className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Delegated tasks and provider sub-agents appear here as they run.
              </p>
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {context.subagents.map((agent) => (
                <div key={agent.id} className="rounded-lg border border-border/50 p-2">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      disabled={!agent.childThreadId}
                      onClick={() => agent.childThreadId && onOpenThread(agent.childThreadId)}
                      className="min-w-0 flex-1 text-left text-xs disabled:cursor-default"
                      title={agent.title ?? agent.prompt}
                    >
                      <span className="line-clamp-2 font-medium">
                        {agent.title ?? (agent.prompt.slice(0, 100) || "Sub-agent")}
                      </span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        {agent.origin === "provider_native" ? "Provider agent" : "Delegated task"}
                        {agent.model ? ` · ${agent.model}` : ""}
                      </span>
                    </button>
                    <span className="text-[10px] capitalize text-muted-foreground" role="status">
                      {agent.status}
                    </span>
                  </div>
                  {(agent.progress || agent.result) && (
                    <details className="mt-2 text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">
                        {agent.result ? "Result" : "Progress"}
                      </summary>
                      <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                        {agent.result ?? agent.progress}
                      </p>
                    </details>
                  )}
                  {agent.childThreadId &&
                    agent.origin === "app_owned" &&
                    ["pending", "running", "waiting"].includes(agent.status) && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        className="mt-1 flex min-h-7 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          void perform(agent.id, async () => {
                            const api = await environmentApi(environmentId);
                            const child = await api.orchestration.getThreadProjection({
                              threadId: agent.childThreadId!,
                            });
                            const run = child.runs
                              .filter((r) =>
                                ["preparing", "starting", "running", "waiting"].includes(r.status),
                              )
                              .toSorted((a, b) => b.ordinal - a.ordinal)[0];
                            if (!run) throw new Error("This sub-agent has no active run to stop.");
                            await api.orchestration.dispatchCommand({
                              type: "run.interrupt",
                              commandId: newCommandId(),
                              threadId: agent.childThreadId!,
                              runId: run.id,
                              holdQueue: true,
                              reason: "Stopped from workspace actions",
                            });
                          })
                        }
                      >
                        <SquareIcon aria-hidden="true" className="size-3" />
                        {busy === agent.id ? "Stopping…" : "Stop"}
                      </button>
                    )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className={row}
              disabled={nativeChild || !parentRun || busy !== null}
              title={
                parentRun
                  ? "Delegate using this conversation’s model and permissions"
                  : "Start a run in this conversation to delegate a task"
              }
              onClick={() => setDelegateOpen(true)}
            >
              <PlusIcon aria-hidden="true" className="size-3.5" />
              Delegate task
            </button>
            {nativeChild && (
              <p className="px-2 text-[10px] text-muted-foreground">
                Delegate tasks from the parent conversation.
              </p>
            )}
            {!parentRun && !nativeChild && (
              <p className="px-2 text-[10px] text-muted-foreground">
                Start a run to delegate. You can also ask your agent to use sub-agents in your
                prompt.
              </p>
            )}
            <button
              type="button"
              className={row}
              disabled={busy !== null}
              onClick={() =>
                void perform("fork", async () => {
                  const targetThreadId = ThreadId.make(crypto.randomUUID());
                  await dispatch({
                    type: "thread.fork",
                    commandId: newCommandId(),
                    sourceThreadId: context.thread.id,
                    targetThreadId,
                    sourcePoint: { type: "latest_stable" },
                    createdBy: "user",
                    creationSource: "web",
                  });
                  onOpenThread(targetThreadId);
                })
              }
            >
              <GitForkIcon aria-hidden="true" className="size-3.5" />
              {busy === "fork" ? "Forking…" : "Fork conversation"}
            </button>
            {context.thread.lineage.parentThreadId &&
              context.thread.lineage.relationshipToParent === "fork" && (
                <button
                  type="button"
                  className={row}
                  disabled={busy !== null || !context.runs.some((r) => r.status === "completed")}
                  onClick={() =>
                    void perform("merge", async () => {
                      const targetThreadId = context.thread.lineage.parentThreadId!;
                      await dispatch({
                        type: "thread.merge_back",
                        commandId: newCommandId(),
                        sourceThreadId: context.thread.id,
                        targetThreadId,
                        sourcePoint: { type: "latest_stable" },
                        createdBy: "user",
                        creationSource: "web",
                      });
                      onOpenThread(targetThreadId);
                    })
                  }
                >
                  <CornerLeftUpIcon aria-hidden="true" className="size-3.5" />
                  Merge result into parent
                </button>
              )}
          </div>
        )}
        {error && (
          <p role="alert" className="px-2 py-1 text-[11px] text-destructive">
            {error}
          </p>
        )}
        <Dialog open={delegateOpen} onOpenChange={setDelegateOpen}>
          <DialogPopup>
            <DialogPanel>
              <DialogHeader>
                <DialogTitle>Delegate a task</DialogTitle>
                <DialogDescription>
                  The child uses this conversation’s model, workspace, and permissions. Its result
                  returns to this conversation.
                </DialogDescription>
              </DialogHeader>
              <label className="mx-6 block text-xs font-medium" htmlFor={taskInputId}>
                Task
              </label>
              <textarea
                id={taskInputId}
                className="mx-6 mt-2 min-h-28 w-[calc(100%-3rem)] rounded-xl border border-border bg-background p-3 text-sm"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe one self-contained task…"
              />
              {error && (
                <p role="alert" className="px-6 text-xs text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDelegateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={nativeChild || !task.trim() || !parentRun || busy !== null}
                  onClick={() =>
                    void perform("delegate", async () => {
                      if (!parentRun?.rootNodeId)
                        throw new Error("The parent run has ended. Start another run to delegate.");
                      await dispatch({
                        type: "delegated_task.request",
                        commandId: newCommandId(),
                        parentThreadId: context.thread.id,
                        parentRunId: parentRun.id,
                        parentNodeId: parentRun.rootNodeId,
                        task: task.trim(),
                        title: task.trim().split("\n")[0]!.slice(0, 100),
                        modelSelection: parentRun.modelSelection,
                        runtimeMode: context.thread.runtimeMode,
                        interactionMode: context.thread.interactionMode,
                        completionWake: "always",
                        createdBy: "user",
                        creationSource: "web",
                      });
                      setTask("");
                      setDelegateOpen(false);
                      setExpanded(true);
                    })
                  }
                >
                  {busy === "delegate" ? "Starting…" : "Delegate"}
                </Button>
              </DialogFooter>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      </section>
      {!nativeChild && <WorkspaceAutomations context={context} environmentId={environmentId} />}
    </>
  );
}
