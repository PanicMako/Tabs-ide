import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelTotals } from "@tabs/shared/usageMerge";
import type { UsageSummary } from "@tabs/contracts";

vi.mock("../../ui/dialog", () => {
  const Container = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogPanel: Container,
    DialogPopup: Container,
    DialogTitle: Container,
    DialogClose: Container,
  };
});

import { ModelDetailModal } from "./ModelDetailModal";

const mockModel: ModelTotals = {
  provider: "antigravity",
  model: "gemini-3.8-flash-n",
  costUsd: 0,
  totalTokens: 705_000_000,
  tokens: {
    uncachedInputTokens: 24_900_000,
    cachedInputTokens: 678_000_000,
    cacheCreationTokens: 0,
    outputTokens: 1_800_000,
    reasoningTokens: 856_000,
  },
  costShare: 0,
  tokenShare: 1,
  records: 4994,
  unpricedRecords: 4994,
  unpricedTokens: 705_000_000,
};

const mockSummary: UsageSummary = {
  contractVersion: 1,
  readAt: "2026-10-08T18:00:00.000Z",
  timeZone: "America/Los_Angeles",
  sinceDay: "2026-10-04" as any,
  untilDay: "2026-10-08" as any,
  buckets: [
    {
      day: "2026-10-06" as any,
      provider: "antigravity" as any,
      model: "gemini-3.8-flash-n",
      totals: {
        uncachedInputTokens: 10_000_000,
        cachedInputTokens: 200_000_000,
        cacheCreationTokens: 0,
        outputTokens: 600_000,
        reasoningTokens: 300_000,
      },
      costUsd: 0,
      cacheSavingsUsd: 0,
      costSource: "unpriced",
      sessions: 1,
      records: 1500,
      unpricedRecords: 1500,
    },
    {
      day: "2026-10-07" as any,
      provider: "antigravity" as any,
      model: "gemini-3.8-flash-n",
      totals: {
        uncachedInputTokens: 10_000_000,
        cachedInputTokens: 370_000_000,
        cacheCreationTokens: 0,
        outputTokens: 800_000,
        reasoningTokens: 400_000,
      },
      costUsd: 0,
      cacheSavingsUsd: 0,
      costSource: "unpriced",
      sessions: 1,
      records: 2500,
      unpricedRecords: 2500,
    },
    {
      day: "2026-10-08" as any,
      provider: "antigravity" as any,
      model: "gemini-3.8-flash-n",
      totals: {
        uncachedInputTokens: 4_900_000,
        cachedInputTokens: 108_000_000,
        cacheCreationTokens: 0,
        outputTokens: 400_000,
        reasoningTokens: 156_000,
      },
      costUsd: 0,
      cacheSavingsUsd: 0,
      costSource: "unpriced",
      sessions: 1,
      records: 994,
      unpricedRecords: 994,
    },
  ],
  sources: [],
  pricing: {} as any,
  scanDurationMs: 12,
};

describe("ModelDetailModal", () => {
  it("renders model details, stats, and token breakdown", () => {
    const html = renderToStaticMarkup(
      <ModelDetailModal
        model={mockModel}
        summary={mockSummary}
        onClose={vi.fn()}
        onSetPrice={vi.fn()}
      />,
    );

    expect(html).toContain("gemini-3.8-flash-n");
    expect(html).toContain("Antigravity");
    expect(html).toContain("Unpriced");
    expect(html).toContain("705M");
    expect(html).toContain("96.5%");
    expect(html).toContain("Set price");
  });

  it("aligns timeline with parentDays and renders smooth bezier paths and grid lines", () => {
    const parentDays = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];

    const html = renderToStaticMarkup(
      <ModelDetailModal
        model={mockModel}
        summary={mockSummary}
        timeWindow="7d"
        parentDays={parentDays}
        onClose={vi.fn()}
        onSetPrice={vi.fn()}
      />,
    );

    // Initial state: Full window (5 periods, 3 active)
    expect(html).toContain("Full window (5)");
    expect(html).toContain("Active only (3)");
    expect(html).toContain("5 periods");
    expect(html).toContain("· 3 active");

    // Contains svg bezier curve (C command in path d attribute)
    expect(html).toContain(" C ");
    // Contains dashed grid lines
    expect(html).toContain('stroke-dasharray="3 3"');
    // Contains gradient definitions
    expect(html).toContain('id="modelAreaGrad"');
    expect(html).toContain('id="modelLineGrad"');
  });
});
