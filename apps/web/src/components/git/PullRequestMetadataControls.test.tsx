import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PullRequestReviewersSection,
  PullRequestLabelsSection,
  PullRequestActivityView,
} from "./PullRequestMetadataControls";

describe("PullRequestMetadataControls", () => {
  it("renders reviewers list and remove buttons when supported", () => {
    const reviewers = [
      { login: "alice", id: "1" },
      { login: "bob", id: "2" },
    ];
    const html = renderToStaticMarkup(
      <PullRequestReviewersSection
        reviewers={reviewers}
        supportsAction={(action) => action === "add_reviewer" || action === "remove_reviewer"}
        onAddReviewer={async () => {}}
        onRemoveReviewer={async () => {}}
        isPending={false}
        isOpen={true}
      />,
    );
    expect(html).toContain("@alice");
    expect(html).toContain("@bob");
    expect(html).toContain("Remove reviewer alice");
    expect(html).toContain("Add reviewer by username…");
  });

  it("renders labels list and add form", () => {
    const labels = [
      { name: "bug", color: "ff0000" },
      { name: "enhancement", color: "00ff00" },
    ];
    const html = renderToStaticMarkup(
      <PullRequestLabelsSection
        labels={labels}
        supportsAction={(action) => action === "add_label" || action === "remove_label"}
        onAddLabel={async () => {}}
        onRemoveLabel={async () => {}}
        isPending={false}
        isOpen={true}
      />,
    );
    expect(html).toContain("bug");
    expect(html).toContain("enhancement");
    expect(html).toContain("Remove label bug");
    expect(html).toContain("Add label name…");
  });

  it("renders formal reviews and activity comments", () => {
    const reviews = [
      {
        id: "r1",
        author: { login: "reviewer1" },
        state: "APPROVED",
        body: "LGTM!",
        submittedAt: "2026-09-12T00:00:00Z",
      },
    ];
    const comments = [
      {
        id: "c1",
        author: { login: "contributor1" },
        body: "Updated the tests.",
        createdAt: "2026-09-12T00:10:00Z",
      },
    ];
    const html = renderToStaticMarkup(
      <PullRequestActivityView reviews={reviews} comments={comments} />,
    );
    expect(html).toContain("Formal Reviews (1)");
    expect(html).toContain("@reviewer1");
    expect(html).toContain("APPROVED");
    expect(html).toContain("Conversation (1)");
    expect(html).toContain("@contributor1");
  });
});
