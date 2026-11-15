import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PullRequestReviewGuide } from "@tabs/contracts";

import { PullRequestGuideTab } from "./PullRequestGuideTab";

const PATCH = ["@@ -1,2 +1,3 @@", " keep", "+added line", " tail"].join("\n");

const guide: PullRequestReviewGuide = {
  headSha: "abc",
  generatedAt: "2026-11-15T10:00:00Z",
  modelSelection: { instanceId: "codex", model: "m" } as PullRequestReviewGuide["modelSelection"],
  stops: [
    {
      title: "Core change",
      summary: "Adds the line.",
      attention: { kind: "risk", note: "Check the edge." },
      excerpts: [{ path: "a.ts", side: "new", start: 2, end: 2, caption: "The new line" }],
      files: [{ path: "b.ts", note: "Follows" }],
      notes: [{ path: "a.ts", line: 2, title: "Looks right", body: "Matches the spec." }],
      questions: ["Why not reuse X?"],
    },
    {
      title: "Second",
      summary: "",
      attention: null,
      excerpts: [],
      files: [],
      notes: [],
      questions: [],
    },
  ],
};

const base = {
  run: null,
  currentHeadSha: "abc",
  isLoading: false,
  writing: false,
  error: null,
  onWrite: () => undefined,
  patchOf: (path: string) => (path === "a.ts" ? PATCH : null),
  onOpenFile: () => undefined,
};

describe("PullRequestGuideTab", () => {
  it("offers to write a guide when there is none, and shows a failure with a retry", () => {
    const empty = renderToStaticMarkup(<PullRequestGuideTab {...base} guide={null} />);
    expect(empty).toContain("Write a review guide");
    const failed = renderToStaticMarkup(
      <PullRequestGuideTab {...base} guide={null} run={{ _tag: "Failed", detail: "No model" }} />,
    );
    expect(failed).toContain("No model");
    expect(failed).toContain("Try again");
  });

  it("shows the first stop with its excerpt lines, note, attention and questions", () => {
    const html = renderToStaticMarkup(<PullRequestGuideTab {...base} guide={guide} />);
    expect(html).toContain("Core change");
    expect(html).toContain("+added line");
    expect(html).toContain("Looks right");
    expect(html).toContain("Check the edge.");
    expect(html).toContain("Why not reuse X?");
    expect(html).toContain("1 of 2");
  });

  it("says when the guide was written for an earlier head", () => {
    const html = renderToStaticMarkup(
      <PullRequestGuideTab {...base} guide={guide} currentHeadSha="def" />,
    );
    expect(html).toContain("earlier version");
    expect(html).toContain("Rewrite for the latest");
  });
});
