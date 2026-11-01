import { savePinnedBranches } from "../git/pinnedBranches";
import { gitWorkspaceScopeKey } from "../git/gitApiContext";
import { useState } from "react";
import { useWorkspaceActionsState } from "./workspaceActionsState";
import "../../index.css";
import { ThreadId } from "@tabs/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ChatHeader } from "./ChatHeader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const branchCalls = vi.hoisted(() => ({ checkout: vi.fn(async (_input: unknown) => ({})) }));

beforeEach(() => {
  branchCalls.checkout.mockClear();
  useWorkspaceActionsState.setState({ entries: {} });
});

vi.mock("../../hooks/useThreadWorkspaceContext", () => ({
  useThreadWorkspaceContext: () => ({
    activeProject: { cwd: "/repo/layout" },
    activeWorktreePath: null,
    hasServerThread: true,
    effectiveEnvMode: "local",
    prepareBranchChange: async () => true,
    setThreadBranch: async () => true,
  }),
}));

vi.mock("~/connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    git: {
      listBranches: async () => ({
        branches: [
          { name: "main", current: false },
          { name: "codex/t3-parity-antigravity-very-long-branch-name", current: false },
        ],
      }),
      checkout: branchCalls.checkout,
      watchedBranchStatuses: async () => ({
        branches: [
          { name: "main", aheadCount: 48, behindCount: 0 },
          {
            name: "codex/t3-parity-antigravity-very-long-branch-name",
            aheadCount: 0,
            behindCount: 11,
          },
        ],
      }),
    },
  }),
}));

vi.mock("../../hooks/useCheckoutPullRequest", () => ({
  useCheckoutPullRequest: () => ({
    data: {
      pullRequest: {
        number: 39,
        title: "Reduce startup overhead and fix editable developer instructions",
        url: "https://example.com/pr/39",
        state: "open",
        isDraft: true,
      },
    },
    isError: false,
  }),
}));

vi.mock("../ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("../GitActionsControl", () => ({ default: () => <button>Commit &amp; push</button> }));
vi.mock("./OpenInPicker", () => ({ OpenInPicker: () => <button>Open in editor</button> }));
vi.mock("~/state/vcs", () => ({
  useVcs: () => ({
    status: { branch: "feature/design", workingTree: { insertions: 12, deletions: 3 } },
    error: null,
  }),
}));

it("shows workspace actions directly and allows the card to be tucked away", async () => {
  const onRunScript = vi.fn();
  const script = {
    id: "lint",
    name: "Lint" + "long".repeat(100),
    command: "bun lint",
    icon: "lint" as const,
    runOnWorktreeCreate: false,
  };
  const onToggleDiff = vi.fn();
  const onToggleTerminal = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <ChatHeader
        activeThreadId={ThreadId.makeUnsafe("design-test")}
        activeThreadTitle="Design work"
        activeProjectName="tabs"
        isGitRepo
        openInCwd="/repo/tabs"
        keybindings={[]}
        availableEditors={[]}
        terminalAvailable
        terminalOpen={false}
        terminalToggleShortcutLabel={null}
        diffToggleShortcutLabel={null}
        gitCwd="/repo/tabs"
        diffOpen={false}
        onToggleTerminal={onToggleTerminal}
        onToggleDiff={onToggleDiff}
        scripts={[script]}
        onRunScript={onRunScript}
      />
    </QueryClientProvider>,
  );
  try {
    await page.getByRole("button", { name: "Toggle workspace actions" }).click();
    await expect.element(page.getByRole("region", { name: "Workspace actions" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Toggle diff panel" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Commit & push" })).toBeVisible();
    const card = document.querySelector<HTMLElement>('[aria-label="Workspace actions"]')!;
    const lastAction = page.getByRole("button", { name: "Divergence space Compare all →" });
    await expect.element(lastAction).toBeVisible();
    const cardRect = card.getBoundingClientRect();
    const lastRect = [...card.querySelectorAll("button")].at(-1)!.getBoundingClientRect();
    expect(lastRect.bottom).toBeLessThanOrEqual(cardRect.bottom + 1);
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
    await page.getByRole("button", { name: "Changes +12 −3" }).click();
    expect(onToggleDiff).toHaveBeenCalledOnce();
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    const scriptButton = page.getByRole("button", { name: `Run ${script.name}`, exact: true });
    await scriptButton.click();
    expect(onRunScript).toHaveBeenCalledExactlyOnceWith(script);
    const scripts = document.querySelector<HTMLElement>('[aria-label="Project scripts"]')!;
    expect(scripts.scrollWidth).toBeLessThanOrEqual(scripts.clientWidth + 1);
    await page.getByRole("button", { name: "Toggle terminal drawer" }).click();
    expect(onToggleTerminal).toHaveBeenCalledOnce();
    const toggle = page.getByRole("button", { name: "Toggle workspace actions" });
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(page.getByRole("region", { name: "Workspace actions" }))
      .not.toBeInTheDocument();
    await toggle.click();
    await expect.element(page.getByRole("region", { name: "Workspace actions" })).toBeVisible();
    await expect
      .element(page.getByRole("tab", { name: "Run", exact: true }))
      .toHaveAttribute("aria-selected", "true");
  } finally {
    await view.unmount();
  }
});

function LayoutFixture({ width }: { width: number }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(true);
  return (
    <div style={{ display: "flex", height: 650, width: "100%", background: "var(--background)" }}>
      <div
        className="chat-workspace-root"
        style={{
          width,
          flexShrink: 0,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header style={{ position: "relative", padding: 12 }}>
          <ChatHeader
            workspaceActionsContainer={host}
            onWorkspaceActionsOpenChange={setOpen}
            activeThreadId={ThreadId.makeUnsafe("layout-test")}
            activeThreadTitle="Workspace actions"
            activeProjectName="tabs"
            isGitRepo
            openInCwd="/repo/layout"
            keybindings={[]}
            availableEditors={[]}
            terminalAvailable={false}
            terminalOpen={false}
            terminalToggleShortcutLabel={null}
            diffToggleShortcutLabel={null}
            gitCwd="/repo/layout"
            diffOpen={false}
            onToggleTerminal={() => {}}
            onToggleDiff={() => {}}
            agentWorkflow={
              <section>
                <button>Sub-agents</button>
                <p>Delegated tasks appear here.</p>
              </section>
            }
          />
          <aside ref={setHost} hidden={!open} className="workspace-actions-rail" />
        </header>
        <div
          className="chat-workspace-body"
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <main data-testid="chat-column" style={{ flex: 1, minWidth: 0, padding: 24 }}>
            Your conversation
          </main>
        </div>
      </div>
      {width === 760 && (
        <aside style={{ flex: 1, borderLeft: "1px solid var(--border)", padding: 24 }}>
          Companion panel
        </aside>
      )}
    </div>
  );
}
it("keeps separate actions inside the chat pane and restores the selected section after remount", async () => {
  useWorkspaceActionsState
    .getState()
    .update(JSON.stringify(["primary", "/repo/layout"]), { open: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  savePinnedBranches(gitWorkspaceScopeKey(undefined, "/repo/layout"), [
    "main",
    "codex/t3-parity-antigravity-very-long-branch-name",
  ]);
  for (const width of [1200, 760, 390]) {
    await page.viewport(width === 760 ? 1200 : width, 800);
    const view = await render(
      <QueryClientProvider client={client}>
        <LayoutFixture width={width} />
      </QueryClientProvider>,
    );
    try {
      const root = view.container.querySelector<HTMLElement>(".chat-workspace-root")!;
      const rail = view.container.querySelector<HTMLElement>(".workspace-actions-rail")!;
      await expect.element(page.getByRole("region", { name: "Workspace actions" })).toBeVisible();
      if (width !== 1200)
        await expect
          .element(page.getByRole("tab", { name: "Agents", exact: true }))
          .toHaveAttribute("aria-selected", "true");
      const gitTab = page.getByRole("tab", { name: "Git", exact: true });
      await gitTab.click();
      const selected = document.querySelector<HTMLElement>(
        '.workspace-action-tabs > [aria-selected="true"]',
      )!;
      const inactive = document.querySelector<HTMLElement>(
        '.workspace-action-tabs > [aria-selected="false"]',
      )!;
      await expect
        .poll(() => selected.getBoundingClientRect().width)
        .toBeGreaterThan(inactive.getBoundingClientRect().width * 3);
      const branchCard = document.querySelector<HTMLElement>(".workspace-branch-card")!;
      const pins = [...branchCard.querySelectorAll<HTMLElement>(".workspace-pinned-branch")];
      expect(pins).toHaveLength(2);
      for (const pin of pins) {
        expect(pin.getBoundingClientRect().left).toBeGreaterThan(
          branchCard.getBoundingClientRect().left + 6,
        );
        expect(pin.getBoundingClientRect().right).toBeLessThan(
          branchCard.getBoundingClientRect().right - 6,
        );
        expect(parseFloat(getComputedStyle(pin).borderTopLeftRadius)).toBeGreaterThanOrEqual(16);
        expect(pin.scrollWidth).toBeLessThanOrEqual(pin.clientWidth + 1);
      }
      const pr = document.querySelector<HTMLElement>(".workspace-pull-request")!;
      expect(pr.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        branchCard.getBoundingClientRect().bottom + 4,
      );
      await page.screenshot({
        element: view.container,
        path: `__screenshots__/workspace-actions/git-spacing-${width}.png`,
      });
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      const rootRect = root.getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      expect(railRect.right).toBeLessThanOrEqual(rootRect.right + 1);
      expect(railRect.left).toBeGreaterThanOrEqual(rootRect.left);
      expect(rail.scrollWidth).toBeLessThanOrEqual(rail.clientWidth + 1);
      if (width === 1200) {
        const chat = view.container.querySelector<HTMLElement>('[data-testid="chat-column"]')!;
        const before = chat.getBoundingClientRect();
        await page.getByRole("button", { name: "Toggle workspace actions" }).click();
        const closed = chat.getBoundingClientRect();
        expect(closed.left).toBe(before.left);
        expect(closed.width).toBe(before.width);
        await page.getByRole("button", { name: "Toggle workspace actions" }).click();
        expect(chat.getBoundingClientRect().width).toBe(before.width);
        await page.screenshot({
          element: view.container,
          path: "__screenshots__/workspace-actions/separate-git.png",
        });
        await page.getByRole("tab", { name: "Agents", exact: true }).click();
      } else {
        await expect
          .element(page.getByRole("tab", { name: "Agents", exact: true }))
          .toHaveAttribute("aria-selected", "true");
      }
      await page.screenshot({
        element: view.container,
        path: `__screenshots__/workspace-actions/separate-${width}.png`,
      });
    } finally {
      await view.unmount();
    }
  }
  await page.viewport(1280, 900);
});

it("offers an opaque searchable branch picker and closes after checkout", async () => {
  useWorkspaceActionsState
    .getState()
    .update(JSON.stringify(["primary", "/repo/layout"]), { open: true, section: "git" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <LayoutFixture width={760} />
    </QueryClientProvider>,
  );
  try {
    await page.getByRole("button", { name: "feature/design", exact: true }).click();
    const search = page.getByRole("textbox", { name: "Search branches" });
    await expect.element(search).toBeVisible();
    const popup = document.querySelector<HTMLElement>(".workspace-branch-picker")!;
    expect(getComputedStyle(popup).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    await search.fill("main");
    await expect
      .element(page.getByRole("button", { name: "Switch to main", exact: true }))
      .toBeVisible();
    expect(document.querySelectorAll(".workspace-branch-result")).toHaveLength(1);
    await page.screenshot({ path: "__screenshots__/workspace-actions/branch-search.png" });
    await page.getByRole("button", { name: "Switch to main", exact: true }).click();
    await expect.poll(() => branchCalls.checkout.mock.calls.length).toBe(1);
    expect(branchCalls.checkout.mock.calls[0]![0]).toMatchObject({
      cwd: "/repo/layout",
      branch: "main",
    });
    await expect.element(search).not.toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});
