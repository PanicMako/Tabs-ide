import { describe, expect, it } from "vitest";
import { stepProviderTab } from "./modelPickerNav";

const tabs = ["codex", "claudeAgent", "gemini"] as const;

describe("stepProviderTab", () => {
  it("moves to the next and previous provider and wraps", () => {
    expect(stepProviderTab(tabs, "codex", 1)).toBe("claudeAgent");
    expect(stepProviderTab(tabs, "gemini", 1)).toBe("codex");
    expect(stepProviderTab(tabs, "codex", -1)).toBe("gemini");
  });

  it("starts at an end when the pinned tab or nothing is active", () => {
    expect(stepProviderTab(tabs, "pinned", 1)).toBe("codex");
    expect(stepProviderTab(tabs, null, -1)).toBe("gemini");
  });

  it("does nothing with fewer than two providers", () => {
    expect(stepProviderTab(["codex"], "codex", 1)).toBeNull();
    expect(stepProviderTab([], null, 1)).toBeNull();
  });
});
