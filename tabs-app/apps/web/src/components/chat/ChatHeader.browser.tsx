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
