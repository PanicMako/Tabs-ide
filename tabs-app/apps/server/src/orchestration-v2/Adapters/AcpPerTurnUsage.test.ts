import { describe, expect, it } from "vitest";

import { acpPerTurnPromptUsage } from "./AcpAdapterV2.ts";

const usage = (fields: Record<string, number>) =>
  ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, ...fields }) as never;

describe("acpPerTurnPromptUsage", () => {
  it("reports unavailable without a sample", () => {
    expect(acpPerTurnPromptUsage(undefined, false, "completed")).toEqual({
      usageScope: "main_agent",
      usageStatus: "unavailable",
      hasSubagents: false,
    });
  });

  it("maps the counters and marks only a completed turn complete", () => {
    const sample = usage({ inputTokens: 100, outputTokens: 20, cachedReadTokens: 40 });
    expect(acpPerTurnPromptUsage(sample, true, "completed")).toMatchObject({
      usageStatus: "complete",
      hasSubagents: true,
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 40,
    });
    expect(acpPerTurnPromptUsage(sample, false, "interrupted").usageStatus).toBe("partial");
  });

  it("adds Gemini's separately reported cache reads and thoughts to input and output", () => {
    expect(
      acpPerTurnPromptUsage(
        usage({ inputTokens: 60, outputTokens: 20, cachedReadTokens: 40, thoughtTokens: 5 }),
        false,
        "completed",
        true,
      ),
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: 25,
      cachedInputTokens: 40,
      reasoningTokens: 5,
    });
  });

  it("clamps subset counters that exceed their parent", () => {
    const result = acpPerTurnPromptUsage(
      usage({
        inputTokens: 10,
        outputTokens: 4,
        cachedReadTokens: 50,
        thoughtTokens: 9,
        cachedWriteTokens: 3,
      }),
      false,
      "completed",
    );
    expect(result).toMatchObject({ cachedInputTokens: 10, reasoningTokens: 4 });
    expect(result.cacheCreationTokens).toBe(0);
  });
});
