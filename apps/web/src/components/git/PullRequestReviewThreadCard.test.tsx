import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GitPullRequestReviewThread } from "@tabs/contracts";
import { PullRequestReviewThreadCard } from "./PullRequestReviewThreadCard";

const sampleThread = (resolved = false): GitPullRequestReviewThread => ({
  id: "PRRT_123",
  path: "src/index.ts",
  line: 42,
  side: "right",
  resolved,
  outdated: false,
  comments: [
    {
      id: "PRRC_1",
      author: { login: "alice" },
      body: "Please check this edge case",
      createdAt: "2026-09-12T00:00:00Z",
      reactions: [{ content: "THUMBS_UP", count: 2, viewerHasReacted: false }],
    },
  ],
});

describe("PullRequestReviewThreadCard", () => {
  it("renders open thread expanded and displays comment content and author", () => {
    const thread = sampleThread(false);
    const markup = renderToStaticMarkup(
      <PullRequestReviewThreadCard
        thread={thread}
        prNumber={42}
        cwd="/workspace"
        supportsAction={() => true}
        onMutate={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(markup).toContain("Open");
    expect(markup).toContain("@alice");
    expect(markup).toContain("Please check this edge case");
    expect(markup).toContain("Resolve");
  });

  it("renders resolved thread with resolved indicator", () => {
    const thread = sampleThread(true);
    const markup = renderToStaticMarkup(
      <PullRequestReviewThreadCard
        thread={thread}
        prNumber={42}
        cwd="/workspace"
        supportsAction={() => true}
        onMutate={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(markup).toContain("Resolved");
    expect(markup).toContain("Unresolve");
  });

  it("renders fix in thread button when callback provided", () => {
    const thread = sampleThread(false);
    const markup = renderToStaticMarkup(
      <PullRequestReviewThreadCard
        thread={thread}
        prNumber={42}
        cwd="/workspace"
        supportsAction={() => true}
        onMutate={vi.fn().mockResolvedValue(true)}
        onFixInThread={vi.fn()}
      />,
    );

    expect(markup).toContain("Fix in thread");
  });
});
