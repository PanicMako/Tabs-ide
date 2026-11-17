import { describe, expect, it } from "vitest";
import { describeCursorRunFailure } from "./cursorRunFailure.ts";

describe("describeCursorRunFailure", () => {
  it("explains a named model that failed without a reason as a plan limit", () => {
    const failure = describeCursorRunFailure({ requestedModel: "claude-4.5-sonnet" });
    expect(failure.planRestricted).toBe(true);
    expect(failure.message).toContain("only runs Auto");
    expect(failure.message).toContain("claude-4.5-sonnet");
  });

  it("keeps Cursor's own wording when it names the plan", () => {
    const failure = describeCursorRunFailure({
      requestedModel: "gpt-5",
      error: { message: "This model requires a Pro plan", code: "plan_required" },
    });
    expect(failure.planRestricted).toBe(true);
    expect(failure.message).toContain("Cursor said: This model requires a Pro plan");
    expect(failure.code).toBe("plan_required");
  });

  it("passes other named-model errors through unchanged", () => {
    const failure = describeCursorRunFailure({
      requestedModel: "gpt-5",
      error: { message: "Context window exceeded" },
    });
    expect(failure).toEqual({
      message: "Context window exceeded",
      code: null,
      planRestricted: false,
    });
  });

  it("never blames the plan for Auto", () => {
    expect(describeCursorRunFailure({ requestedModel: "auto" })).toEqual({
      message: "Cursor ended the run with an error and gave no reason.",
      code: null,
      planRestricted: false,
    });
  });
});
