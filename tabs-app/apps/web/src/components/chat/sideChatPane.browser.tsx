import { describe, expect, it } from "vitest";

import { isInSideChatPane, ownsFocusedShortcut } from "~/lib/sideChatPane";

function focusedInPane(inPane: boolean): Element {
  const host = document.createElement("div");
  if (inPane) host.setAttribute("data-side-chat-pane", "side-1");
  const input = document.createElement("textarea");
  host.append(input);
  document.body.append(host);
  return input;
}

describe("isInSideChatPane", () => {
  it("is true only inside a side chat pane", () => {
    expect(isInSideChatPane(focusedInPane(true))).toBe(true);
    expect(isInSideChatPane(focusedInPane(false))).toBe(false);
    expect(isInSideChatPane(null)).toBe(false);
  });
});

describe("ownsFocusedShortcut", () => {
  it("gives keys pressed in the side chat to the side chat, and every other key to the main chat", () => {
    const sideChat = { isSideChat: true };
    const main = { isSideChat: false };
    expect(ownsFocusedShortcut(sideChat, focusedInPane(true))).toBe(true);
    expect(ownsFocusedShortcut(main, focusedInPane(true))).toBe(false);
    expect(ownsFocusedShortcut(main, focusedInPane(false))).toBe(true);
    expect(ownsFocusedShortcut(sideChat, focusedInPane(false))).toBe(false);
    // Nothing focused belongs to the main chat.
    expect(ownsFocusedShortcut(main, document.body)).toBe(true);
    expect(ownsFocusedShortcut(undefined, null)).toBe(true);
  });
});
