import "../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ProjectId, type EnvironmentId } from "@tabs/contracts";
import type { Project } from "../types";
import { appAtomRegistry, AppAtomRegistryProvider } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import { initializeWorkspaceShellState } from "../state/workspaceShell";
import {
  createDefaultWorkspaceShellPersistedState,
  useWorkspaceShellStore,
} from "../workspaceShellStore";
import { ProjectWorkspaceSettingsSection } from "./ProjectWorkspaceSettingsSection";

vi.mock("../state/extensions", () => {
  const empty: never[] = [];
  return { useInstalledExtensions: () => empty, refreshExtensions: vi.fn(async () => {}) };
});
vi.mock("./ProjectFavicon", () => ({ ProjectFavicon: () => null }));
initializeWorkspaceShellState();
let id: ProjectId;
let sequence = 0;
beforeEach(async () => {
  await page.viewport(1280, 1000);
  id = ProjectId.makeUnsafe(`toolbar-settings-test-${++sequence}`);
  useWorkspaceShellStore.setState(createDefaultWorkspaceShellPersistedState());
  useWorkspaceShellStore.getState().openProject(id);
  appAtomRegistry.set(readModelStateAtom, {
    projects: [
      {
        id,
        name: "Toolbar test",
        cwd: "/workspace",
        environmentId: "test-env" as EnvironmentId,
      } as Project,
    ],
    threads: [],
    threadsHydrated: true,
  });
});
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <AppAtomRegistryProvider>
      <QueryClientProvider client={client}>
        <ProjectWorkspaceSettingsSection />
      </QueryClientProvider>
    </AppAtomRegistryProvider>,
  );
  return {
    view,
    cleanup: async () => {
      await view.unmount();
      client.clear();
    },
  };
}

it.each(["code", "agents", "server", "git", "browser", "testing"])(
  "saves both visibility directions through the actual %s switch and confirmation",
  async (toolId) => {
    const tool = useWorkspaceShellStore
      .getState()
      .projectSettingsByProjectId[id]!.tools.find((entry) => entry.id === toolId)!;
    const fixture = await mount();
    try {
      const toggle = page.getByRole("switch", { name: `Toggle ${tool.label}`, exact: true });
      for (const next of [!tool.visible, tool.visible]) {
        await toggle.click();
        const action = `${next ? "Show" : "Hide"} ${tool.label}`;
        await expect.element(page.getByRole("alertdialog")).toBeVisible();
        await page.getByRole("button", { name: action, exact: true }).click();
        await expect.element(toggle).toHaveAttribute("aria-checked", String(next));
        expect(
          useWorkspaceShellStore
            .getState()
            .projectSettingsByProjectId[id]!.tools.find((entry) => entry.id === toolId)?.visible,
        ).toBe(next);
        const saved = JSON.parse(localStorage.getItem("tabs:workspace-shell:v1")!);
        expect(
          saved.state.projectSettingsByProjectId[id].tools.find(
            (entry: { id: string }) => entry.id === toolId,
          ).visible,
        ).toBe(next);
      }
    } finally {
      await fixture.cleanup();
    }
  },
);

it("cancels without changing settings and restores a confirmed hide after rehydration", async () => {
  let fixture = await mount();
  try {
    const toggle = page.getByRole("switch", { name: "Toggle Agents", exact: true });
    await toggle.click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await page.getByRole("button", { name: "Hide Agents", exact: true }).click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "false");
    const saved = localStorage.getItem("tabs:workspace-shell:v1")!;
    await fixture.cleanup();
    useWorkspaceShellStore.setState(createDefaultWorkspaceShellPersistedState());
    localStorage.setItem("tabs:workspace-shell:v1", saved);
    await useWorkspaceShellStore.persist.rehydrate();
    fixture = await mount();
    await expect
      .element(page.getByRole("switch", { name: "Toggle Agents", exact: true }))
      .toHaveAttribute("aria-checked", "false");
  } finally {
    await fixture.cleanup();
  }
});
