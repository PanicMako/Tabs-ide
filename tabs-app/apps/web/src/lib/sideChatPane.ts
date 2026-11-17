// Adapted from T3 Code (https://github.com/pingdotgg/t3code), Copyright (c) 2026 T3 Tools Inc., MIT.

/** Whether an event started in a side chat pane (`data-side-chat-pane`), which the main chat ignores. */
export function isInSideChatPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-side-chat-pane]") !== null;
}

/**
 * Whether a window-level shortcut belongs to the chat showing `thread`. The main chat and an
 * embedded side chat both listen on the window, so each takes only the keys pressed in its own view.
 */
export function ownsFocusedShortcut(
  thread: { readonly isSideChat?: boolean | undefined } | null | undefined,
  focused: EventTarget | null,
): boolean {
  return isInSideChatPane(focused) === (thread?.isSideChat === true);
}
