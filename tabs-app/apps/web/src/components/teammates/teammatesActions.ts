import type { EnvironmentId, TeammateId, ThreadId } from "@tabs/contracts";
import { getPrimaryEnvironmentId } from "~/connection/environmentApiRegistry";
import { ensureNativeApi } from "~/nativeApi";
import { appAtomRegistry } from "~/state/atomRegistry";
import { readModelStateAtom } from "~/state/readModel";
import { newCommandId, newMessageId } from "~/lib/utils";
import { toastManager } from "../ui/toast";

export function teammatesApi() {
  return ensureNativeApi().teammates;
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Something went wrong.";
}

/** Runs a teammates call; failures become an error toast and resolve to null. */
export async function attempt<T>(title: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    toastManager.add({ type: "error", title, description: errorMessage(error) });
    return null;
  }
}

/** The environment a thread lives in, falling back to the primary one. */
export function environmentForThread(threadId: ThreadId): EnvironmentId | null {
  const thread = appAtomRegistry
    .get(readModelStateAtom)
    .threads.find((candidate) => candidate.id === threadId);
  return (thread?.environmentId ?? getPrimaryEnvironmentId()) as EnvironmentId | null;
}

export type ThreadNavigator = (options: {
  to: "/$environmentId/$threadId";
  params: { environmentId: EnvironmentId; threadId: ThreadId };
}) => Promise<void> | void;

export async function openThread(threadId: ThreadId, navigate: ThreadNavigator) {
  const environmentId = environmentForThread(threadId);
  if (!environmentId) return;
  await navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
}

/** Ensures the teammate's home thread exists and shows it in the normal chat view. */
export async function openHomeChat(id: TeammateId, navigate: ThreadNavigator): Promise<boolean> {
  const result = await attempt("Could not open the chat", () => teammatesApi().openHome({ id }));
  if (!result) return false;
  await openThread(result.threadId, navigate);
  return true;
}

/**
 * Sends a message into a teammate's home chat. It queues behind a turn that is still running.
 * Resolves to the chat's thread id, or null when it failed (an error toast has been shown).
 */
export async function askTeammate(
  id: TeammateId,
  text: string,
  options: { readonly busy?: boolean } = {},
): Promise<ThreadId | null> {
  const message = text.trim();
  if (!message) return null;
  const home = await attempt("Could not open the chat", () => teammatesApi().openHome({ id }));
  if (!home) return null;
  const sent = await attempt("Could not send that", () =>
    ensureNativeApi().orchestration.dispatchCommand({
      type: "message.dispatch",
      commandId: newCommandId(),
      threadId: home.threadId,
      messageId: newMessageId(),
      text: message,
      attachments: [],
      dispatchMode: { type: options.busy ? "queue_after_active" : "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    }),
  );
  return sent === null ? null : home.threadId;
}
