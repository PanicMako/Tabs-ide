/**
 * Hand-off from a keyboard shortcut to the Queue panel. The panel owns the
 * queue controller, so the shortcut asks and the panel acts when it is mounted.
 * A request waits briefly so a panel that is still opening can pick it up.
 */
export type QueueShortcutAction = "edit" | "sendNow";

interface QueueShortcutRequest {
  readonly threadId: string;
  readonly action: QueueShortcutAction;
  readonly at: number;
}

const REQUEST_LIFETIME_MS = 2000;
type Listener = (request: QueueShortcutRequest) => boolean;

const listeners = new Set<Listener>();
let pending: QueueShortcutRequest | null = null;

export function requestQueueShortcut(
  threadId: string,
  action: QueueShortcutAction,
  now = Date.now(),
): void {
  const request = { threadId, action, at: now };
  for (const listener of listeners) {
    if (listener(request)) {
      pending = null;
      return;
    }
  }
  pending = request;
}

/** Listens for requests. Return true from the listener when it handled the request. */
export function onQueueShortcut(listener: Listener, now = Date.now()): () => void {
  listeners.add(listener);
  if (pending && now - pending.at <= REQUEST_LIFETIME_MS && listener(pending)) pending = null;
  return () => {
    listeners.delete(listener);
  };
}

export function resetQueueShortcuts(): void {
  listeners.clear();
  pending = null;
}
