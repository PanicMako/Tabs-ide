import "../../index.css";
import type { GitResolvedPullRequest } from "@tabs/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorkspacePullRequest } from "./WorkspacePullRequest";
import { WorkspacePullRequests } from "./WorkspacePullRequests";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { pullRequestSnapshotKey, writePullRequestSnapshot } from "../../lib/pullRequestSnapshot";

const calls = vi.hoisted(() => ({
  openExternal: vi.fn(),
  resolvePullRequest: vi.fn(),
  environments: [] as Array<string | undefined>,
}));

vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async (environmentId?: string) => {
    calls.environments.push(environmentId);
    return {
      git: { resolvePullRequest: calls.resolvePullRequest },
      shell: {
        openExternal: calls.openExternal,
      },
    };
  },
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
    calls.resolvePullRequest.mockReset();
    calls.environments.length = 0;
  });

  it("resolves every visible linked PR on its owning environment", async () => {
    calls.resolvePullRequest.mockImplementation(async ({ reference }: { reference: string }) => ({
      pullRequest: {
        ...basePr,
        number: reference.endsWith("43") ? 43 : 42,
        url: reference,
        title: reference.endsWith("43") ? "Second live PR" : "First live PR",
      },
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await render(
      <QueryClientProvider client={client}>
        <WorkspacePullRequests
          cwd="/same-path"
          environmentId="remote-machine"
          links={[42, 43, 44].map((number) => ({
            host: "github.com",
            repository: "org/repo",
            number,
            url: `https://github.com/org/repo/pull/${number}`,
            source: number === 44 ? "stack-dismissed" : "manual",
            linkedAt: "2026-10-29T00:00:00Z",
            snapshot: null,
            stack: null,
          }))}
        />
      </QueryClientProvider>,
    );
    try {
      await expect.element(page.getByText("First live PR")).toBeVisible();
      await expect.element(page.getByText("Second live PR")).toBeVisible();
      expect(calls.resolvePullRequest.mock.calls.map(([input]) => input.reference).sort()).toEqual([
        basePr.url,
        "https://github.com/org/repo/pull/43",
      ]);
      expect(calls.environments.every((id) => id === "remote-machine")).toBe(true);
      await page.getByRole("button", { name: "Open pull request #43" }).click();
      expect(calls.openExternal).toHaveBeenCalledWith("https://github.com/org/repo/pull/43");
    } finally {
      await view.unmount();
      client.clear();
    }
  });

  it("does not present cached readiness as verified after a failed refresh", async () => {
    const view = await render(
      <WorkspacePullRequest
        summary={baseSummary}
        details={{
          ...basePr,
          checksState: "passing",
          reviewDecision: "approved",
          mergeability: "mergeable",
        }}
        unavailable
      />,
    );
    try {
      await expect.element(page.getByText("Status unavailable")).toBeVisible();
      await expect.element(page.getByText("Ready", { exact: true })).not.toBeInTheDocument();
    } finally {
      await view.unmount();
    }
  });

  it("keeps a persisted Ready snapshot unverified while live lookup is pending", async () => {
    const ref = { environmentId: "cached-remote", cwd: "/cached-project", reference: basePr.url };
    writePullRequestSnapshot(ref, {
      pullRequest: {
        ...basePr,
        checksState: "passing",
        reviewDecision: "approved",
        mergeability: "mergeable",
      },
      capabilities: {
        provider: "github",
        diff: true,
        create: true,
        search: true,
        actions: ["merge", "close"],
        mergeMethods: ["merge", "squash"],
      },
    });
    calls.resolvePullRequest.mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient();
    const view = await render(
      <QueryClientProvider client={client}>
        <WorkspacePullRequests
          cwd={ref.cwd}
          environmentId={ref.environmentId}
          links={[
            {
              host: "github.com",
              repository: "org/repo",
              number: 42,
              url: basePr.url,
              source: "manual",
              linkedAt: "2026-10-29T00:00:00Z",
              snapshot: null,
              stack: null,
            },
          ]}
        />
      </QueryClientProvider>,
    );
    try {
      await expect.element(page.getByText(basePr.title)).toBeVisible();
      await expect.element(page.getByText("Status unavailable")).toBeVisible();
      await expect.element(page.getByText("Ready", { exact: true })).not.toBeInTheDocument();
    } finally {
      await view.unmount();
      client.clear();
      localStorage.removeItem(pullRequestSnapshotKey(ref));
    }
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
