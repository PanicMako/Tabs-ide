import { WorkspaceAutomations } from "./WorkspaceAutomations";
import {
  ThreadId,
  isProviderNativeSubagentThread,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type ServerConfig,
  type RunId,
  ProviderInstanceId,
} from "@tabs/contracts";
import { useState, useId, useEffect, useRef } from "react";
import {
  BotIcon,
  ChevronDownIcon,
  GitForkIcon,
  CornerLeftUpIcon,
  PlusIcon,
  SquareIcon,
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
> &
  Partial<Pick<OrchestrationV2ThreadProjection, "contextTransfers">>;

const INITIAL_VISIBLE_COUNT = 6;
const VISIBLE_INCREMENT = 12;

/** Consumes the parent conversation's existing stream. Reuses family snapshot without unbounded polling. */
export function WorkspaceAgents(props: {
  context: WorkspaceAgentContext;
  environmentId?: string | undefined;
  onOpenThread: (id: ThreadId) => void;
}) {
  return (
    <ScopedWorkspaceAgents
      key={JSON.stringify([props.environmentId, props.context.thread.id])}
      {...props}
    />
  );
}

function ScopedWorkspaceAgents({
  context,
  environmentId,
  onOpenThread,
}: {
  context: WorkspaceAgentContext;
  environmentId?: string | undefined;
  onOpenThread: (id: ThreadId) => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const openThread = (id: ThreadId) => {
    if (mounted.current) onOpenThread(id);
  };
  const nativeChild = isProviderNativeSubagentThread(context.thread);
  const taskInputId = useId();
  const providerSelectId = useId();
  const modelSelectId = useId();

  const [expanded, setExpanded] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegationParentId, setDelegationParentId] = useState<RunId | null>(null);
  const delegationRetry = useRef<{
    fingerprint: string;
    commandId: ReturnType<typeof newCommandId>;
  } | null>(null);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [familyThreads, setFamilyThreads] = useState<ReadonlyArray<OrchestrationV2ThreadShell>>([]);
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_COUNT);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [serverConfigError, setServerConfigError] = useState<string | null>(null);
  const [serverConfigRefresh, setServerConfigRefresh] = useState(0);

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
  const [familyCursor, setFamilyCursor] = useState<ThreadId | null>(null);
  const [familyTotal, setFamilyTotal] = useState<number | null>(null);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [familyRefresh, setFamilyRefresh] = useState(0);
  const childMembership = context.subagents
    .map((agent) => `${agent.id}:${agent.childThreadId}`)
    .join("|");
  const supportsThreadFamily = serverConfig?.shellThreadFamilies === true;

  // Clear transient state and fetch family on thread / environment change
  useEffect(() => {
    setBusy(null);
    setError(null);
    setVisibleLimit(INITIAL_VISIBLE_COUNT);
    setFamilyLoaded(false);
    setFamilyThreads([]);
    setFamilyCursor(null);
    setFamilyTotal(null);
    setFamilyError(null);
    if (!expanded || !supportsThreadFamily) return;
    let cancelled = false;

    environmentApi(environmentId)
      .then((api) => api.orchestration.getThreadFamily({ threadId: context.thread.id, limit: 50 }))
      .then((family) => {
        if (!cancelled) {
          setFamilyThreads(family.threads);
          setFamilyCursor(family.nextCursor ?? null);
          setFamilyTotal(family.totalCount ?? null);
          setFamilyLoaded(true);
        }
      })
      .catch((cause) => {
        if (!cancelled) setFamilyError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [
    context.thread.id,
    environmentId,
    expanded,
    childMembership,
    familyRefresh,
    supportsThreadFamily,
  ]);

  // Load server config for provider/model selector
  useEffect(() => {
    let cancelled = false;
    setServerConfig(null);
    setServerConfigError(null);
    environmentApi(environmentId)
      .then((api) => api.server.getConfig())
      .then((cfg) => {
        if (!cancelled) {
          setServerConfig(cfg);
          setServerConfigError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setServerConfigError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [environmentId, serverConfigRefresh]);

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
    ...context.thread,
    status: parentRun?.status ?? "idle",
    activityRunStatus:
      parentRun?.status === "starting" ||
      parentRun?.status === "running" ||
      parentRun?.status === "waiting"
        ? parentRun.status
        : null,
    activeRunId: parentRun?.id ?? null,
    latestRunId: context.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0]?.id ?? null,
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    itemCount: 0,
    visibleItemCount: 0,
  };

  const allShells = [currentShell, ...familyThreads];
  const graph = deriveThreadRelationshipGraph({
    threads: allShells,
    projection: context,
  });

  const mergeTargetThreadId = resolveMergeBackTargetThreadId(context);
  const walkRows = walkThreadRelationships(graph, context.thread.id);
  const orderedRows = orderWebThreadLineageRows({
    graph,
    rows: walkRows,
    currentThreadId: context.thread.id,
    mergeTargetThreadId,
  });

  const knownRows = new Set(orderedRows.map((row) => row.threadId));
  const disconnectedRows = familyThreads
    .filter((thread) => thread.id !== context.thread.id && !knownRows.has(thread.id))
    .map((thread) => ({
      threadId: thread.id,
      fromThreadId: context.thread.id,
      depth: 1,
      edge: {
        sourceThreadId: context.thread.id,
        targetThreadId: thread.id,
        kind: "family" as const,
        status: thread.activityRunStatus ?? thread.status,
      },
    }));
  const familyRows = [...orderedRows, ...disconnectedRows].filter(
    (row) => row.threadId !== context.thread.lineage.parentThreadId,
  );
  const unlinkedAgents = context.subagents.filter((agent) => agent.childThreadId === null);
  const { visibleRows, hiddenCount: loadedHiddenCount } = resolveThreadLineageWindow(
    familyRows,
    visibleLimit,
  );
  const unloadedCount =
    familyCursor === null
      ? 0
      : Math.max(
          1,
          (familyTotal ?? familyThreads.length + 1) -
            new Set(familyThreads.map((thread) => thread.id)).size,
        );
  const hiddenCount = loadedHiddenCount + unloadedCount;
  const showMore = () =>
    void perform("family", async () => {
      if (supportsThreadFamily && familyCursor !== null && loadedHiddenCount < VISIBLE_INCREMENT) {
        const api = await environmentApi(environmentId);
        const page = await api.orchestration.getThreadFamily({
          threadId: context.thread.id,
          afterThreadId: familyCursor,
          limit: 50,
        });
        if (!mounted.current) return;
        setFamilyThreads((previous) => [
          ...new Map([...previous, ...page.threads].map((thread) => [thread.id, thread])).values(),
        ]);
        setFamilyCursor(page.nextCursor ?? null);
        setFamilyTotal(page.totalCount ?? null);
      }
      setVisibleLimit((previous) => previous + VISIBLE_INCREMENT);
    });

  const activeFamilyCount = familyRows.filter((row) => {
    const agent = context.subagents.find((candidate) => candidate.childThreadId === row.threadId);
    const status = agent?.status ?? threadRelationshipRowStatus(graph, row);
    return ["pending", "running", "waiting", "starting", "preparing", "queued"].includes(
      status ?? "",
    );
  }).length;
  const activeCount =
    activeFamilyCount +
    unlinkedAgents.filter((agent) => ["pending", "running", "waiting"].includes(agent.status))
      .length;
  const totalDisplayCount =
    Math.max(
      familyRows.length + (context.thread.lineage.parentThreadId ? 1 : 0),
      (familyTotal ?? 1) - 1,
    ) + unlinkedAgents.length;
  const stopChild = async (
    agent: WorkspaceAgentContext["subagents"][number],
    childThreadId: ThreadId,
  ) => {
    await dispatch({
      type: "delegated_task.completion-delivery.dispose",
      commandId: newCommandId(),
      parentThreadId: context.thread.id,
      taskId: agent.id,
    });
    await dispatch({
      type: "thread.stop",
      commandId: newCommandId(),
      threadId: childThreadId,
      reason: "Stopped from workspace actions",
    });
  };

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
                  !isParentMissing && openThread(context.thread.lineage.parentThreadId!)
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
                  const isRelated = lineageRow.edge.kind === "family";
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
                            onClick={() => !isMissing && openThread(lineageRow.threadId)}
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
                                  : isRelated
                                    ? "Related conversation"
                                    : isNative
                                      ? "Provider agent"
                                      : "Delegated task"}
                              {agent?.model
                                ? ` · ${agent.model}`
                                : node?.thread?.modelSelection
                                  ? ` · ${node.thread.modelSelection.model}`
                                  : ""}
                              {node?.thread?.archivedAt != null ? " · Archived" : ""}
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

                      {/* Stop active child work */}
                      {canStop && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="mt-1 flex min-h-7 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            void perform(lineageRow.threadId, () =>
                              stopChild(agent!, lineageRow.threadId),
                            )
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
                    disabled={busy !== null}
                    onClick={showMore}
                  >
                    Show {Math.min(VISIBLE_INCREMENT, hiddenCount)} more ({hiddenCount} remaining)
                  </button>
                )}
              </div>
            ) : null}
            {unlinkedAgents.map((agent) => (
              <div key={agent.id} className="rounded-lg border border-border/50 p-2 text-xs">
                <p className="font-medium">
                  {agent.title ?? (agent.prompt.slice(0, 100) || "Sub-agent")}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {agent.origin === "provider_native"
                    ? "Provider agent · controls stay with the provider"
                    : "Delegated task · child conversation not available yet"}
                </p>
                <span role="status" className="text-[10px] capitalize text-muted-foreground">
                  {agent.status}
                </span>
                {(agent.progress || agent.result) && (
                  <details className="mt-2 text-[11px] text-muted-foreground">
                    <summary>{agent.result ? "Result" : "Progress"}</summary>
                    <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
                      {agent.result ?? agent.progress}
                    </p>
                  </details>
                )}
              </div>
            ))}

            {familyRows.length === 0 && familyCursor !== null && (
              <button type="button" className={row} disabled={busy !== null} onClick={showMore}>
                Load more relatives ({unloadedCount} remaining)
              </button>
            )}
            {familyError && (
              <div role="alert" className="px-2 text-xs text-destructive">
                Could not load relatives.{" "}
                <button type="button" onClick={() => setFamilyRefresh((value) => value + 1)}>
                  Retry
                </button>
              </div>
            )}
            {serverConfigError && (
              <div role="alert" className="px-2 text-xs text-destructive">
                Could not read server capabilities. {serverConfigError}{" "}
                <button type="button" onClick={() => setServerConfigRefresh((value) => value + 1)}>
                  Retry
                </button>
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
              onClick={() => {
                setDelegationParentId(parentRun?.id ?? null);
                setSelectedInstanceId(defaultInstanceId);
                setSelectedModel(defaultModel);
                setError(null);
                delegationRetry.current = null;
                setDelegateOpen(true);
              }}
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

            {mergeTargetThreadId && (
              <button
                type="button"
                className={row}
                disabled={
                  busy !== null ||
                  !familyLoaded ||
                  graph.nodes.get(mergeTargetThreadId)?.missing !== false ||
                  graph.nodes.get(mergeTargetThreadId)?.thread?.archivedAt != null ||
                  !context.runs.some((run) => run.status === "completed")
                }
                onClick={() =>
                  void perform("merge", async () => {
                    await dispatch({
                      type: "thread.merge_back",
                      commandId: newCommandId(),
                      sourceThreadId: context.thread.id,
                      targetThreadId: mergeTargetThreadId,
                      sourcePoint: { type: "latest_stable" },
                      createdBy: "user",
                      creationSource: "web",
                    });
                    openThread(mergeTargetThreadId);
                  })
                }
              >
                <CornerLeftUpIcon aria-hidden="true" className="size-3.5" />
                {busy === "merge" ? "Merging…" : "Merge result into parent"}
              </button>
            )}

            {/* Fork button */}
            <button
              type="button"
              className={row}
              disabled={nativeChild || busy !== null}
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
                  openThread(targetThreadId);
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
                      const selectedParent = context.runs.find(
                        (run) =>
                          run.id === delegationParentId &&
                          ["starting", "running", "waiting"].includes(run.status),
                      );
                      if (!selectedParent?.rootNodeId) {
                        throw new Error("The parent run has ended. Start another run to delegate.");
                      }

                      // Revalidate provider and model availability on the owning machine
                      const api = await environmentApi(environmentId);
                      const latestCfg = await api.server.getConfig();
                      const provider = latestCfg.providers.find(
                        (entry) =>
                          entry.instanceId === selectedInstanceId && entry.status === "ready",
                      );
                      if (!provider) {
                        throw new Error(
                          `Provider "${selectedInstanceId}" is not available on this machine.`,
                        );
                      }
                      if (!provider.models.some((model) => model.slug === selectedModel)) {
                        throw new Error(
                          `Model "${selectedModel}" is not available on this machine.`,
                        );
                      }

                      const fingerprint = JSON.stringify([
                        selectedParent.id,
                        task.trim(),
                        selectedInstanceId,
                        selectedModel,
                        selectedParent.modelSelection.options,
                        context.thread.runtimeMode,
                        context.thread.interactionMode,
                      ]);
                      if (delegationRetry.current?.fingerprint !== fingerprint)
                        delegationRetry.current = { fingerprint, commandId: newCommandId() };
                      await dispatch({
                        type: "delegated_task.request",
                        commandId: delegationRetry.current.commandId,
                        parentThreadId: context.thread.id,
                        parentRunId: selectedParent.id,
                        parentNodeId: selectedParent.rootNodeId,
                        task: task.trim(),
                        title: task.trim().split("\n")[0]!.slice(0, 100),
                        modelSelection: {
                          instanceId: ProviderInstanceId.make(selectedInstanceId),
                          model: selectedModel,
                          ...(selectedInstanceId === selectedParent.modelSelection.instanceId &&
                          selectedParent.modelSelection.options
                            ? { options: selectedParent.modelSelection.options }
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
