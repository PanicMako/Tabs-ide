import type { GitResolvedPullRequest } from "@tabs/contracts";
import { expect, it } from "vitest";
import { pullRequestReadiness } from "./WorkspacePullRequest";
const base = {
  number: 39,
  title: "Improve workspace",
  url: "https://example.test/39",
  baseBranch: "main",
  headBranch: "feature",
  state: "open",
} as GitResolvedPullRequest;
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
it("shows draft, conflicts and failed checks instead of Ready", () => {
  expect(pullRequestReadiness({ ...base, isDraft: true })).toBe("Draft");
  expect(pullRequestReadiness({ ...base, mergeability: "conflicting" })).toBe("Conflicts");
  expect(pullRequestReadiness({ ...base, checksState: "failing" })).toBe("Checks failing");
});
