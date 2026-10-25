import "../index.css";
import "../localFonts.css";
import "../interface-study.css";
import { expect, it, vi } from "vitest";
import { useState } from "react";
import { useNativeSurfaceOverlaySuspension } from "../nativeSurfaceOverlay";
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
  { id: "tool-launchpad", kind: "server" as const, label: "Dock" },
  { id: "tool-git", kind: "git" as const, label: "Git" },
  { id: "tool-browser", kind: "browser" as const, label: "Browser" },
  { id: "tool-docs", kind: "custom_embed" as const, label: "Docs" },
  { id: "tool-terminal", kind: "custom_process" as const, label: "Dev terminal" },
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
  await expect.element(page.getByRole("tab", { name: "Dock" })).toBeVisible();
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

it.each(["tool-code", "tool-browser"])(
  "keeps the project dropdown above native content in %s",
  async (initialTool) => {
    const suspend = vi.fn();
    const resume = vi.fn();
    const activate = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    function Workspace() {
      const [tool, setTool] = useState(initialTool);
      useNativeSurfaceOverlaySuspension({
        enabled: true,
        surfaceReady: true,
        onSuspend: suspend,
        onResume: resume,
      });
      return (
        <InterfaceStudyTopBar
          projects={mockProjects}
          openProjects={mockProjects}
          activeProject={mockProjects[0]!}
          pendingTabIds={[]}
          activePendingTabId={null}
          activeToolId={tool}
          availableTools={mockTools}
          onActivateProject={activate}
          onCloseProject={() => {}}
          onNewTab={() => {}}
          onActivatePendingTab={() => {}}
          onClosePendingTab={() => {}}
          onSelectTool={setTool}
          onOpenSettings={() => {}}
        />
      );
    }
    const view = await render(
      <QueryClientProvider client={client}>
        <Workspace />
      </QueryClientProvider>,
    );
    try {
      const opener = page.getByRole("button", { name: /current project: tabs/i });
      await opener.click();
      await expect.element(page.getByRole("menu", { name: "Open projects" })).toBeVisible();
      await expect.poll(() => suspend.mock.calls.length).toBe(1);
      await page.getByRole("menuitem", { name: /Intern-batch-08/ }).click();
      expect(activate).toHaveBeenCalledWith("proj-2");
      await expect.poll(() => resume.mock.calls.length).toBe(1);
      await page
        .getByRole("tab", { name: initialTool === "tool-code" ? "Browser" : "Code", exact: true })
        .click();
      await opener.click();
      await expect.poll(() => suspend.mock.calls.length).toBe(2);
      await page.getByRole("tab", { name: "Agents", exact: true }).click();
      await expect
        .element(page.getByRole("menu", { name: "Open projects" }))
        .not.toBeInTheDocument();
      await expect.poll(() => resume.mock.calls.length).toBe(2);
    } finally {
      await view.unmount();
      client.clear();
    }
  },
);

it("animates details inside the active mark and respects reduced motion", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const previousMotion = document.documentElement.getAttribute("data-reduced-motion");
  document.documentElement.setAttribute("data-reduced-motion", "no-preference");
  function Workspace() {
    const [tool, setTool] = useState("tool-code");
    return (
      <InterfaceStudyTopBar
        projects={mockProjects}
        openProjects={mockProjects}
        activeProject={mockProjects[0]!}
        pendingTabIds={[]}
        activePendingTabId={null}
        activeToolId={tool}
        availableTools={mockTools}
        onActivateProject={() => {}}
        onCloseProject={() => {}}
        onNewTab={() => {}}
        onActivatePendingTab={() => {}}
        onClosePendingTab={() => {}}
        onSelectTool={setTool}
        onOpenSettings={() => {}}
      />
    );
  }
  const view = await render(
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>,
  );
  const icon = (kind: string) =>
    document.querySelector<HTMLElement>(
      `.study-tool-tab[data-tool-kind="${kind}"] > .study-tool-tab-icon`,
    )!;
  try {
    expect(getComputedStyle(icon("code")).animationName).toBe("none");
    expect(getComputedStyle(icon("code").querySelector(".tool-code-eye")!).animationName).toBe(
      "tool-code-squint",
    );
    await page.getByRole("tab", { name: "Dock", exact: true }).click();
    expect(getComputedStyle(icon("code")).animationName).toBe("none");
    expect(getComputedStyle(icon("server")).animationName).toBe("none");
    const beam = icon("server").querySelector(".tool-ufo-beam")!;
    expect(getComputedStyle(beam).animationName).toBe("tool-ufo-scan");
    expect(getComputedStyle(beam).animationIterationCount).toBe("infinite");
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    expect(
      getComputedStyle(icon("browser").querySelector(".tool-planet-ring")!).animationName,
    ).toBe("tool-planet-shimmer");
    await page.getByRole("tab", { name: "Git", exact: true }).click();
    expect(getComputedStyle(icon("git").querySelector(".tool-assistant-eye")!).animationName).toBe(
      "tool-assistant-blink",
    );
    await page.getByRole("tab", { name: "Docs", exact: true }).click();
    expect(
      getComputedStyle(icon("custom_embed").querySelector(".tool-globe-meridian")!).animationName,
    ).toBe("tool-globe-turn");
    await page.getByRole("tab", { name: "Dev terminal", exact: true }).click();
    expect(
      getComputedStyle(icon("custom_process").querySelector(".tool-terminal-cursor")!)
        .animationName,
    ).toBe("tool-terminal-type");
    document.documentElement.setAttribute("data-reduced-motion", "reduce");
    expect(
      getComputedStyle(icon("custom_process").querySelector(".tool-terminal-cursor")!)
        .animationName,
    ).toBe("none");
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    expect(
      getComputedStyle(icon("agents").querySelector(".tool-assistant-eye")!).animationName,
    ).toBe("none");
    document.documentElement.setAttribute("data-reduced-motion", "no-preference");
    const eye = icon("agents").querySelector(".tool-assistant-eye")!;
    expect(getComputedStyle(eye).animationName).toBe("tool-assistant-blink");
    const blink = eye.getAnimations()[0]!;
    blink.pause();
    blink.currentTime = 2460;
    expect(getComputedStyle(eye).transform).not.toBe("none");
    expect(getComputedStyle(icon("agents")).transform).toBe("none");
  } finally {
    await view.unmount();
    client.clear();
    if (previousMotion === null) document.documentElement.removeAttribute("data-reduced-motion");
    else document.documentElement.setAttribute("data-reduced-motion", previousMotion);
  }
});
