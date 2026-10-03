import { ProjectId, type ModelSelection, type ThreadId } from "@tabs/contracts";
import { type ChatMessage, type SessionPhase, type Thread } from "../types";
import { randomUUID } from "~/lib/utils";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import { Schema } from "effect";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import { parseScopedThreadKey } from "@tabs/client-runtime/environment";
import type { TimelineEntry } from "../session-logic";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "tabs:last-invoked-script-by-project";
const WORKTREE_BRANCH_PREFIX = "tabs";
export const GENERIC_COMPOSER_PLACEHOLDER =
  "Ask anything, @tag files/folders, or use / to show available commands";
export const FOLLOW_UP_COMPOSER_PLACEHOLDER = "Ask for follow-up changes or attach images";

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    archivedAt: null,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export type SendPhase = "idle" | "preparing-worktree" | "sending-turn";

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function buildTemporaryWorktreeBranchName(): string {
  // Keep the 8-hex suffix shape for backend temporary-branch detection.
  const token = randomUUID().slice(0, 8).toLowerCase();
  return `${WORKTREE_BRANCH_PREFIX}/${token}`;
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  fileCount?: number;
  contextCount?: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 ||
      options.imageCount > 0 ||
      (options.fileCount ?? 0) > 0 ||
      (options.contextCount ?? 0) > 0 ||
      sendableTerminalContexts.length > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function shouldPauseAutoScrollOnUserScrollIntent(options: {
  shouldAutoScroll: boolean;
  intentDirection: "up" | "down";
  canScrollUp: boolean;
}): boolean {
  return options.shouldAutoScroll && options.intentDirection === "up" && options.canScrollUp;
}

export function shouldUseCenteredEmptyComposer(options: {
  isLocalDraftThread: boolean;
  hasTimelineEntries: boolean;
  isWorking: boolean;
}): boolean {
  return options.isLocalDraftThread && !options.hasTimelineEntries && !options.isWorking;
}

export function resolveBaseComposerPlaceholder(options: {
  hasConversationHistory: boolean;
  phase: SessionPhase;
}): string {
  return options.phase === "disconnected" && options.hasConversationHistory
    ? FOLLOW_UP_COMPOSER_PLACEHOLDER
    : GENERIC_COMPOSER_PLACEHOLDER;
}

/**
 * Keep painted timelines on screen across thread jumps. Remounting LegendList /
 * MessagesTimeline (or handing it an empty first paint) punches a hole through
 * the chat pane — white in light mode — so thread switching flashes even when
 * the destination is already cached.
 *
 * Stored at module scope because ChatView remounts when the thread route
 * changes. Remember up to 16 timelines so jumping back immediately paints on
 * the first frame, and foreign environments are strictly isolated.
 */
export type HeldThreadTimeline<T extends readonly unknown[]> = {
  threadKey: string | null;
  entries: T;
  markdownCwd?: string | null;
  workspaceRoot?: string | null;
};

export const MAX_REMEMBERED_THREAD_TIMELINES = 16;

let rememberedThreadTimelines = new Map<string, HeldThreadTimeline<readonly unknown[]>>();
let rememberedThreadTimelineOrder: string[] = [];
let lastReadyThreadKey: string | null = null;

function rememberThreadTimelineEntries(held: HeldThreadTimeline<readonly unknown[]>): void {
  if (held.threadKey === null) {
    return;
  }
  rememberedThreadTimelines.set(held.threadKey, held);
  rememberedThreadTimelineOrder = [
    ...rememberedThreadTimelineOrder.filter((key) => key !== held.threadKey),
    held.threadKey,
  ];
  while (rememberedThreadTimelineOrder.length > MAX_REMEMBERED_THREAD_TIMELINES) {
    const evicted = rememberedThreadTimelineOrder.shift();
    if (evicted !== undefined) {
      rememberedThreadTimelines.delete(evicted);
    }
  }
  lastReadyThreadKey = held.threadKey;
}

export function rememberReadyThreadTimeline<T extends readonly unknown[]>(
  held: HeldThreadTimeline<T>,
): void {
  if (held.threadKey === null || held.entries.length === 0) {
    return;
  }
  rememberThreadTimelineEntries(held);
}

export function peekRememberedThreadTimeline<T extends readonly unknown[]>(
  threadKey: string | null,
): T | null {
  if (threadKey === null) {
    return null;
  }
  return (rememberedThreadTimelines.get(threadKey)?.entries as T | undefined) ?? null;
}

export function peekHeldThreadTimeline<
  T extends readonly unknown[],
>(): HeldThreadTimeline<T> | null {
  if (lastReadyThreadKey === null) {
    return null;
  }
  const held = rememberedThreadTimelines.get(lastReadyThreadKey);
  if (held === undefined || held.entries.length === 0) {
    return null;
  }
  return held as HeldThreadTimeline<T>;
}

export function resetHeldThreadTimeline(): void {
  rememberedThreadTimelines = new Map();
  rememberedThreadTimelineOrder = [];
  lastReadyThreadKey = null;
}

export function threadKeysShareEnvironment(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return false;
  }
  const leftRef = parseScopedThreadKey(left);
  const rightRef = parseScopedThreadKey(right);
  return leftRef !== null && rightRef !== null && leftRef.environmentId === rightRef.environmentId;
}

/** True while we still paint another thread's last snapshot. */
export function isPaintOnlyThreadTimeline(
  displayThreadKey: string | null,
  activeThreadKey: string | null,
): boolean {
  return (
    displayThreadKey !== null && activeThreadKey !== null && displayThreadKey !== activeThreadKey
  );
}

export function resolveThreadSwitchTimeline<T extends readonly unknown[]>(input: {
  loading: boolean;
  activeThreadKey: string | null;
  nextEntries: T;
  rememberedForActive?: T | null;
  lastReady?: HeldThreadTimeline<T> | null;
}): { entries: T; displayThreadKey: string | null } {
  if (input.nextEntries.length > 0) {
    return { entries: input.nextEntries, displayThreadKey: input.activeThreadKey };
  }

  const rememberedForActive =
    input.rememberedForActive ?? peekRememberedThreadTimeline<T>(input.activeThreadKey);
  if (input.loading && rememberedForActive !== null && rememberedForActive.length > 0) {
    return { entries: rememberedForActive, displayThreadKey: input.activeThreadKey };
  }

  const lastReady = input.lastReady ?? peekHeldThreadTimeline<T>();
  if (
    input.loading &&
    lastReady !== null &&
    lastReady.threadKey !== null &&
    lastReady.threadKey !== input.activeThreadKey &&
    lastReady.entries.length > 0 &&
    threadKeysShareEnvironment(lastReady.threadKey, input.activeThreadKey)
  ) {
    return { entries: lastReady.entries, displayThreadKey: lastReady.threadKey };
  }
  return { entries: input.nextEntries, displayThreadKey: input.activeThreadKey };
}

export function timelineHasEphemeralPreviewUrls(
  entries: ReadonlyArray<Pick<TimelineEntry, "kind"> & { message?: ChatMessage }>,
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "message" &&
      entry.message !== undefined &&
      collectUserMessageBlobPreviewUrls(entry.message).length > 0,
  );
}

export const MAX_REMEMBERED_SCROLL_POSITIONS = 32;
let rememberedScrollTops = new Map<string, number>();
let rememberedScrollTopOrder: string[] = [];

export function rememberThreadScrollTop(threadKey: string | null, scrollTop: number): void {
  if (!threadKey || scrollTop < 0) return;
  rememberedScrollTops.set(threadKey, scrollTop);
  rememberedScrollTopOrder = [
    ...rememberedScrollTopOrder.filter((key) => key !== threadKey),
    threadKey,
  ];
  while (rememberedScrollTopOrder.length > MAX_REMEMBERED_SCROLL_POSITIONS) {
    const evicted = rememberedScrollTopOrder.shift();
    if (evicted !== undefined) {
      rememberedScrollTops.delete(evicted);
    }
  }
}

export function peekRememberedThreadScrollTop(threadKey: string | null): number | null {
  if (!threadKey) return null;
  return rememberedScrollTops.get(threadKey) ?? null;
}

export function resetRememberedThreadScrollTops(): void {
  rememberedScrollTops = new Map();
  rememberedScrollTopOrder = [];
}
