import "../index.css";
import "../localFonts.css";
import "../interface-study.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InterfaceStudyTopBar } from "./InterfaceStudyTopBar";
import type { Project } from "../types";
import type { EnvironmentId, ProjectId } from "@tabs/contracts";

const mockProjects: Project[] = [
  {
    id: "proj-1" as ProjectId,
    name: "tabs",
    cwd: "/Users/dev/tabs",
    environmentId: "env-1" as EnvironmentId,
  },
  {
    id: "proj-2" as ProjectId,
    name: "Intern-batch-08",
    cwd: "/Users/dev/intern",
    environmentId: "env-1" as EnvironmentId,
  },
  {
    id: "proj-3" as ProjectId,
    name: "ThrottleClan",
    cwd: "/Users/dev/throttle",
    environmentId: "env-1" as EnvironmentId,
  },
] as unknown as Project[];

const mockTools = [
  { id: "tool-code", kind: "code" as const, label: "Code" },
  { id: "tool-agents", kind: "agents" as const, label: "Agents" },
  { id: "tool-launchpad", kind: "server" as const, label: "Launchpad" },
  { id: "tool-git", kind: "git" as const, label: "Git" },
  { id: "tool-browser", kind: "browser" as const, label: "Browser" },
];

it("renders InterfaceStudyTopBar, toggles deck, and selects tools in browser", async () => {
  await page.viewport(1280, 800);

  const onSelectTool = vi.fn();
  const onActivateProject = vi.fn();
  const onNewTab = vi.fn();
  const onOpenSettings = vi.fn();

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  await render(
    <QueryClientProvider client={queryClient}>
      <div className="w-full bg-[#181920] p-0 text-white">
        <InterfaceStudyTopBar
          projects={mockProjects}
          openProjects={mockProjects}
          activeProject={mockProjects[1]!} // Intern-batch-08
          pendingTabIds={[]}
          activePendingTabId={null}
          activeToolId="tool-launchpad"
          availableTools={mockTools}
          threads={[]}
          onActivateProject={onActivateProject}
          onCloseProject={() => {}}
          onNewTab={onNewTab}
          onActivatePendingTab={() => {}}
          onClosePendingTab={() => {}}
          onSelectTool={onSelectTool}
          onOpenSettings={onOpenSettings}
        />
        <div className="study-workspace-card h-96 w-full p-6 text-foreground">
          Workspace Content
        </div>
      </div>
    </QueryClientProvider>,
  );

  // Logo & project title visible
  await expect.element(page.getByText("Tabs", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Intern-batch-08", { exact: true })).toBeVisible();

  // All 5 tools visible in tab list
  await expect.element(page.getByRole("tab", { name: "Code" })).toBeVisible();
  await expect.element(page.getByRole("tab", { name: "Agents" })).toBeVisible();
  await expect.element(page.getByRole("tab", { name: "Launchpad" })).toBeVisible();
  await expect.element(page.getByRole("tab", { name: "Git" })).toBeVisible();
  await expect.element(page.getByRole("tab", { name: "Browser" })).toBeVisible();

  // Switch tool
  await page.getByRole("tab", { name: "Agents" }).click();
  expect(onSelectTool).toHaveBeenCalledWith("tool-agents");

  // Open project switcher deck
  const switcherBtn = page.getByRole("button", { name: /current project: intern-batch-08/i });
  await switcherBtn.click();

  // Project deck menu is now visible
  await expect.element(page.getByRole("menu", { name: "Open projects" })).toBeVisible();

  // Click tabs project row to activate
  await page.getByRole("menuitem", { name: /tabs/i }).click();
  expect(onActivateProject).toHaveBeenCalledWith("proj-1");

  // Reopen and test New Project
  await switcherBtn.click();
  await page.getByRole("button", { name: "New project" }).click();
  expect(onNewTab).toHaveBeenCalled();
});
