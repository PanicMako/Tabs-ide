import { WorkspaceAutomations } from "./WorkspaceAutomations";
import {
  ThreadId,
  isProviderNativeSubagentThread,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type ServerConfig,
  ProviderInstanceId,
} from "@tabs/contracts";
import { useState, useId, useEffect } from "react";
import {
  BotIcon,
  ChevronDownIcon,
  GitForkIcon,
  CornerLeftUpIcon,
  PlusIcon,
  SquareIcon,
  ArrowRightIcon,
  ShieldAlertIcon,
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
import {
  deriveThreadRelationshipGraph,
  walkThreadRelationships,
  orderWebThreadLineageRows,
  resolveThreadLineageWindow,
  resolveMergeBackTargetThreadId,
  isParentThreadRelationship,
  threadRelationshipRowStatus,
} from "@tabs/client-runtime/state/threadRelationships";

export type WorkspaceAgentContext = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "subagents"
>;

const INITIAL_VISIBLE_COUNT = 6;
const VISIBLE_INCREMENT = 12;

/** Consumes the parent conversation's existing stream. Reuses family snapshot without unbounded polling. */
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
  const providerSelectId = useId();
  const modelSelectId = useId();

  const [expanded, setExpanded] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [familyThreads, setFamilyThreads] = useState<ReadonlyArray<OrchestrationV2ThreadShell>>([]);
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_COUNT);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);

  const parentRun = context.runs
    .filter((run) => run.rootNodeId && ["starting", "running", "waiting"].includes(run.status))
    .toSorted((a, b) => b.ordinal - a.ordinal)[0];

  const defaultInstanceId =
    parentRun?.modelSelection?.instanceId ?? context.thread.modelSelection.instanceId ?? "codex";
  const defaultModel =
    parentRun?.modelSelection?.model ?? context.thread.modelSelection.model ?? "gpt-5";

  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(defaultInstanceId);
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [familyLoaded, setFamilyLoaded] = useState(false);

  // Clear transient state and fetch family on thread / environment change
  useEffect(() => {
    setBusy(null);
    setError(null);
    setVisibleLimit(INITIAL_VISIBLE_COUNT);
    setFamilyLoaded(false);
    let cancelled = false;

    environmentApi(environmentId)
      .then((api) => api.orchestration.getThreadFamily({ threadId: context.thread.id }))
      .then((family) => {
        if (!cancelled) {
          setFamilyThreads(family.threads);
          setFamilyLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFamilyThreads([]);
          setFamilyLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [context.thread.id, environmentId]);

  // Load server config for provider/model selector
  useEffect(() => {
    let cancelled = false;
    environmentApi(environmentId)
      .then((api) => api.server.getConfig())
      .then((cfg) => {
        if (!cancelled) setServerConfig(cfg);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  // Sync default selection when dialog opens
  useEffect(() => {
    if (delegateOpen) {
      setSelectedInstanceId(defaultInstanceId);
      setSelectedModel(defaultModel);
      setError(null);
    }
  }, [delegateOpen, defaultInstanceId, defaultModel]);

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

  // Build the relationship graph from known family shells + current projection
  const currentShell: OrchestrationV2ThreadShell = {
    id: context.thread.id,
    projectId:
      (context.thread as unknown as OrchestrationV2ThreadShell).projectId ?? ("default" as any),
    title:
      (context.thread as unknown as OrchestrationV2ThreadShell).title ?? "Current conversation",
    status: (parentRun?.status ?? "idle") as any,
    activityRunStatus: (parentRun?.status ?? null) as any,
    lineage: context.thread.lineage,
    forkedFrom: (context.thread as unknown as OrchestrationV2ThreadShell).forkedFrom ?? null,
    modelSelection: context.thread.modelSelection,
    runtimeMode: context.thread.runtimeMode,
    interactionMode: context.thread.interactionMode,
    archivedAt: null,
    deletedAt: null,
    settledAt: null,
    createdAt: (context.thread as unknown as OrchestrationV2ThreadShell).createdAt,
    updatedAt: (context.thread as unknown as OrchestrationV2ThreadShell).updatedAt,
  } as unknown as OrchestrationV2ThreadShell;

  const allShells = [...familyThreads, currentShell];
  const graph = deriveThreadRelationshipGraph({
    threads: allShells,
    projection: context as unknown as OrchestrationV2ThreadProjection,
  });

  const mergeTargetThreadId = resolveMergeBackTargetThreadId(context as any);
  const walkRows = walkThreadRelationships(graph, context.thread.id);
  const orderedRows = orderWebThreadLineageRows({
    graph,
    rows: walkRows,
    currentThreadId: context.thread.id,
    mergeTargetThreadId,
  });

  const familyRows = orderedRows.filter(
    (row) => row.threadId !== context.thread.lineage.parentThreadId,
  );
  const { visibleRows, hiddenCount } = resolveThreadLineageWindow(familyRows, visibleLimit);

  const activeSubagentCount = context.subagents.filter((agent) =>
    ["pending", "running", "waiting"].includes(agent.status),
  ).length;

  const activeFamilyCount = familyRows.filter((row) => {
    const status = threadRelationshipRowStatus(graph, row);
    return ["pending", "running", "waiting", "starting", "preparing"].includes(status ?? "");
  }).length;

  const activeCount = Math.max(activeSubagentCount, activeFamilyCount);
  const totalDisplayCount = Math.max(
    context.subagents.length,
    familyRows.length + (context.thread.lineage.parentThreadId ? 1 : 0),
  );

  const availableProviders = serverConfig?.providers ?? [];
  const selectedProviderEntry = availableProviders.find((p) => p.instanceId === selectedInstanceId);
  const availableModels = selectedProviderEntry?.models ?? [];

  const parentNode = context.thread.lineage.parentThreadId
    ? graph.nodes.get(context.thread.lineage.parentThreadId)
    : null;
  const isParentMissing =
    familyLoaded && Boolean(context.thread.lineage.parentThreadId) && parentNode?.missing === true;

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
            {activeCount ? `${activeCount} active` : totalDisplayCount}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>

        {expanded && (
          <div id={`workspace-agents-${context.thread.id}`} className="space-y-1 pt-1">
            {/* If this conversation has a parent, offer opening it */}
            {context.thread.lineage.parentThreadId && (
              <button
                type="button"
                disabled={isParentMissing}
                className={row}
                onClick={() =>
                  !isParentMissing && onOpenThread(context.thread.lineage.parentThreadId!)
                }
                aria-label={
                  isParentMissing
                    ? `Unavailable conversation: ${context.thread.lineage.parentThreadId}`
                    : "Open parent conversation"
                }
              >
                <CornerLeftUpIcon aria-hidden="true" className="size-3.5" />
                {isParentMissing
                  ? `(Unavailable conversation: ${context.thread.lineage.parentThreadId.slice(0, 8)})`
                  : "Open parent conversation"}
              </button>
            )}

            {familyRows.length === 0 && context.subagents.length === 0 && (
              <p className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Delegated tasks and provider sub-agents appear here as they run.
              </p>
            )}

            {/* Lineage & Related family rows */}
            {familyRows.length > 0 ? (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {visibleRows.map((lineageRow) => {
                  const node = graph.nodes.get(lineageRow.threadId);
                  const isParent = isParentThreadRelationship(lineageRow.edge, context.thread.id);
                  const isFork = lineageRow.edge.kind === "fork";
                  const isMergeTarget = lineageRow.threadId === mergeTargetThreadId;
                  const agent = context.subagents.find(
                    (a) => a.childThreadId === lineageRow.threadId,
                  );
                  const rowStatus =
                    agent?.status ?? threadRelationshipRowStatus(graph, lineageRow) ?? "idle";
                  const isNative =
                    agent?.origin === "provider_native" ||
                    (node?.thread != null && isProviderNativeSubagentThread(node.thread));

                  const threadTitle =
                    agent?.title ??
                    (agent?.prompt ? agent.prompt.slice(0, 100) : null) ??
                    node?.thread?.title ??
                    (isParent ? "Parent conversation" : isFork ? "Fork conversation" : "Sub-agent");

                  const isMissing = !agent && node?.missing === true;
                  const canStop =
                    !isNative &&
                    agent?.origin === "app_owned" &&
                    ["pending", "running", "waiting"].includes(rowStatus);

                  return (
                    <div
                      key={lineageRow.threadId}
                      className="rounded-lg border border-border/50 p-2"
                    >
                      <div className="flex items-start gap-2">
                        {isParent ? (
                          <CornerLeftUpIcon
                            aria-hidden="true"
                            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                          />
                        ) : isFork ? (
                          <GitForkIcon
                            aria-hidden="true"
                            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                          />
                        ) : (
                          <BotIcon
                            aria-hidden="true"
                            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                          />
                        )}

                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            disabled={isMissing}
                            onClick={() => !isMissing && onOpenThread(lineageRow.threadId)}
                            className="w-full text-left text-xs disabled:cursor-default"
                            title={threadTitle}
                            aria-label={isParent ? "Open parent conversation" : undefined}
                          >
                            <span className="line-clamp-2 font-medium">
                              {isMissing
                                ? `(Unavailable conversation: ${lineageRow.threadId.slice(0, 8)})`
                                : threadTitle}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">
                              {isParent
                                ? "Parent"
                                : isFork
                                  ? "Fork"
                                  : isNative
                                    ? "Provider agent"
                                    : "Delegated task"}
                              {agent?.model
                                ? ` · ${agent.model}`
                                : node?.thread?.modelSelection
                                  ? ` · ${node.thread.modelSelection.model}`
                                  : ""}
                            </span>
                          </button>
                        </div>

                        <span
                          className="text-[10px] capitalize text-muted-foreground"
                          role="status"
                        >
                          {rowStatus}
                        </span>
                      </div>

                      {/* Provider native agent guidance */}
                      {isNative && (
                        <p className="mt-1 text-[10px] italic text-muted-foreground">
                          Provider sub-agent (approvals and questions route to parent)
                        </p>
                      )}

                      {/* Subagent progress or result */}
                      {agent && (agent.progress || agent.result) && (
                        <details className="mt-2 text-[11px] text-muted-foreground">
                          <summary className="cursor-pointer">
                            {agent.result ? "Result" : "Progress"}
                          </summary>
                          <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                            {agent.result ?? agent.progress}
                          </p>
                        </details>
                      )}

                      {/* Merge back action for fork targets */}
                      {isMergeTarget &&
                        context.thread.lineage.parentThreadId &&
                        context.thread.lineage.relationshipToParent === "fork" && (
                          <button
                            type="button"
                            disabled={
                              busy !== null || !context.runs.some((r) => r.status === "completed")
                            }
                            className="mt-2 flex min-h-7 items-center gap-1.5 rounded bg-muted/60 px-2 text-[11px] text-foreground hover:bg-muted"
                            onClick={() =>
                              void perform("merge", async () => {
                                const targetThreadId = lineageRow.threadId;
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
                            <CornerLeftUpIcon aria-hidden="true" className="size-3" />
                            {busy === "merge" ? "Merging…" : "Merge result into parent"}
                          </button>
                        )}

                      {/* Stop active child work */}
                      {canStop && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="mt-1 flex min-h-7 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            void perform(lineageRow.threadId, async () => {
                              const api = await environmentApi(environmentId);
                              const child = await api.orchestration.getThreadProjection({
                                threadId: lineageRow.threadId,
                              });
                              const run = child.runs
                                .filter((r) =>
                                  ["preparing", "starting", "running", "waiting"].includes(
                                    r.status,
                                  ),
                                )
                                .toSorted((a, b) => b.ordinal - a.ordinal)[0];
                              if (!run)
                                throw new Error("This sub-agent has no active run to stop.");
                              await api.orchestration.dispatchCommand({
                                type: "run.interrupt",
                                commandId: newCommandId(),
                                threadId: lineageRow.threadId,
                                runId: run.id,
                                holdQueue: true,
                                reason: "Stopped from workspace actions",
                              });
                            })
                          }
                        >
                          <SquareIcon aria-hidden="true" className="size-3" />
                          {busy === lineageRow.threadId ? "Stopping…" : "Stop"}
                        </button>
                      )}
                    </div>
                  );
                })}

                {hiddenCount > 0 && (
                  <button
                    type="button"
                    className="mt-1 flex min-h-7 w-full items-center justify-center rounded-md border border-border/40 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setVisibleLimit((prev) => prev + VISIBLE_INCREMENT)}
                  >
                    Show {Math.min(VISIBLE_INCREMENT, hiddenCount)} more ({hiddenCount} remaining)
                  </button>
                )}
              </div>
            ) : (
              /* Fallback: render subagents directly if no graph walk rows */
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
                                  ["preparing", "starting", "running", "waiting"].includes(
                                    r.status,
                                  ),
                                )
                                .toSorted((a, b) => b.ordinal - a.ordinal)[0];
                              if (!run)
                                throw new Error("This sub-agent has no active run to stop.");
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
            )}

            {/* Delegate button */}
            <button
              type="button"
              className={row}
              disabled={nativeChild || !parentRun || busy !== null}
              title={
                parentRun
                  ? "Delegate using selected model and inherited permissions"
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

            {/* Fork button */}
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
          </div>
        )}

        {error && (
          <p role="alert" className="px-2 py-1 text-[11px] text-destructive">
            {error}
          </p>
        )}

        {/* Delegation Dialog */}
        <Dialog open={delegateOpen} onOpenChange={setDelegateOpen}>
          <DialogPopup>
            <DialogPanel>
              <DialogHeader>
                <DialogTitle>Delegate a task</DialogTitle>
                <DialogDescription>
                  The child task runs under the selected provider and model with inherited
                  permissions.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 px-6 pt-2">
                <div>
                  <label className="block text-xs font-medium" htmlFor={taskInputId}>
                    Task
                  </label>
                  <textarea
                    id={taskInputId}
                    className="mt-1 min-h-24 w-full rounded-xl border border-border bg-background p-3 text-sm focus:border-primary focus:outline-none"
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    placeholder="Describe one self-contained task…"
                  />
                </div>

                {/* Provider and Model selectors */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium" htmlFor={providerSelectId}>
                      Provider
                    </label>
                    <select
                      id={providerSelectId}
                      aria-label="Provider"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none"
                      value={selectedInstanceId}
                      onChange={(e) => {
                        const nextInstance = e.target.value;
                        setSelectedInstanceId(nextInstance);
                        const nextProvider = availableProviders.find(
                          (p) => p.instanceId === nextInstance,
                        );
                        if (nextProvider?.models?.[0]?.slug) {
                          setSelectedModel(nextProvider.models[0].slug);
                        }
                      }}
                    >
                      {availableProviders.length > 0 ? (
                        availableProviders.map((p) => (
                          <option key={p.instanceId} value={p.instanceId}>
                            {p.displayName ?? p.instanceId}
                          </option>
                        ))
                      ) : (
                        <option value={selectedInstanceId}>{selectedInstanceId}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium" htmlFor={modelSelectId}>
                      Model
                    </label>
                    <select
                      id={modelSelectId}
                      aria-label="Model"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                    >
                      {availableModels.length > 0 ? (
                        availableModels.map((m) => (
                          <option key={m.slug} value={m.slug}>
                            {m.name ?? m.slug}
                          </option>
                        ))
                      ) : (
                        <option value={selectedModel}>{selectedModel}</option>
                      )}
                    </select>
                  </div>
                </div>

                {error && (
                  <p role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setDelegateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={nativeChild || !task.trim() || !parentRun || busy !== null}
                  onClick={() =>
                    void perform("delegate", async () => {
                      if (!parentRun?.rootNodeId) {
                        throw new Error("The parent run has ended. Start another run to delegate.");
                      }

                      // Revalidate provider and model availability on the owning machine
                      const api = await environmentApi(environmentId);
                      const latestCfg = await api.server.getConfig().catch(() => null);
                      if (latestCfg) {
                        const providerExists = latestCfg.providers?.some(
                          (p) => p.instanceId === selectedInstanceId && p.status === "ready",
                        );
                        if (
                          !providerExists &&
                          selectedInstanceId !== parentRun.modelSelection.instanceId
                        ) {
                          throw new Error(
                            `Provider "${selectedInstanceId}" is not available on this machine.`,
                          );
                        }
                      }

                      await dispatch({
                        type: "delegated_task.request",
                        commandId: newCommandId(),
                        parentThreadId: context.thread.id,
                        parentRunId: parentRun.id,
                        parentNodeId: parentRun.rootNodeId,
                        task: task.trim(),
                        title: task.trim().split("\n")[0]!.slice(0, 100),
                        modelSelection: {
                          instanceId: ProviderInstanceId.make(selectedInstanceId),
                          model: selectedModel,
                          ...(parentRun.modelSelection.options
                            ? { options: parentRun.modelSelection.options }
                            : {}),
                        },
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
