import {
  type EnvironmentId,
  type MessageId,
  type TurnId,
  type AssistantCitation,
  type ThreadId,
} from "@tabs/contracts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import gsap from "gsap";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic";
import { isScrollContainerNearBottom } from "../../chat-scroll";
import { AnimatedHeight } from "../AnimatedHeight";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { CHAT_TIMELINE_ANCHOR_OFFSET } from "./timelineScrollAnchoring";
import { TaskProgressCard } from "./TaskProgressCard";
import { type TurnDiffSummary } from "../../types";
import { summarizeTurnDiffStats } from "../../lib/turnDiffTree";
import ChatMarkdown from "../ChatMarkdown";
import { FileDiff } from "@pierre/diffs/react";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { getRenderablePatch, resolveDiffThemeName, resolveFileDiffPath } from "~/lib/diffRendering";
import {
  buildReviewCommentRenderablePatch,
  formatReviewCommentFence,
  parseReviewCommentMessageSegments,
  type ReviewCommentContext,
} from "~/reviewCommentContext";
import { formatWorkspaceRelativePath } from "~/filePathDisplay";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  EyeIcon,
  FileTextIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import { computeMessageDurationStart, normalizeCompactToolLabel } from "./MessagesTimeline.logic";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { type TimestampFormat } from "@tabs/contracts/settings";
import { formatTimestamp } from "../../timestampFormat";
import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { parseScopedThreadKey } from "@tabs/client-runtime/environment";
import { AssistantCitationSource, type AssistantCitationRequest } from "./AssistantCitationSource";
import { useAssistantCitationTarget } from "./useAssistantCitationTarget";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";
import {
  ClaudeAI,
  OpenAI,
  GrokIcon,
  OpenCodeIcon,
  CursorIcon,
  CopilotIcon,
  type Icon,
} from "../Icons";

const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

/** Maps provider instanceId → SVG icon component for the assistant message header */
const TIMELINE_PROVIDER_ICON_MAP: Record<string, Icon> = {
  claudeAgent: ClaudeAI,
  codex: OpenAI,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  cursor: CursorIcon,
};

interface MessagesTimelineProps {
  hasMessages: boolean;
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnStartedAt: string | null;
  scrollContainer: HTMLDivElement | null;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  nowIso: string;
  expandedWorkGroups: Record<string, boolean>;
  onToggleWorkGroup: (groupId: string) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  environmentId?: EnvironmentId | undefined;
  latestTaskDescription: string | null;
  /** Provider instanceId for the active thread (e.g. "claudeAgent", "codex", "grok") */
  providerInstanceId?: string;
  citationRequest?: AssistantCitationRequest | null;
  onCiteAssistantText?: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => boolean;
  threadId?: ThreadId;
  routeThreadKey?: string;
}

export const MessagesTimeline = memo(function MessagesTimeline({
  hasMessages,
  isWorking,
  activeTurnInProgress: _activeTurnInProgress,
  activeTurnStartedAt,
  scrollContainer,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionSummary,
  turnDiffSummaryByAssistantMessageId,
  nowIso,
  expandedWorkGroups,
  onToggleWorkGroup,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  isRevertingCheckpoint,
  onImageExpand,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  environmentId,
  latestTaskDescription,
  providerInstanceId,
  citationRequest,
  onCiteAssistantText,
  threadId,
  routeThreadKey,
}: MessagesTimelineProps) {
  const citationThreadRef = useMemo(() => {
    if (routeThreadKey) return parseScopedThreadKey(routeThreadKey);
    if (environmentId && threadId) return { environmentId, threadId };
    return null;
  }, [routeThreadKey, environmentId, threadId]);

  const rows = useMemo<TimelineRow[]>(() => {
    const nextRows: TimelineRow[] = [];
    const durationStartByMessageId = computeMessageDurationStart(
      timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
    );

    for (let index = 0; index < timelineEntries.length; index += 1) {
      const timelineEntry = timelineEntries[index];
      if (!timelineEntry) {
        continue;
      }

      if (timelineEntry.kind === "work") {
        const groupedEntries = [timelineEntry.entry];
        let cursor = index + 1;
        while (cursor < timelineEntries.length) {
          const nextEntry = timelineEntries[cursor];
          if (!nextEntry || nextEntry.kind !== "work") break;
          groupedEntries.push(nextEntry.entry);
          cursor += 1;
        }
        nextRows.push({
          kind: "work",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          groupedEntries,
        });
        index = cursor - 1;
        continue;
      }

      if (timelineEntry.kind === "proposed-plan") {
        nextRows.push({
          kind: "proposed-plan",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          proposedPlan: timelineEntry.proposedPlan,
        });
        continue;
      }

      if (timelineEntry.kind === "tasks") {
        nextRows.push({
          kind: "tasks",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          tasks: timelineEntry.tasks,
        });
        continue;
      }

      nextRows.push({
        kind: "message",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        message: timelineEntry.message,
        durationStart:
          durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
        showCompletionDivider:
          timelineEntry.message.role === "assistant" &&
          completionDividerBeforeEntryId === timelineEntry.id,
      });
    }

    // Plan/task updates happen before the final assistant response, but their
    // card belongs to the completed turn. Move each card to the end of its
    // user-message segment so every provider renders tasks after the response
    // and immediately before the next user message.
    const positionedRows = placeTaskRowsAtTurnEnds(nextRows);

    if (isWorking) {
      positionedRows.push({
        kind: "working",
        id: "working-indicator-row",
        createdAt: activeTurnStartedAt,
      });
    }

    return positionedRows;
  }, [timelineEntries, completionDividerBeforeEntryId, isWorking, activeTurnStartedAt]);

  const { target: citationTarget } = useAssistantCitationTarget({
    request: citationRequest ?? null,
    entries: timelineEntries as any,
    rows: rows as any,
    viewport: scrollContainer,
    historyLoading: false,
    onExpandTurn: () => {},
    onManualNavigation: () => {},
  });
  const [allDirectoriesExpandedByTurnId, setAllDirectoriesExpandedByTurnId] = useState<
    Record<string, boolean>
  >({});
  const onToggleAllDirectories = useCallback((turnId: TurnId) => {
    setAllDirectoriesExpandedByTurnId((current) => ({
      ...current,
      [turnId]: !(current[turnId] ?? true),
    }));
  }, []);

  // Scroll anchoring: maintain reading position when user is scrolled up and active turn streams
  const scrollAnchorRef = useRef<{
    element: HTMLElement | null;
    offsetFromTop: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!scrollContainer) return;
    const isNearBottom = isScrollContainerNearBottom(scrollContainer);
    if (isNearBottom) {
      scrollAnchorRef.current = null;
      return;
    }

    if (scrollAnchorRef.current?.element?.isConnected) {
      const currentRect = scrollAnchorRef.current.element.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const currentOffset = currentRect.top - containerRect.top;
      const drift = currentOffset - scrollAnchorRef.current.offsetFromTop;
      if (Math.abs(drift) > 0.5) {
        scrollContainer.scrollTop += drift;
      }
    } else {
      const containerRect = scrollContainer.getBoundingClientRect();
      const rowElements = scrollContainer.querySelectorAll<HTMLElement>("[data-timeline-row-kind]");
      for (const row of rowElements) {
        const rowRect = row.getBoundingClientRect();
        if (rowRect.bottom > containerRect.top + CHAT_TIMELINE_ANCHOR_OFFSET) {
          scrollAnchorRef.current = {
            element: row,
            offsetFromTop: rowRect.top - containerRect.top,
          };
          break;
        }
      }
    }
  }, [scrollContainer, timelineEntries, isWorking]);

  const renderRowContent = (row: TimelineRow) => (
    <div
      className="pb-4"
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" &&
        (() => {
          const groupId = row.id;
          const groupedEntries = row.groupedEntries;
          const isExpanded = expandedWorkGroups[groupId] ?? false;

          // Split entries into task lifecycle entries and regular tool entries
          const taskActivityKinds = new Set(["task.started", "task.progress", "task.completed"]);
          const regularEntries = groupedEntries.filter(
            (entry) =>
              !entry.taskId &&
              !taskActivityKinds.has(
                (entry as unknown as { activityKind?: string }).activityKind ?? "",
              ),
          );

          const hasOverflow = regularEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
          const visibleEntries =
            hasOverflow && !isExpanded
              ? regularEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
              : regularEntries;
          const hiddenCount = regularEntries.length - visibleEntries.length;
          const onlyToolEntries = regularEntries.every((entry) => entry.tone === "tool");
          const groupLabel = onlyToolEntries ? "Tool call" : "Work log";

          // Collect all log entry texts for copying (uses same label as rendered rows)
          const allLogsText = regularEntries
            .map((e) => {
              const heading = toolWorkEntryHeading(e);
              const detail = e.command ?? e.detail ?? null;
              return detail ? `${heading} — ${detail}` : heading;
            })
            .join("\n");

          return (
            <div className="space-y-2">
              {regularEntries.length > 0 && (
                <div className="w-full">
                  {/* ── Prototype-style: icon + label header row ── */}
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleWorkGroup(groupId)}
                      aria-expanded={isExpanded}
                      className="flex items-center gap-2 group/header rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    >
                      {onlyToolEntries ? (
                        <WrenchIcon className="size-3.5 text-muted-foreground/60 shrink-0" />
                      ) : (
                        <TerminalIcon className="size-3.5 text-muted-foreground/60 shrink-0" />
                      )}
                      <span className="text-xs font-sans font-medium text-muted-foreground/70 group-hover/header:text-foreground transition-colors">
                        {groupLabel}
                      </span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <MessageCopyButton text={allLogsText} variant="ghost" size="icon-xs" />
                      {hasOverflow && (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? `Hide details for ${groupLabel}`
                              : `View details for ${groupLabel}`
                          }
                          className="flex items-center gap-1 rounded-sm text-[11px] font-mono text-muted-foreground/40 hover:text-foreground/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 motion-reduce:transition-none"
                          onClick={() => onToggleWorkGroup(groupId)}
                        >
                          <span>{isExpanded ? "Hide details" : `View details`}</span>
                          <ChevronDownIcon
                            className={cn(
                              "size-3 transition-transform duration-200 motion-reduce:transition-none",
                              isExpanded && "rotate-180",
                            )}
                          />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Numbered monospace log card ── */}
                  <div
                    className={cn(
                      "rounded-lg border border-border/40 bg-card/50 p-4 flex flex-col gap-2.5",
                      hasOverflow && "cursor-pointer hover:border-border/60 transition-colors",
                    )}
                    onClick={() => hasOverflow && onToggleWorkGroup(groupId)}
                  >
                    <AnimatedHeight>
                      <div className="flex flex-col gap-2.5">
                        {visibleEntries.map((workEntry, idx) => {
                          const heading = toolWorkEntryHeading(workEntry);
                          const detail = workEntry.command ?? workEntry.detail ?? null;
                          const entryNum =
                            hasOverflow && !isExpanded
                              ? regularEntries.length - visibleEntries.length + idx + 1
                              : idx + 1;
                          return (
                            <div
                              key={`work-row:${workEntry.id}`}
                              className="flex items-center gap-3.5 text-xs font-sans leading-relaxed"
                            >
                              <span className="font-mono text-[11px] text-muted-foreground/25 select-none shrink-0">
                                [{String(entryNum).padStart(2, "0")}]
                              </span>
                              <div className="min-w-0 flex-1 truncate flex items-center gap-2">
                                <span className="font-sans font-medium text-foreground/85">
                                  {heading}
                                </span>
                                {detail && (
                                  <>
                                    <span className="text-muted-foreground/30">•</span>
                                    <span className="font-mono text-[11px] text-muted-foreground/55 truncate">
                                      {detail}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </AnimatedHeight>
                    {/* Blinking cursor — only while actively working */}
                    {isWorking && (
                      <div className="flex items-start gap-4 text-sm font-mono leading-relaxed">
                        <span className="text-muted-foreground/20 select-none shrink-0">
                          [{String(regularEntries.length + 1).padStart(2, "0")}]
                        </span>
                        <span className="inline-block h-3.5 w-2 animate-pulse bg-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      {row.kind === "tasks" && <TaskProgressCard tasks={row.tasks} />}

      {row.kind === "message" &&
        row.message.role === "user" &&
        (() => {
          const userImages = (row.message.attachments ?? []).filter(
            (
              attachment,
            ): attachment is Extract<
              NonNullable<TimelineMessage["attachments"]>[number],
              { type: "image" }
            > => attachment.type === "image",
          );
          const userFiles = (row.message.attachments ?? []).filter(
            (attachment) => attachment.type === "file",
          );
          const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
          const terminalContexts = displayedUserMessage.contexts;
          const canRevertAgentWork = revertTurnCountByUserMessageId.has(row.message.id);
          return (
            // Prototype-style: right-aligned, no bubble, right-border accent + large text
            <div className="flex justify-end">
              <div className="group relative max-w-[80%]">
                {/* Action row: timestamp + copy + revert (visible on hover, focus-within, and touch/pointer-coarse) */}
                <div className="mb-1.5 flex items-center justify-end gap-2 opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
                  <div className="flex items-center gap-1.5">
                    {displayedUserMessage.copyText && (
                      <MessageCopyButton
                        text={displayedUserMessage.copyText}
                        variant="ghost"
                        size="icon-xs"
                      />
                    )}
                    {canRevertAgentWork && (
                      <button
                        type="button"
                        disabled={isRevertingCheckpoint || isWorking}
                        onClick={() => onRevertUserMessage(row.message.id)}
                        title="Revert to this message"
                        aria-label="Revert to this message"
                        className={cn(
                          "relative flex size-6 items-center justify-center rounded-md transition-colors",
                          "text-muted-foreground/40 hover:bg-muted/60 hover:text-foreground/70",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                          "pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11",
                          "motion-reduce:transition-none",
                          (isRevertingCheckpoint || isWorking) && "cursor-not-allowed opacity-40",
                        )}
                      >
                        <Undo2Icon className="size-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-right text-[10px] text-muted-foreground/30 transition-colors duration-150 hover:text-foreground/60 cursor-default">
                    {formatTimestamp(row.message.createdAt, timestampFormat)}
                  </p>
                </div>
                {/* Image attachments above text */}
                {userImages.length > 0 && (
                  <div
                    className={cn(
                      "mb-2 ml-auto grid gap-2",
                      userImages.length === 1
                        ? "max-w-[280px] grid-cols-1"
                        : "max-w-[420px] grid-cols-2",
                    )}
                  >
                    {userImages.map((image) => (
                      <div
                        key={image.id}
                        className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
                      >
                        {image.previewUrl ? (
                          <button
                            type="button"
                            className="h-full w-full cursor-zoom-in"
                            aria-label={`Preview ${image.name}`}
                            onClick={() => {
                              const preview = buildExpandedImagePreview(userImages, image.id);
                              if (!preview) return;
                              onImageExpand(preview);
                            }}
                          >
                            <img
                              src={image.previewUrl}
                              alt={image.name}
                              className="h-full max-h-[220px] w-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                            {image.name}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {userFiles.length > 0 && (
                  <div className="mb-2 ml-auto flex max-w-[420px] flex-wrap justify-end gap-2">
                    {userFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/80 bg-background/70 px-2.5 py-2 text-xs"
                      >
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Main message text — left-aligned, right-border accent */}
                {(displayedUserMessage.visibleText.trim().length > 0 ||
                  terminalContexts.length > 0) && (
                  <div className="border-r-2 border-foreground/80 pr-4 text-left text-base font-sans leading-relaxed text-foreground">
                    <UserMessageBody
                      text={displayedUserMessage.visibleText}
                      terminalContexts={terminalContexts}
                      workspaceRoot={workspaceRoot}
                      resolvedTheme={resolvedTheme}
                      markdownCwd={markdownCwd}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "assistant" &&
        (() => {
          const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");
          // Resolve provider icon for the header
          const ProviderIconComp = providerInstanceId
            ? (TIMELINE_PROVIDER_ICON_MAP[providerInstanceId] ?? BotIcon)
            : BotIcon;
          const providerLabel = providerInstanceId ?? "agent";
          return (
            <>
              {row.showCompletionDivider && (
                <div className="my-3 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                    {completionSummary ? `Response • ${completionSummary}` : "Response"}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {/* Prototype-style: left-border accent with single-pass hover sweep + scroll-driven light bar + tiny provider header + softer body text + hover-reveal copy */}
              <AssistantMessageBorder scrollContainer={scrollContainer}>
                {/* Tiny provider header: icon + label (brightens on hover) */}
                <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground/30 transition-colors duration-200 group-hover:text-foreground/75">
                  <ProviderIconComp className="size-3" />
                  <span className="font-mono text-[10px]">{providerLabel}</span>
                </div>
                {/* Body text */}
                <div className="text-base font-sans leading-relaxed text-foreground/85">
                  <AssistantCitationSource
                    messageId={row.message.id}
                    {...(citationThreadRef ? { threadRef: citationThreadRef } : {})}
                    itemKey={row.id}
                    request={citationTarget}
                  >
                    <ChatMarkdown
                      text={messageText}
                      cwd={markdownCwd}
                      isStreaming={Boolean(row.message.streaming)}
                    />
                  </AssistantCitationSource>
                </div>
                {/* Action footer: copy + timestamp (visible on hover, focus-within, and touch/pointer-coarse) */}
                <div className="-ml-1.5 mt-1 flex items-center gap-1.5 opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
                  <MessageCopyButton text={messageText} variant="ghost" size="icon-xs" />
                  <p className="text-[10px] text-muted-foreground/30 transition-colors duration-150 hover:text-foreground/60 cursor-default">
                    {formatMessageMeta(
                      row.message.createdAt,
                      row.message.streaming
                        ? formatElapsed(row.durationStart, nowIso)
                        : formatElapsed(row.durationStart, row.message.completedAt),
                      timestampFormat,
                    )}
                  </p>
                </div>
              </AssistantMessageBorder>
            </>
          );
        })()}

      {row.kind === "proposed-plan" && (
        <div className="min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            cwd={markdownCwd}
            workspaceRoot={workspaceRoot}
            environmentId={environmentId}
          />
        </div>
      )}

      {row.kind === "working" && (
        <div className="py-0.5 pl-1.5">
          <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground/50">
            <span className="inline-flex items-center gap-[3px]">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40 animate-pulse" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:200ms]" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40 animate-pulse [animation-delay:400ms]" />
            </span>
            <span>
              {latestTaskDescription
                ? row.createdAt
                  ? `${latestTaskDescription} for ${formatWorkingTimer(row.createdAt, nowIso) ?? "0s"}`
                  : latestTaskDescription
                : row.createdAt
                  ? `Working for ${formatWorkingTimer(row.createdAt, nowIso) ?? "0s"}`
                  : "Working..."}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  // Helper: render the changed-files card for a given assistant message.
  // Extracted so it can be deferred to after any following work row.
  const renderChangedFilesForMessage = (messageId: MessageId) => {
    const turnSummary = turnDiffSummaryByAssistantMessageId.get(messageId);
    if (!turnSummary) return null;
    const checkpointFiles = turnSummary.files;
    if (checkpointFiles.length === 0) return null;
    const summaryStat = summarizeTurnDiffStats(checkpointFiles);
    const changedFileCountLabel = String(checkpointFiles.length);
    const allDirectoriesExpanded = allDirectoriesExpandedByTurnId[turnSummary.turnId] ?? true;
    return (
      <div className="pb-4">
        <div className="rounded-lg border border-border/80 bg-card/45 p-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
              <span>Changed files ({changedFileCountLabel})</span>
              {hasNonZeroStat(summaryStat) && (
                <>
                  <span className="mx-1">•</span>
                  <DiffStatLabel
                    additions={summaryStat.additions}
                    deletions={summaryStat.deletions}
                  />
                </>
              )}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onToggleAllDirectories(turnSummary.turnId)}
              >
                {allDirectoriesExpanded ? "Collapse all" : "Expand all"}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path)}
              >
                View diff
              </Button>
            </div>
          </div>
          <ChangedFilesTree
            key={`changed-files-tree:${turnSummary.turnId}`}
            turnId={turnSummary.turnId}
            files={checkpointFiles}
            allDirectoriesExpanded={allDirectoriesExpanded}
            resolvedTheme={resolvedTheme}
            onOpenTurnDiff={onOpenTurnDiff}
          />
        </div>
      </div>
    );
  };

  // Map each row index to any assistant message IDs whose Changed Files card should be rendered AFTER that row.
  // This guarantees that Changed Files ALWAYS renders at the very end of a turn (after all text and tool call boxes).
  const changedFilesMapByIndex = useMemo(() => {
    const map = new Map<number, MessageId[]>();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row && row.kind === "message" && row.message.role === "assistant") {
        const messageId = row.message.id;
        if (turnDiffSummaryByAssistantMessageId.has(messageId)) {
          let turnEndIndex = i;
          for (let j = i + 1; j < rows.length; j += 1) {
            const candidate = rows[j];
            if (candidate && candidate.kind === "message" && candidate.message.role === "user") {
              break;
            }
            turnEndIndex = j;
          }
          const existing = map.get(turnEndIndex) ?? [];
          existing.push(messageId);
          map.set(turnEndIndex, existing);
        }
      }
    }
    return map;
  }, [rows, turnDiffSummaryByAssistantMessageId]);

  if (!hasMessages && !isWorking) {
    return (
      <div className="flex items-center justify-center py-4">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <div
      data-timeline-root="true"
      data-assistant-citation-viewport="true"
      className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden"
    >
      {onCiteAssistantText && citationThreadRef ? (
        <AssistantSelectionToolbar
          viewport={scrollContainer}
          threadRef={citationThreadRef}
          onCite={onCiteAssistantText}
        />
      ) : null}
      {rows.map((row, index) => (
        <RenderErrorBoundary
          key={`timeline-row-boundary:${row.id}`}
          fallback={
            <div className="my-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Failed to render message.
            </div>
          }
          resetKeys={[
            row.id,
            row.kind === "message" ? row.message.text : undefined,
            row.kind === "work" ? row.groupedEntries.length : undefined,
          ]}
        >
          <div key={`timeline-row-group:${row.id}`}>
            <div key={`timeline-row:${row.id}`}>{renderRowContent(row)}</div>
            {changedFilesMapByIndex.get(index)?.map((msgId) => (
              <div key={`changed-files-for:${msgId}`}>{renderChangedFilesForMessage(msgId)}</div>
            ))}
          </div>
        </RenderErrorBoundary>
      ))}
    </div>
  );
});

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineProposedPlan = Extract<TimelineEntry, { kind: "proposed-plan" }>["proposedPlan"];
type TimelineWorkEntry = Extract<TimelineEntry, { kind: "work" }>["entry"];
type TimelineTasks = Extract<TimelineEntry, { kind: "tasks" }>["tasks"];
type TimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: TimelineWorkEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: TimelineMessage;
      durationStart: string;
      showCompletionDivider: boolean;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: TimelineProposedPlan;
    }
  | { kind: "tasks"; id: string; createdAt: string; tasks: TimelineTasks }
  | { kind: "working"; id: string; createdAt: string | null };

export function placeTaskRowsAtTurnEnds(rows: ReadonlyArray<TimelineRow>): TimelineRow[] {
  const taskRows = rows.filter((row) => row.kind === "tasks");
  const positionedRows: TimelineRow[] = rows.filter((row) => row.kind !== "tasks");
  for (const taskRow of taskRows) {
    const nextUserMessageIndex = positionedRows.findIndex(
      (row) =>
        row.kind === "message" && row.message.role === "user" && row.createdAt > taskRow.createdAt,
    );
    positionedRows.splice(
      nextUserMessageIndex === -1 ? positionedRows.length : nextUserMessageIndex,
      0,
      taskRow,
    );
  }
  return positionedRows;
}

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatMessageMeta(
  createdAt: string,
  duration: string | null,
  timestampFormat: TimestampFormat,
): string {
  if (!duration) return formatTimestamp(createdAt, timestampFormat);
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`;
}

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

function UserMessageReviewCommentCard(props: {
  comment: ReviewCommentContext;
  workspaceRoot?: string | undefined;
  resolvedTheme?: "light" | "dark" | undefined;
  markdownCwd?: string | undefined;
}) {
  const { comment, workspaceRoot, resolvedTheme, markdownCwd } = props;
  const fenceLanguage = comment.fenceLanguage ?? "diff";
  const renderablePatch = getRenderablePatch(
    buildReviewCommentRenderablePatch(comment),
    `review-comment:${comment.id}`,
  );

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-background/70 p-3 text-left">
      <div className="space-y-1">
        <div className="text-foreground text-xs font-medium">
          {formatWorkspaceRelativePath(comment.filePath, workspaceRoot)}
        </div>
        <div className="text-muted-foreground text-[11px]">
          {comment.sectionTitle} · {comment.rangeLabel}
        </div>
      </div>
      {comment.text.length > 0 && (
        <div className="whitespace-pre-wrap wrap-break-word text-sm text-foreground">
          {comment.text}
        </div>
      )}
      {fenceLanguage !== "diff" && comment.diff.trim().length > 0 && (
        <ChatMarkdown
          text={formatReviewCommentFence(fenceLanguage, comment.diff)}
          cwd={markdownCwd}
        />
      )}
      {renderablePatch?.kind === "files" && (
        <DiffWorkerPoolProvider>
          {renderablePatch.files.map((fileDiff) => (
            <FileDiff
              key={resolveFileDiffPath(fileDiff)}
              fileDiff={fileDiff}
              options={{
                collapsed: false,
                diffStyle: "unified",
                theme: resolveDiffThemeName(resolvedTheme === "light" ? "light" : "dark"),
              }}
            />
          ))}
        </DiffWorkerPoolProvider>
      )}
      {renderablePatch?.kind === "raw" && (
        <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 text-xs">
          {renderablePatch.text}
        </pre>
      )}
    </div>
  );
}

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  workspaceRoot?: string | undefined;
  resolvedTheme?: "light" | "dark" | undefined;
  markdownCwd?: string | undefined;
}) {
  const reviewCommentSegments = parseReviewCommentMessageSegments(props.text);
  if (reviewCommentSegments.some((segment) => segment.kind === "review-comment")) {
    return (
      <div className="space-y-3 text-left">
        {reviewCommentSegments.map((segment) =>
          segment.kind === "text" ? (
            segment.text.trim().length > 0 ? (
              <div
                key={segment.id}
                className="wrap-break-word whitespace-pre-wrap font-sans text-base leading-relaxed text-foreground"
              >
                {segment.text.trim()}
              </div>
            ) : null
          ) : (
            <UserMessageReviewCommentCard
              key={segment.comment.id}
              comment={segment.comment}
              workspaceRoot={props.workspaceRoot}
              resolvedTheme={props.resolvedTheme}
              markdownCwd={props.markdownCwd}
            />
          ),
        )}
      </div>
    );
  }

  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              {props.text.slice(cursor, matchIndex)}
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              {props.text.slice(cursor)}
            </span>,
          );
        }

        return (
          <div className="wrap-break-word whitespace-pre-wrap font-sans text-base leading-relaxed text-foreground">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(<span key="user-message-terminal-context-inline-text">{props.text}</span>);
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="wrap-break-word whitespace-pre-wrap font-sans text-base leading-relaxed text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <p className="whitespace-pre-wrap wrap-break-word font-sans text-base leading-relaxed text-foreground">
      {props.text}
    </p>
  );
});

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-foreground/92",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-foreground/92",
  };
}

function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/70";
  if (tone === "thinking") return "text-muted-foreground/50";
  return "text-muted-foreground/40";
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles">,
) {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  return workEntry.changedFiles!.length === 1
    ? firstPath
    : `${firstPath} +${workEntry.changedFiles!.length - 1} more`;
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SquarePenIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
}) {
  const { workEntry } = props;
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const preview = workEntryPreview(workEntry);
  const displayText = preview ? `${heading} - ${preview}` : heading;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;

  return (
    <div className="rounded-lg px-1 py-1">
      <div className="flex items-center gap-2 transition-[opacity,translate] duration-200">
        <span
          className={cn("flex size-5 shrink-0 items-center justify-center", iconConfig.className)}
        >
          <EntryIcon className="size-3" />
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p
            className={cn(
              "truncate text-[11px] leading-5",
              workToneClass(workEntry.tone),
              preview ? "text-muted-foreground/70" : "",
            )}
            title={displayText}
          >
            <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
              {heading}
            </span>
            {preview && <span className="text-muted-foreground/55"> - {preview}</span>}
          </p>
        </div>
      </div>
      {hasChangedFiles && !previewIsChangedFiles && (
        <div className="mt-1 flex flex-wrap gap-1 pl-6">
          {workEntry.changedFiles?.slice(0, 4).map((filePath) => (
            <span
              key={`${workEntry.id}:${filePath}`}
              className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
              title={filePath}
            >
              {filePath}
            </span>
          ))}
          {(workEntry.changedFiles?.length ?? 0) > 4 && (
            <span className="px-1 text-[10px] text-muted-foreground/55">
              +{(workEntry.changedFiles?.length ?? 0) - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

const AssistantMessageBorder = memo(function AssistantMessageBorder({
  scrollContainer,
  children,
}: {
  scrollContainer: HTMLDivElement | null;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLDivElement>(null);
  const lightBarRef = useRef<HTMLDivElement>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const isScrolledActiveRef = useRef(false);

  // Single-pass hover sweep using GSAP — suppressed if scroll light bar is active
  const handleMouseEnter = useCallback(() => {
    if (isScrolledActiveRef.current) return;
    if (!sweepRef.current) return;
    if (tweenRef.current) tweenRef.current.kill();

    // GSAP silky-smooth sweep from top to bottom
    tweenRef.current = gsap.fromTo(
      sweepRef.current,
      { y: "-100%", opacity: 0 },
      {
        y: "280%",
        opacity: 1,
        duration: 1.5,
        ease: "power2.inOut",
        onComplete: () => {
          if (sweepRef.current) {
            gsap.to(sweepRef.current, { opacity: 0, duration: 0.35 });
          }
        },
      },
    );
  }, []);

  // GSAP scroll progress listener — silky smooth tweening with light-to-dark gradient
  useEffect(() => {
    const el = containerRef.current;
    const bar = lightBarRef.current;
    if (!el || !bar) return;
    const target = scrollContainer ?? (typeof window !== "undefined" ? window : null);
    if (!target) return;

    const updateProgress = () => {
      if (!containerRef.current || !lightBarRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = scrollContainer ? scrollContainer.clientHeight : window.innerHeight;
      const containerTop = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
      const elementTop = rect.top - containerTop;
      const elementHeight = rect.height;

      if (elementHeight <= 0) return;

      const scrolled = viewportHeight * 0.45 - elementTop;
      const rawProgress = scrolled / elementHeight;
      const isActivelyScrolled = rawProgress > 0.05 && rawProgress < 0.95;
      isScrolledActiveRef.current = isActivelyScrolled;

      // Kill any running hover sweep if active scroll takes over
      if (isActivelyScrolled && tweenRef.current) {
        tweenRef.current.kill();
        if (sweepRef.current) {
          gsap.set(sweepRef.current, { opacity: 0 });
        }
      }

      const progress = Math.max(0, Math.min(1, rawProgress));

      // GSAP smooth tween to target height & opacity with zero jitter
      gsap.to(lightBarRef.current, {
        height: `${Math.max(6, Math.min(100, progress * 100))}%`,
        opacity: isActivelyScrolled ? 1 : 0,
        duration: 0.3,
        ease: "power1.out",
        overwrite: "auto",
      });
    };

    updateProgress();
    target.addEventListener("scroll", updateProgress, { passive: true });
    return () => target.removeEventListener("scroll", updateProgress);
  }, [scrollContainer]);

  return (
    <div ref={containerRef} onMouseEnter={handleMouseEnter} className="group relative min-w-0 pl-4">
      {/* Static base line — single 1px left track */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-border/40 transition-colors duration-200 group-hover:bg-border/60" />

      {/* 1. GSAP Single-pass hover sweep beam — perfectly aligned at left-0 */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-px overflow-hidden">
        <div
          ref={sweepRef}
          className="h-44 w-full opacity-0 bg-gradient-to-b from-foreground/10 via-foreground/90 to-foreground/30 shadow-[0_0_8px_rgba(255,255,255,0.3)]"
        />
      </div>

      {/* 2. GSAP Scroll Light Bar — perfectly aligned at left-0 */}
      <div
        ref={lightBarRef}
        className="pointer-events-none absolute left-0 top-0 w-px opacity-0 bg-gradient-to-b from-foreground/95 via-foreground/60 to-foreground/20"
      />

      {children}
    </div>
  );
});
