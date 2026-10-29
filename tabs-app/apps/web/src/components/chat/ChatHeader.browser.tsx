import "../../index.css";
import { ThreadId } from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ChatHeader } from "./ChatHeader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("~/connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    git: {
      listBranches: async () => ({ branches: [] }),
      watchedBranchStatuses: async () => ({ branches: [] }),
    },
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
    await page.getByRole("button", { name: "Changes +12 −3" }).click();
    expect(onToggleDiff).toHaveBeenCalledOnce();
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
  } finally {
    await view.unmount();
  }
});

it("adapts density to compact in split pane mode and restores focus on Escape", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <ChatHeader
        activeThreadId={ThreadId.makeUnsafe("split-test")}
        activeThreadTitle="Split Thread"
        activeProjectName="tabs"
        isGitRepo
        isSplitActive
        isActivePane
        openInCwd="/repo/tabs"
        keybindings={[]}
        availableEditors={[]}
        terminalAvailable
        terminalOpen={false}
        terminalToggleShortcutLabel={null}
        diffToggleShortcutLabel={null}
        gitCwd="/repo/tabs"
        diffOpen={false}
        onToggleTerminal={vi.fn()}
        onToggleDiff={vi.fn()}
      />
    </QueryClientProvider>,
  );
  try {
    const toggle = page.getByRole("button", { name: "Toggle workspace actions" });
    await toggle.click();
    const card = document.querySelector<HTMLElement>('[aria-label="Workspace actions"]')!;
    expect(card).not.toBeNull();
    expect(card.getAttribute("data-density")).toBe("compact");

    // Press Escape to verify tuck-away and focus restoration
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect
      .element(page.getByRole("region", { name: "Workspace actions" }))
      .not.toBeInTheDocument();
    expect(document.activeElement).toBe(toggle.element());
  } finally {
    await view.unmount();
  }
});

it("adapts density to essential on constrained viewport and toggles more tools disclosure", async () => {
  const originalHeight = window.innerHeight;
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 480 });
  window.dispatchEvent(new Event("resize"));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <ChatHeader
        activeThreadId={ThreadId.makeUnsafe("essential-test")}
        activeThreadTitle="Essential Thread"
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
        onToggleTerminal={vi.fn()}
        onToggleDiff={vi.fn()}
      />
    </QueryClientProvider>,
  );
  try {
    const toggle = page.getByRole("button", { name: "Toggle workspace actions" });
    await toggle.click();
    const card = document.querySelector<HTMLElement>('[aria-label="Workspace actions"]')!;
    expect(card).not.toBeNull();
    expect(card.getAttribute("data-density")).toBe("essential");

    // In essential mode, core git actions remain directly visible
    await expect.element(page.getByRole("button", { name: "Commit & push" })).toBeVisible();

    // Secondary tools are tucked behind the disclosure
    const moreTools = page.getByRole("button", { name: "More tools" });
    await expect.element(moreTools).toBeVisible();
    await moreTools.click();
    await expect
      .element(
        page
          .getByRole("group", { name: "Workspace context" })
          .getByRole("button", { name: "Open in editor" }),
      )
      .toBeVisible();

    // Close via close card button restores focus
    const closeBtn = page.getByRole("button", { name: "Close workspace card" });
    await closeBtn.click();
    await expect
      .element(page.getByRole("region", { name: "Workspace actions" }))
      .not.toBeInTheDocument();
    expect(document.activeElement).toBe(toggle.element());
  } finally {
    Object.defineProperty(window, "innerHeight", {
      writable: true,
      configurable: true,
      value: originalHeight,
    });
    window.dispatchEvent(new Event("resize"));
    await view.unmount();
  }
});

it("bounds the workspace card to the actual chat pane", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <div data-chat-pane="true" style={{ position: "relative", width: 420, height: 300 }}>
        <header style={{ position: "relative" }}>
          <ChatHeader
            activeThreadId={ThreadId.make("measured-pane")}
            activeThreadTitle="Measured pane"
            activeProjectName="tabs"
            isGitRepo
            openInCwd="/repo"
            keybindings={[]}
            availableEditors={[]}
            terminalAvailable
            terminalOpen={false}
            terminalToggleShortcutLabel={null}
            diffToggleShortcutLabel={null}
            gitCwd="/repo"
            diffOpen={false}
            onToggleTerminal={vi.fn()}
            onToggleDiff={vi.fn()}
          />
        </header>
      </div>
    </QueryClientProvider>,
  );
  try {
    await page.getByRole("button", { name: "Toggle workspace actions" }).click();
    const card = document.querySelector<HTMLElement>('[aria-label="Workspace actions"]')!;
    await expect.poll(() => card.dataset.density).toBe("essential");
    const pane = document.querySelector<HTMLElement>("[data-chat-pane]")!;
    expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      pane.getBoundingClientRect().bottom,
    );
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
  } finally {
    await view.unmount();
    client.clear();
  }
});
