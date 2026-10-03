import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GitPullRequestCheck } from "@tabs/contracts";
import {
  summarizePullRequestChecks,
  PullRequestChecksRollupBadge,
  PullRequestChecksView,
} from "./PullRequestChecksSummary";

describe("PullRequestChecksSummary", () => {
  const sampleChecks: GitPullRequestCheck[] = [
    {
      name: "Build & Test",
      workflowName: "CI",
      status: "completed",
      conclusion: "success",
      detailsUrl: "https://github.com/org/repo/actions/runs/123",
    },
    {
      name: "Lint & Format",
      workflowName: "Hygiene",
      status: "completed",
      conclusion: "failure",
      detailsUrl: "https://github.com/org/repo/actions/runs/124",
    },
    {
      name: "E2E Tests",
      workflowName: "CI",
      status: "in_progress",
      conclusion: undefined,
    },
  ];

  it("summarizes check statistics correctly", () => {
    const stats = summarizePullRequestChecks(sampleChecks);
    expect(stats.total).toBe(3);
    expect(stats.passed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.state).toBe("failure");
  });

  it("renders rollup badge with failing count when there is a failed check", () => {
    const html = renderToStaticMarkup(<PullRequestChecksRollupBadge checks={sampleChecks} />);
    expect(html).toContain("1 failing");
  });

  it("renders full checks view with filter tabs and check names", () => {
    const html = renderToStaticMarkup(<PullRequestChecksView checks={sampleChecks} />);
    expect(html).toContain("Build &amp; Test");
    expect(html).toContain("Lint &amp; Format");
    expect(html).toContain("E2E Tests");
    expect(html).toContain("Failed (1)");
    expect(html).toContain("Pending (1)");
    expect(html).toContain("Passed (1)");
  });
});
