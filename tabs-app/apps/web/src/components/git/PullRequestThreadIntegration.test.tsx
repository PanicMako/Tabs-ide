import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadId } from "@tabs/contracts";
import {
  PullRequestThreadIntegration,
  formatReviewFixPrompt,
} from "./PullRequestThreadIntegration";

describe("PullRequestThreadIntegration", () => {
  const samplePr = {
    number: 101,
    title: "Implement review workflow",
    url: "https://github.com/org/repo/pull/101",
    provider: "github",
    repository: "org/repo",
  };

  const sampleThreads = [
    {
      id: ThreadId.makeUnsafe("th-1"),
      title: "Thread for PR 101",
      branch: "feature/review",
      pullRequests: [
        {
          host: "github.com",
          repository: "org/repo",
          number: 101,
          url: "https://github.com/org/repo/pull/101",
          source: "manual" as const,
        },
      ],
    },
    {
      id: ThreadId.makeUnsafe("th-2"),
      title: "Another thread",
      branch: "main",
    },
  ];

  it("formats review fix prompt from unresolved review threads", () => {
    const prompt = formatReviewFixPrompt(samplePr, [
      {
        id: "t1",
        path: "src/utils.ts",
        line: 15,
        side: "right",
        resolved: false,
        comments: [
          {
            id: "c1",
            author: { login: "alice" },
            body: "Add null check here.",
            createdAt: "2026-09-12T00:00:00Z",
          },
        ],
      },
    ]);

    expect(prompt).toContain("pull request #101");
    expect(prompt).toContain("src/utils.ts (line 15)");
    expect(prompt).toContain("@alice");
    expect(prompt).toContain("Add null check here.");
  });

  it("renders linked threads and unlinked thread options", () => {
    const html = renderToStaticMarkup(
      <PullRequestThreadIntegration
        pr={samplePr}
        threads={sampleThreads as any}
        onOpenThread={() => {}}
        onLinkThread={async () => {}}
        onUnlinkThread={async () => {}}
        onCreateFixThread={() => {}}
      />,
    );

    expect(html).toContain("Linked Agent Threads (1)");
    expect(html).toContain("Thread for PR 101");
    expect(html).toContain("Link another agent thread…");
  });
});
