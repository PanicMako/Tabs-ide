import { describe, expect, it } from "vitest";

import { getVisibleCustomActivityBarItems } from "./CodeActivityRail.logic";

describe("getVisibleCustomActivityBarItems", () => {
  it("keeps main activity-bar extensions ordered and excludes auxiliary assistants", () => {
    const items = getVisibleCustomActivityBarItems([
      {
        id: "assistant",
        label: "ChatGPT",
        commandId: "assistant.open",
        location: "auxiliaryBar",
        icon: { type: "themeIcon", value: "chat" },
        order: 1,
      },
      {
        id: "review",
        label: "CodeRabbit",
        commandId: "review.open",
        location: "sidebar",
        icon: { type: "themeIcon", value: "comment-discussion" },
        order: 3,
      },
      {
        id: "claude",
        label: "Claude Code",
        commandId: "claude.open",
        location: "sidebar",
        icon: { type: "themeIcon", value: "sparkle" },
        order: 2,
      },
    ]);

    expect(items.map((item) => item.id)).toEqual(["claude", "review"]);
  });
});
