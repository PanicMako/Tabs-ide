import { describe, expect, it } from "vitest";
import { currentPullRequestNumber } from "./pullRequestNumber";

describe("currentPullRequestNumber", () => {
  it("falls back to the legacy linked pull request", () => {
    expect(currentPullRequestNumber({ linkedPullRequest: { number: 42 } })).toBe(42);
  });

  it("is null when the thread has no pull request", () => {
    expect(currentPullRequestNumber({})).toBeNull();
    expect(currentPullRequestNumber({ pullRequests: [], linkedPullRequest: null })).toBeNull();
  });
});
