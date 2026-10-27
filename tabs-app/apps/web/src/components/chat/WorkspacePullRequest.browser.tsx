import "../../index.css";
import type { GitResolvedPullRequest } from "@tabs/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorkspacePullRequest } from "./WorkspacePullRequest";

const calls = vi.hoisted(() => ({
  openExternal: vi.fn(),
}));

vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    shell: {
      openExternal: calls.openExternal,
    },
  }),
}));

const basePr: GitResolvedPullRequest = {
  number: 42,
  title: "Add awesome feature",
  url: "https://github.com/org/repo/pull/42",
  baseBranch: "main",
  headBranch: "feature/awesome",
  state: "open",
  isDraft: false,
};

const baseSummary = {
  number: 42,
  title: "Add awesome feature",
  url: "https://github.com/org/repo/pull/42",
  baseBranch: "main",
  headBranch: "feature/awesome",
  state: "open" as const,
};

describe("WorkspacePullRequest UI", () => {
  beforeEach(() => {
    calls.openExternal.mockReset();
    calls.openExternal.mockResolvedValue(undefined);
  });

  it("renders single PR with checks and readiness", async () => {
    const view = await render(
      <WorkspacePullRequest
        summary={baseSummary}
        details={{
          ...basePr,
          checksState: "passing",
          reviewDecision: "approved",
          mergeability: "mergeable",
        }}
      />,
    );
    try {
      await expect.element(page.getByText("Add awesome feature")).toBeVisible();
      await expect.element(page.getByText("#42")).toBeVisible();
      await expect.element(page.getByText("Ready")).toBeVisible();

      await page.getByRole("button", { name: "Open pull request #42" }).click();
      expect(calls.openExternal).toHaveBeenCalledWith("https://github.com/org/repo/pull/42");
    } finally {
      await view.unmount();
    }
  });

  it("renders multiple PRs and forked repository indicator", async () => {
    const pr1: GitResolvedPullRequest = {
      ...basePr,
      number: 42,
      title: "First linked PR",
      checksState: "passing",
      reviewDecision: "approved",
      mergeability: "mergeable",
    };
    const pr2: GitResolvedPullRequest = {
      ...basePr,
      number: 43,
      title: "Fork PR from contributor",
      url: "https://github.com/org/repo/pull/43",
      headRepositoryNameWithOwner: "contributor/repo",
      mergeability: "conflicting",
    };

    const view = await render(
      <WorkspacePullRequest summary={baseSummary} pullRequests={[pr1, pr2]} />,
    );
    try {
      await expect.element(page.getByText("First linked PR")).toBeVisible();
      await expect.element(page.getByText("Fork PR from contributor")).toBeVisible();
      await expect.element(page.getByText("contributor/repo")).toBeVisible();
      await expect.element(page.getByText("Conflicts")).toBeVisible();
    } finally {
      await view.unmount();
    }
  });

  it("renders live checks unavailable notice and respects readonly", async () => {
    const view = await render(
      <WorkspacePullRequest
        summary={baseSummary}
        details={basePr}
        unavailable={true}
        readonly={true}
      />,
    );
    try {
      await expect.element(page.getByText("Live checks unavailable")).toBeVisible();
      const button = page.getByRole("button", { name: "Open pull request #42" });
      await expect.element(button).toBeDisabled();
    } finally {
      await view.unmount();
    }
  });
});
