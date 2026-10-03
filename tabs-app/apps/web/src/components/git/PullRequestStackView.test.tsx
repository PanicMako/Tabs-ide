import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GitPullRequestStack } from "@tabs/contracts";
import { PullRequestStackView } from "./PullRequestStackView";

const sampleStack: GitPullRequestStack = {
  id: "STACK_50",
  number: 50,
  url: "https://github.com/acme/repo/stacks/50",
  base: "main",
  layers: [
    {
      number: 101,
      title: "Foundation layer",
      headBranch: "feature-part-1",
      headSha: "aaa1111",
      state: "merged",
    },
    {
      number: 102,
      title: "Core logic layer",
      headBranch: "feature-part-2",
      headSha: "bbb2222",
      state: "open",
    },
    {
      number: 103,
      title: "UI polish layer",
      headBranch: "feature-part-3",
      headSha: "ccc3333",
      state: "open",
    },
  ],
};

describe("PullRequestStackView", () => {
  it("renders stack header, position badge, and base branch", () => {
    const markup = renderToStaticMarkup(
      <PullRequestStackView stack={sampleStack} currentNumber={102} cwd="/repo" />,
    );

    expect(markup).toContain("Stack #50");
    expect(markup).toContain("Layer 2 of 3");
    expect(markup).toContain("main");
  });

  it("renders all layers with status badges and current indicator on active PR", () => {
    const markup = renderToStaticMarkup(
      <PullRequestStackView stack={sampleStack} currentNumber={102} cwd="/repo" />,
    );

    expect(markup).toContain("Foundation layer");
    expect(markup).toContain("Core logic layer");
    expect(markup).toContain("UI polish layer");

    expect(markup).toContain("Merged");
    expect(markup).toContain("Current");
    expect(markup).toContain('aria-current="true"');
  });

  it("renders action buttons for rebase and merge when enabled", () => {
    const markup = renderToStaticMarkup(
      <PullRequestStackView
        stack={sampleStack}
        currentNumber={102}
        cwd="/repo"
        canMerge={true}
        canRebase={true}
      />,
    );

    expect(markup).toContain("Rebase stack");
    expect(markup).toContain("Merge stack (1)");
  });

  it("disables merge button when current layer is merged or closed", () => {
    const markup = renderToStaticMarkup(
      <PullRequestStackView
        stack={sampleStack}
        currentNumber={101}
        cwd="/repo"
        canMerge={true}
        canRebase={true}
      />,
    );

    // Current layer is #101 which is "merged"
    expect(markup).not.toContain("Merge stack");
  });
});
