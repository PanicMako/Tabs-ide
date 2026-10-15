import "../index.css";
import "./settings/wallpaper-labs.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AgentBackground } from "./AgentBackground";
import { saveIsAgentWallpaperEnabled } from "./onboarding/wallpapers";

vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../panelAnimations", () => ({
  usePanelAnimationSettings: () => ({ reducedMotion: true }),
}));

it("keeps the chat readable with a static wallpaper and restores the plain workspace when disabled", async () => {
  saveIsAgentWallpaperEnabled(true);
  const view = await render(
    <div data-wallpaper-shell="chat-area" className="bg-background flex" style={{ height: 600 }}>
      <AgentBackground threadId="example" defaultMinimized={false}>
        <div className="bg-background" data-timeline-root="true">
          A readable conversation
        </div>
      </AgentBackground>
    </div>,
  );
  try {
    const conversation = page.getByText("A readable conversation").element();
    expect(getComputedStyle(conversation).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(document.querySelector('[data-agent-wallpaper="active"]')).not.toBeNull();
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(document.querySelector(".agent-wallpaper-halftone")).not.toBeNull();
    await page.getByRole("button", { name: "Browse all wallpapers in gallery" }).first().click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close gallery" }).click();
    await page
      .getByRole("button", {
        name: "Turn off wallpaper (Hide this icon & switch to default IDE look)",
      })
      .click();
    expect(document.querySelector('[data-agent-wallpaper="active"]')).toBeNull();
    await expect.element(page.getByText("A readable conversation")).toBeVisible();
  } finally {
    saveIsAgentWallpaperEnabled(false);
    await view.unmount();
  }
});
