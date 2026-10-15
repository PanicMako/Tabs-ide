import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let mockEditorial = false;
let mockSettingsOnly = false;
vi.mock("../stores/settingsLabsStore", () => ({
  useSettingsLabsStore: (
    selector: (state: { editorialSettings: boolean; editorialSettingsOnly: boolean }) => boolean,
  ) => selector({ editorialSettings: mockEditorial, editorialSettingsOnly: mockSettingsOnly }),
}));

import { WorkspaceWelcomeScreen } from "./WorkspaceWelcomeScreen";

describe("WorkspaceWelcomeScreen", () => {
  const dummyProjects = [
    { id: "p1", name: "tabs", cwd: "/Users/rushil.dev/Desktop/tabs" },
    { id: "p2", name: "throttle", cwd: "/Users/rushil.dev/Desktop/throttle" },
  ];

  it("renders classic welcome screen when editorialSettings is disabled", () => {
    mockEditorial = false;

    const markup = renderToStaticMarkup(
      <WorkspaceWelcomeScreen
        recentProjects={dummyProjects}
        onCreateProject={vi.fn()}
        onOpenFile={vi.fn()}
        onCloneGit={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(markup).toContain('data-slot="workspace-welcome"');
    expect(markup).toContain("Welcome");
    expect(markup).toContain("Add Project...");
    expect(markup).toContain("Open File...");
    expect(markup).toContain("Clone from Git...");
    expect(markup).toContain("Workspace Settings");
    expect(markup).toContain("tabs");
    expect(markup).toContain("throttle");
  });

  it("keeps the classic workspace when only Settings uses the study", () => {
    mockEditorial = true;
    mockSettingsOnly = true;
    try {
      const markup = renderToStaticMarkup(
        <WorkspaceWelcomeScreen
          recentProjects={dummyProjects}
          onCreateProject={vi.fn()}
          onOpenFile={vi.fn()}
          onCloneGit={vi.fn()}
          onOpenSettings={vi.fn()}
          onSelectProject={vi.fn()}
        />,
      );
      expect(markup).toContain("Add Project...");
      expect(markup).toContain("Workspace Settings");
    } finally {
      mockSettingsOnly = false;
    }
  });

  it("renders editorial welcome screen when editorialSettings is enabled", () => {
    mockEditorial = true;

    const markup = renderToStaticMarkup(
      <WorkspaceWelcomeScreen
        recentProjects={dummyProjects}
        onCreateProject={vi.fn()}
        onOpenFile={vi.fn()}
        onCloneGit={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );

    expect(markup).toContain("Welcome to");
    expect(markup).toContain("Tabs");
    expect(markup).toContain("Add Project");
    expect(markup).toContain("Open File");
    expect(markup).toContain("Clone from Git");
    expect(markup).toContain("Workspace Settings");
    expect(markup).toContain("tabs");
    expect(markup).toContain("throttle");
    expect(markup).toContain("2 projects");
  });
});
