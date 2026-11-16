import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorkspaceWallpaperIcon,
  WallpaperRollIcon,
  GitCompanionIcon,
  WorkspaceBrowserIcon,
  WorkspaceTerminalIcon,
} from "./WorkspaceToolMarks";

describe("WorkspaceToolMarks", () => {
  it("renders WorkspaceWallpaperIcon as an accessible wallpaper roll mark", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceWallpaperIcon className="size-4 shrink-0" data-testid="wallpaper-icon" />,
    );
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('class="size-4 shrink-0"');
    expect(markup).toContain('data-testid="wallpaper-icon"');
    // Ensure roll and chevron paths are present
    expect(markup).toContain("<path");
    expect(markup).toContain("<circle");
  });

  it("exports WallpaperRollIcon as an alias for WorkspaceWallpaperIcon", () => {
    expect(WallpaperRollIcon).toBe(WorkspaceWallpaperIcon);
  });

  it("renders companion marks correctly", () => {
    const gitMarkup = renderToStaticMarkup(<GitCompanionIcon className="size-4" />);
    expect(gitMarkup).toContain('aria-hidden="true"');

    const browserMarkup = renderToStaticMarkup(<WorkspaceBrowserIcon className="size-4" />);
    expect(browserMarkup).toContain('viewBox="0 0 24 24"');

    const terminalMarkup = renderToStaticMarkup(<WorkspaceTerminalIcon className="size-4" />);
    expect(terminalMarkup).toContain('viewBox="0 0 24 24"');
  });
});
