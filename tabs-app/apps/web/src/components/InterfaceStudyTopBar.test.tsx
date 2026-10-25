import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InterfaceStudyTopBar } from "./InterfaceStudyTopBar";
import type { Project } from "../types";
import type { EnvironmentId, ProjectId } from "@tabs/contracts";
import { useWorkspaceAppearanceStore } from "../stores/workspaceAppearanceStore";

vi.mock("../env", () => ({
  isElectron: false,
}));

let mockShowProjectTabIcons = true;
vi.mock("../stores/workspaceAppearanceStore", () => ({
  useWorkspaceAppearanceStore: (selector: (state: { showProjectTabIcons: boolean }) => unknown) =>
    selector({ showProjectTabIcons: mockShowProjectTabIcons }),
}));

vi.mock("../lib/gitReactQuery", () => ({
  gitStatusQueryOptions: (cwd: string | null) => ({
    queryKey: ["git", "status", cwd],
    queryFn: () =>
      Promise.resolve({
        branch: "main",
        workingTree: { files: [{ path: "file1.ts" }, { path: "file2.ts" }] },
        staged: { files: [] },
        untracked: { files: [{ path: "file3.ts" }] },
      }),
  }),
}));

const mockProjects: Project[] = [
  {
    id: "proj-1" as ProjectId,
    name: "tabs",
    cwd: "/path/to/tabs",
    environmentId: "env-1" as EnvironmentId,
  },
  {
    id: "proj-2" as ProjectId,
    name: "Intern-batch-08",
    cwd: "/path/to/intern",
    environmentId: "env-1" as EnvironmentId,
  },
  {
    id: "proj-3" as ProjectId,
    name: "ThrottleClan",
    cwd: "/path/to/throttle",
    environmentId: "env-1" as EnvironmentId,
  },
] as unknown as Project[];

const mockTools = [
  { id: "tool-code", kind: "code" as const, label: "Code" },
  { id: "tool-agents", kind: "agents" as const, label: "Agents" },
  { id: "tool-launchpad", kind: "server" as const, label: "Dock" },
  { id: "tool-git", kind: "git" as const, label: "Git" },
  { id: "tool-browser", kind: "browser" as const, label: "Browser" },
];

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return renderToStaticMarkup(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("InterfaceStudyTopBar", () => {
  it("renders Tabs IDE branding, active project, and tools cleanly", () => {
    const markup = renderWithClient(
      <InterfaceStudyTopBar
        projects={mockProjects}
        openProjects={mockProjects}
        activeProject={mockProjects[1]!} // Intern-batch-08
        pendingTabIds={[]}
        activePendingTabId={null}
        activeToolId="tool-launchpad"
        availableTools={mockTools}
        threads={[]}
        onActivateProject={vi.fn()}
        onCloseProject={vi.fn()}
        onNewTab={vi.fn()}
        onActivatePendingTab={vi.fn()}
        onClosePendingTab={vi.fn()}
        onSelectTool={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    // Branding
    expect(markup).toContain("Tabs");
    expect(markup).toContain("IDE");

    // Active project
    expect(markup).toContain("Intern-batch-08");

    // Tool labels
    expect(markup).toContain("Code");
    expect(markup).toContain("Agents");
    expect(markup).toContain("Dock");
    expect(markup).toContain("Git");
    expect(markup).toContain("Browser");

    // Search button present
    expect(markup).toContain("Search files (⌘P)");

    // Theme toggle button removed per feedback
    expect(markup).not.toContain("Toggle theme");

    // Settings button present
    expect(markup).toContain("Settings (⌘,)");
  });

  it("renders Draft workspace label when active pending tab is selected", () => {
    const markup = renderWithClient(
      <InterfaceStudyTopBar
        projects={mockProjects}
        openProjects={mockProjects}
        activeProject={mockProjects[0]!}
        pendingTabIds={["pending-1"]}
        activePendingTabId="pending-1"
        activeToolId="tool-code"
        availableTools={mockTools}
        threads={[]}
        onActivateProject={vi.fn()}
        onCloseProject={vi.fn()}
        onNewTab={vi.fn()}
        onActivatePendingTab={vi.fn()}
        onClosePendingTab={vi.fn()}
        onSelectTool={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(markup).toContain("New Tab");
    expect(markup).toContain("Draft workspace");
  });

  it("hides project avatars when showProjectTabIcons is false", () => {
    mockShowProjectTabIcons = false;

    const markup = renderWithClient(
      <InterfaceStudyTopBar
        projects={mockProjects}
        openProjects={mockProjects}
        activeProject={mockProjects[0]!}
        pendingTabIds={[]}
        activePendingTabId={null}
        activeToolId="tool-code"
        availableTools={mockTools}
        threads={[]}
        onActivateProject={vi.fn()}
        onCloseProject={vi.fn()}
        onNewTab={vi.fn()}
        onActivatePendingTab={vi.fn()}
        onClosePendingTab={vi.fn()}
        onSelectTool={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(markup).not.toContain("Switch to tabs");
    expect(markup).not.toContain("Switch to Intern-batch-08");
  });

  it("shows project avatars when showProjectTabIcons is true", () => {
    mockShowProjectTabIcons = true;

    const markup = renderWithClient(
      <InterfaceStudyTopBar
        projects={mockProjects}
        openProjects={mockProjects}
        activeProject={mockProjects[0]!}
        pendingTabIds={[]}
        activePendingTabId={null}
        activeToolId="tool-code"
        availableTools={mockTools}
        threads={[]}
        onActivateProject={vi.fn()}
        onCloseProject={vi.fn()}
        onNewTab={vi.fn()}
        onActivatePendingTab={vi.fn()}
        onClosePendingTab={vi.fn()}
        onSelectTool={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(markup).toContain("Switch to tabs");
    expect(markup).toContain("Switch to Intern-batch-08");
  });
});
