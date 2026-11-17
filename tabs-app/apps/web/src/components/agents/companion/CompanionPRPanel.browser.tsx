import "../../../index.css";
import "./designs/designs.css";
import "./companion.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PRsPanel } from "../../git/PRsPanel";
const fixture = vi.hoisted(() => ({
  create: vi.fn(),
  external: vi.fn(async () => {}),
  openLink: vi.fn(async () => "app" as const),
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
vi.mock("../../../browserLinkTarget", async (original) => ({
  ...(await original<typeof import("../../../browserLinkTarget")>()),
  openLink: fixture.openLink,
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
  PULL_REQUEST_FIRST_PAGE: 20,
  gitAllPullRequestsQueryOptions: (_cwd: string, state: string) => ({
    queryKey: ["prs", state],
    queryFn: async () => ({ pullRequests: [fixture.pr], capabilities: fixture.capabilities }),
  }),
  gitResolvePullRequestQueryOptions: ({ reference }: { reference: string | null }) => ({
    queryKey: ["pr", reference],
    enabled: reference !== null,
    queryFn: async () => ({ pullRequest: fixture.pr, capabilities: fixture.capabilities }),
  }),
  gitEnvironmentQueryOptions: (_cwd: string | null) => ({
    queryKey: ["git-environment", _cwd],
    queryFn: async () => ({ gitHub: { activeLogin: "developer", accounts: [] } }),
  }),
}));
it.each([360, 900])("keeps PR summaries readable and actions accessible at %ipx", async (width) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <div
        data-companion-design="grouped"
        className="companion-workspace companion-pr"
        style={{ width }}
      >
        <div className="git-tool-v2">
          <PRsPanel compact cwd="/workspace" branchName="main" onOpenCreatePR={fixture.create} />
        </div>
      </div>
    </QueryClientProvider>,
  );
  try {
    await expect.element(page.getByText(fixture.pr.title, { exact: true })).toBeVisible();
    // One quiet row per pull request: the title keeps the room and nothing spills sideways.
    const row = document.querySelector<HTMLElement>(".pr-row")!;
    const title = document.querySelector<HTMLElement>(".pr-row-text")!;
    expect(title.getBoundingClientRect().width).toBeGreaterThan(width === 360 ? 150 : 500);
    expect(row.scrollWidth).toBeLessThanOrEqual(Math.ceil(row.getBoundingClientRect().width));
    // Filters and New PR share the first row instead of wrapping onto one of their own.
    const create = page.getByRole("button", { name: "New PR", exact: true }).element();
    const scope = page.getByRole("button", { name: "This branch" }).element();
    if (width > 360)
      expect(
        Math.abs(create.getBoundingClientRect().top - scope.getBoundingClientRect().top),
      ).toBeLessThan(4);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Open", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "New PR", exact: true }).click();
    expect(fixture.create).toHaveBeenCalled();
    await page.getByRole("button", { name: "More actions for pull request 7" }).click();
    await expect.element(page.getByRole("button", { name: "Enable auto-merge…" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open on GitHub" }).click();
    // PR links follow the "Open links in" setting like every other link.
    expect(fixture.openLink).toHaveBeenCalledWith(fixture.pr.url);
  } finally {
    await view.unmount();
    client.clear();
  }
});
