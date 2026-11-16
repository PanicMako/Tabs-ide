import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@tabs/contracts";

import {
  deriveLatestContextWindowSnapshot,
  deriveProjectionContextWindowSnapshot,
  formatContextWindowTokens,
} from "./contextWindow";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.makeUnsafe("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });
});

describe("deriveProjectionContextWindowSnapshot", () => {
  const projection = (overrides: Record<string, unknown>) =>
    ({
      thread: { activeProviderThreadId: "pt1" },
      providerThreads: [],
      providerTurns: [],
      ...overrides,
    }) as never;

  it("uses the newest turn report of the active provider thread", () => {
    const snapshot = deriveProjectionContextWindowSnapshot(
      projection({
        providerTurns: [
          {
            providerThreadId: "pt1",
            tokenUsage: {
              usedTokens: 1000,
              maxTokens: 200000,
              updatedAt: "2026-11-15T10:00:00.000Z",
            },
          },
          {
            providerThreadId: "pt1",
            tokenUsage: {
              usedTokens: 50000,
              maxTokens: 200000,
              updatedAt: "2026-11-15T11:00:00.000Z",
            },
          },
          {
            providerThreadId: "other",
            tokenUsage: { usedTokens: 9, maxTokens: 10, updatedAt: "2026-11-15T12:00:00.000Z" },
          },
        ],
      }),
    );
    expect(snapshot?.usedTokens).toBe(50000);
    expect(snapshot?.remainingTokens).toBe(150000);
    expect(snapshot?.usedPercentage).toBe(25);
  });

  it("falls back to the provider thread's context usage", () => {
    const snapshot = deriveProjectionContextWindowSnapshot(
      projection({
        providerThreads: [
          {
            id: "pt1",
            updatedAt: "2026-11-15T10:00:00.000Z",
            contextUsage: { usedTokens: 4000, maxTokens: 8000 },
          },
        ],
      }),
    );
    expect(snapshot?.usedPercentage).toBe(50);
  });

  it("returns null when nothing has been reported", () => {
    expect(deriveProjectionContextWindowSnapshot(projection({}))).toBeNull();
    expect(deriveProjectionContextWindowSnapshot(null)).toBeNull();
  });
});
