import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceLookPane } from "./WorkspaceLookPane";
import type { WallpaperControls } from "../../stores/wallpaperControlsStore";

describe("WorkspaceLookPane", () => {
  it("renders a message when controls are unavailable", () => {
    const markup = renderToStaticMarkup(<WorkspaceLookPane controls={null} />);
    expect(markup).toContain("Wallpaper controls appear once a conversation is open.");
  });

  it("renders the Switch toggle when wallpaper is disabled", () => {
    const mockControls: WallpaperControls = {
      enabled: false,
      label: "Starry Night",
      url: "/wallpapers/starry-night.png",
      overridden: false,
      openGallery: vi.fn(),
      shuffle: vi.fn(),
      step: vi.fn(),
      resetOverride: vi.fn(),
      setEnabled: vi.fn(),
    };

    const markup = renderToStaticMarkup(<WorkspaceLookPane controls={mockControls} />);
    // Should render the Switch toggle with aria-label
    expect(markup).toContain("Wallpaper");
    expect(markup).toContain('aria-label="Toggle wallpaper"');
    // Switch should be unchecked
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain("data-unchecked");
    // Controls should not be rendered
    expect(markup).not.toContain("Browse gallery");
  });

  it("renders gallery controls and labeled action buttons when wallpaper is enabled", () => {
    const mockControls: WallpaperControls = {
      enabled: true,
      label: "Romantic Night",
      url: "/wallpapers/romantic-night.png",
      overridden: false,
      openGallery: vi.fn(),
      shuffle: vi.fn(),
      step: vi.fn(),
      resetOverride: vi.fn(),
      setEnabled: vi.fn(),
    };

    const markup = renderToStaticMarkup(<WorkspaceLookPane controls={mockControls} />);
    // Switch should be checked
    expect(markup).toContain("Wallpaper");
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("data-checked");
    // Gallery controls
    expect(markup).toContain("Browse gallery");
    expect(markup).toContain("Romantic Night");
    // Action button with clear Shuffle text label
    expect(markup).toContain("Shuffle");
    // Overridden is false, so "Use shared" is not shown
    expect(markup).not.toContain("Use shared");
  });

  it("renders 'Use shared' button when wallpaper is overridden", () => {
    const mockControls: WallpaperControls = {
      enabled: true,
      label: "Custom Workspace",
      url: "/wallpapers/custom.png",
      overridden: true,
      openGallery: vi.fn(),
      shuffle: vi.fn(),
      step: vi.fn(),
      resetOverride: vi.fn(),
      setEnabled: vi.fn(),
    };

    const markup = renderToStaticMarkup(<WorkspaceLookPane controls={mockControls} />);
    expect(markup).toContain("Shuffle");
    expect(markup).toContain("Use shared");
    expect(markup).toContain('title="Use the shared workspace wallpaper"');
  });
});
