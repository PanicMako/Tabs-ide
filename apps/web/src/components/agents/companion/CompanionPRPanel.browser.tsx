import "../../../index.css";
import "./companion.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PRsPanel } from "../../git/PRsPanel";
const fixture = vi.hoisted(() => ({
  create: vi.fn(),
  external: vi.fn(async () => {}),
  pr: {
    number: 7,
    title: "Keep browser navigation and address history in sync",
    state: "open",
    headBranch: "fix/browser-navigation",
    baseBranch: "main",
    url: "https://github.com/example/tabs/pull/7",
    provider: "github",
    author: { login: "developer" },
    checksState: "passing",
    changedFiles: 10,
    additions: 473,
    deletions: 257,
    labels: [],
  },
  capabilities: {
    create: true,
    search: true,
    actions: ["merge", "enable_auto_merge", "close"],
    mergeMethods: ["squash", "merge"],
  },
}));
vi.mock("../../git/gitApiContext", () => ({
  useGitApi: () => ({ shell: { openExternal: fixture.external } }),
  useGitScopeKey: () => "pr-fixture",
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => [],
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  Link: () => null,
}));
vi.mock("../../../state/scopedStateStore", async () => {
  const { useState } = await import("react");
  return {
    useProjectGitState: () => {
      const [value, setValue] = useState({ prViewMode: "all", prFilter: "all" });
      return [
        value,
        (next: Partial<typeof value>) => setValue((current) => ({ ...current, ...next })),
      ];
    },
  };
});
vi.mock("../../../lib/gitReactQuery", () => ({
  gitAllPullRequestsQueryOptions: (_cwd: string, state: string) => ({
    queryKey: ["prs", state],
    queryFn: async () => ({ pullRequests: [fixture.pr], capabilities: fixture.capabilities }),
  }),
  gitResolvePullRequestQueryOptions: ({ reference }: { reference: string | null }) => ({
    queryKey: ["pr", reference],
    enabled: reference !== null,
    queryFn: async () => ({ pullRequest: fixture.pr, capabilities: fixture.capabilities }),
  }),
}));
it.each([360, 900])("keeps PR summaries readable and actions accessible at %ipx", async (width) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <div className="companion-workspace companion-pr" style={{ width }}>
        <div className="git-tool-v2">
          <PRsPanel compact cwd="/workspace" branchName="main" onOpenCreatePR={fixture.create} />
        </div>
      </div>
    </QueryClientProvider>,
  );
  try {
    await expect.element(page.getByText(fixture.pr.title, { exact: true })).toBeVisible();
    const card = document.querySelector(".companion-pr-card")!;
    const title = document.querySelector(".companion-pr-title")!;
    expect(title.getBoundingClientRect().width).toBeGreaterThan(width === 360 ? 180 : 600);
    expect(card.scrollWidth).toBeLessThanOrEqual(Math.ceil(card.getBoundingClientRect().width));
    expect(document.querySelector(".companion-heading")).toBeNull();
    await page.getByRole("radio", { name: "Open", exact: true }).click();
    await expect
      .element(page.getByRole("radio", { name: "Open", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "New PR", exact: true }).click();
    expect(fixture.create).toHaveBeenCalled();
    await page.getByRole("button", { name: "More actions for pull request 7" }).click();
    await expect.element(page.getByRole("button", { name: "Enable auto-merge…" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open on GitHub" }).click();
    expect(fixture.external).toHaveBeenCalledWith(fixture.pr.url);
  } finally {
    await view.unmount();
    client.clear();
  }
});
