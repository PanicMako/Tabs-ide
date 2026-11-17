// Adapted from T3 Code (https://github.com/pingdotgg/t3code), Copyright (c) 2026 T3 Tools Inc., MIT.
import {
  type ModelSelection,
  type RuntimeMode,
  type EnvironmentId,
  type ThreadId,
} from "@tabs/contracts";

import { environmentApi } from "~/connection/environmentApiRegistry";
import { appAtomRegistry } from "~/state/atomRegistry";
import { readModelStateAtom } from "~/state/readModel";
import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { truncateTitle } from "~/truncateTitle";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";

const SHELL_WAIT_MS = 8_000;

/** Resolves once the read model on this client holds `threadId`, or false after a timeout. */
function waitForThread(environmentId: EnvironmentId, threadId: ThreadId): Promise<boolean> {
  const present = () =>
    appAtomRegistry
      .get(readModelStateAtom)
      .threads.some(
        (thread) =>
          thread.id === threadId &&
          (thread.environmentId === undefined || thread.environmentId === environmentId),
      );
  if (present()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      unsubscribe();
      clearTimeout(timer);
      resolve(value);
    };
    const unsubscribe = appAtomRegistry.subscribe(readModelStateAtom, () => {
      if (present()) finish(true);
    });
    const timer = setTimeout(() => finish(present()), SHELL_WAIT_MS);
  });
}

/** The right-panel scope that owns the surface tabs of one parent thread. */
export function sideChatScope(environmentId: string | undefined, parentThreadId: ThreadId) {
  return `${environmentId ?? "local"}:${parentThreadId}`;
}

/** Whether a side chat never got a message, so closing it may delete it. */
export function isUnusedSideChat(thread: {
  readonly messages: ReadonlyArray<unknown>;
  readonly visibleItemCount?: number | undefined;
  readonly latestTurn: unknown;
}): boolean {
  return thread.messages.length === 0 && (thread.visibleItemCount ?? 0) === 0 && !thread.latestTurn;
}

export async function deleteSideChatThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): Promise<void> {
  const api = await environmentApi(environmentId);
  await api.orchestration.dispatchCommand({
    type: "thread.delete",
    commandId: newCommandId(),
    threadId,
  });
}

export interface SideChatSettings {
  readonly runtimeMode: RuntimeMode;
  readonly modelSelection: ModelSelection | undefined;
}

// The parent's composer owns its permissions and model, so each mounted chat registers a reader the
// surface chooser can use to start a side chat with what the composer shows.
const settingsReaders = new Map<string, () => SideChatSettings>();

export function registerSideChatSettings(scope: string, read: () => SideChatSettings): () => void {
  settingsReaders.set(scope, read);
  return () => {
    if (settingsReaders.get(scope) === read) settingsReaders.delete(scope);
  };
}

export function readSideChatSettings(scope: string): SideChatSettings | undefined {
  return settingsReaders.get(scope)?.();
}

const startingParents = new Set<string>();

/**
 * Starts a side chat from `parentThreadId`: forks its latest stable point, applies `settings` (the
 * parent composer's permissions and model), sends `prompt` when there is one, and shows the side
 * chat as a right-panel tab. Resolves false when it did not start or one is still starting.
 */
export async function startSideChat(input: {
  readonly environmentId: EnvironmentId | undefined;
  readonly parentThreadId: ThreadId | null;
  readonly settings: SideChatSettings | undefined;
  readonly prompt?: string | undefined;
  readonly onError: (message: string) => void;
}): Promise<boolean> {
  const { environmentId, parentThreadId, onError } = input;
  if (!environmentId || !parentThreadId) return false;
  const scope = sideChatScope(environmentId, parentThreadId);
  if (startingParents.has(scope)) return false;
  startingParents.add(scope);
  const targetThreadId = newThreadId();
  let created = false;
  const discard = () => {
    if (created) void deleteSideChatThread(environmentId, targetThreadId).catch(() => undefined);
  };
  try {
    const parent = appAtomRegistry
      .get(readModelStateAtom)
      .threads.find((thread) => thread.id === parentThreadId);
    const runtimeMode = input.settings?.runtimeMode ?? parent?.runtimeMode;
    const modelSelection = input.settings?.modelSelection ?? parent?.modelSelection;
    const api = await environmentApi(environmentId);
    await api.orchestration.dispatchCommand({
      type: "thread.fork",
      commandId: newCommandId(),
      sourceThreadId: parentThreadId,
      targetThreadId,
      sourcePoint: { type: "latest_stable" },
      title: "Side chat",
      sideChat: true,
      createdBy: "user",
      creationSource: "web",
    });
    created = true;
    if (!(await waitForThread(environmentId, targetThreadId))) {
      onError("The side chat was created, but it did not reach this client.");
      discard();
      return false;
    }
    const sideChat = appAtomRegistry
      .get(readModelStateAtom)
      .threads.find((thread) => thread.id === targetThreadId);
    if (runtimeMode !== undefined && sideChat && sideChat.runtimeMode !== runtimeMode) {
      await api.orchestration.dispatchCommand({
        type: "thread.runtime-mode.set",
        commandId: newCommandId(),
        threadId: targetThreadId,
        runtimeMode,
      });
    }
    if (modelSelection !== undefined) {
      await api.orchestration.dispatchCommand({
        type: "thread.model-selection.set",
        commandId: newCommandId(),
        threadId: targetThreadId,
        modelSelection,
      });
    }
    const text = input.prompt?.trim();
    // Send before showing the tab: closing a tab whose side chat has no message deletes it.
    if (text) {
      await api.orchestration.dispatchCommand({
        type: "message.dispatch",
        commandId: newCommandId(),
        threadId: targetThreadId,
        messageId: newMessageId(),
        text,
        titleSeed: truncateTitle(text),
        attachments: [],
        ...(modelSelection === undefined ? {} : { modelSelection }),
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
    }
    useCompanionSurfaceStore.getState().open(scope, "sidechat", {
      sideChatThreadId: targetThreadId,
      title: "Side chat",
    });
    useRightPanelStore.getState().openPanel("sidechat");
    return true;
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : "Could not start a side chat.");
    discard();
    return false;
  } finally {
    startingParents.delete(scope);
  }
}

/** Shows an existing side chat as a tab of its parent's right panel, reusing its tab if open. */
export function openSideChatTab(
  environmentId: string | undefined,
  parentThreadId: ThreadId,
  sideChatThreadId: ThreadId,
): void {
  const scope = sideChatScope(environmentId, parentThreadId);
  const companion = useCompanionSurfaceStore.getState();
  const existing = companion.workspaces[scope]?.tabs.find(
    (tab) => tab.kind === "sidechat" && tab.sideChatThreadId === sideChatThreadId,
  );
  if (existing) companion.activate(scope, existing.id);
  else companion.open(scope, "sidechat", { sideChatThreadId, title: "Side chat" });
  useRightPanelStore.getState().openPanel("sidechat");
}

/** Why Bring back is unavailable, or null when the side chat can be handed to its parent. */
export function bringBackBlockedReason(input: {
  readonly parentIdle: boolean;
  readonly sideChatHasReply: boolean;
}): string | null {
  if (!input.parentIdle) return "Available when the main thread is idle.";
  if (!input.sideChatHasReply) return "Available after a finished reply.";
  return null;
}
