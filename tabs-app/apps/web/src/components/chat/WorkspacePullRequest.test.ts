import type { GitResolvedPullRequest } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import { effectiveChecksState, pullRequestReadiness } from "./WorkspacePullRequest";

const base = {
  number: 39,
  title: "Improve workspace",
  url: "https://example.test/39",
  baseBranch: "main",
  headBranch: "feature",
  state: "open",
} as GitResolvedPullRequest;

describe("pullRequestReadiness", () => {
  it("does not call an open PR ready when checks and reviews are unknown", () => {
    expect(pullRequestReadiness(base)).toBe("Open");
  });

  it("requires passing checks, approval and mergeability for Ready", () => {
    expect(
      pullRequestReadiness({
        ...base,
        checksState: "passing",
        reviewDecision: "approved",
        mergeability: "mergeable",
      }),
    ).toBe("Ready");
  });

  it("identifies ready using checks array rollup when checksState is not explicitly set", () => {
    expect(
      pullRequestReadiness({
        ...base,
        checks: [
          { name: "test", status: "completed", conclusion: "success" },
          { name: "build", status: "completed", conclusion: "success" },
        ],
        reviewDecision: "approved",
        mergeability: "mergeable",
      }),
    ).toBe("Ready");
  });

  it("shows draft, conflicts and failed checks instead of Ready", () => {
    expect(pullRequestReadiness({ ...base, isDraft: true })).toBe("Draft");
    expect(pullRequestReadiness({ ...base, mergeability: "conflicting" })).toBe("Conflicts");
    expect(pullRequestReadiness({ ...base, checksState: "failing" })).toBe("Checks failing");
    expect(
      pullRequestReadiness({
        ...base,
        checks: [{ name: "ci", status: "completed", conclusion: "failure" }],
      }),
    ).toBe("Checks failing");
  });

  it("reports changes requested when review decision requests changes", () => {
    expect(
      pullRequestReadiness({
        ...base,
        checksState: "passing",
        reviewDecision: "changes_requested",
        mergeability: "mergeable",
      }),
    ).toBe("Changes requested");
  });

  it("reports checks running when checks are pending", () => {
    expect(
      pullRequestReadiness({
        ...base,
        checksState: "pending",
        reviewDecision: "approved",
        mergeability: "mergeable",
      }),
    ).toBe("Checks running");

    expect(
      pullRequestReadiness({
        ...base,
        checks: [{ name: "ci", status: "in_progress" }],
        reviewDecision: "approved",
        mergeability: "mergeable",
      }),
    ).toBe("Checks running");
  });

  it("reports review needed when review is required", () => {
    expect(
      pullRequestReadiness({
        ...base,
        checksState: "passing",
        reviewDecision: "review_required",
        mergeability: "mergeable",
      }),
    ).toBe("Review needed");
  });

  it("handles closed and merged states accurately", () => {
    expect(pullRequestReadiness({ ...base, state: "merged" })).toBe("Merged");
    expect(pullRequestReadiness({ ...base, state: "closed" })).toBe("Closed");
  });

  it("does not report Ready when mergeability is unknown or checks are unknown", () => {
    expect(
      pullRequestReadiness({
        ...base,
        checksState: "passing",
        reviewDecision: "approved",
        mergeability: "unknown",
      }),
    ).toBe("Open");

    expect(
      pullRequestReadiness({
        ...base,
        checksState: undefined,
        reviewDecision: "approved",
        mergeability: "mergeable",
      }),
    ).toBe("Open");
  });
});

describe("effectiveChecksState", () => {
  it("prefers explicit checksState if provided", () => {
    expect(effectiveChecksState({ ...base, checksState: "passing" })).toBe("passing");
    expect(effectiveChecksState({ ...base, checksState: "failing" })).toBe("failing");
    expect(effectiveChecksState({ ...base, checksState: "pending" })).toBe("pending");
  });

  it("computes rollup from checks array when checksState is omitted", () => {
    expect(
      effectiveChecksState({
        ...base,
        checks: [
          { name: "lint", status: "completed", conclusion: "success" },
          { name: "test", status: "completed", conclusion: "failure" },
        ],
      }),
    ).toBe("failing");

    expect(
      effectiveChecksState({
        ...base,
        checks: [{ name: "test", status: "queued" }],
      }),
    ).toBe("pending");

    expect(
      effectiveChecksState({
        ...base,
        checks: [{ name: "test", status: "completed", conclusion: "success" }],
      }),
    ).toBe("passing");
  });

  it("returns null when no checks or checksState exist", () => {
    expect(effectiveChecksState(base)).toBeNull();
    expect(effectiveChecksState({ ...base, checks: [] })).toBeNull();
  });
});
