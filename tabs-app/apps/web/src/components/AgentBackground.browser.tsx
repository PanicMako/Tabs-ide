import "../index.css";
import "./settings/wallpaper-labs.css";
import "./chat/user-message.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { act } from "react";
import { useWallpaperControlsStore } from "../stores/wallpaperControlsStore";
import { AgentBackground } from "./AgentBackground";
import { saveIsAgentWallpaperEnabled } from "./onboarding/wallpapers";
import { saveWallpaperPrintStyle } from "./onboarding/wallpaperPrint";

let mockTheme: "light" | "dark" = "dark";
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: mockTheme }) }));
vi.mock("../panelAnimations", () => ({
  usePanelAnimationSettings: () => ({ reducedMotion: true }),
}));

it("keeps the chat readable with a static wallpaper and restores the plain workspace when disabled", async () => {
  saveIsAgentWallpaperEnabled(true);
  const view = await render(
    <div data-wallpaper-shell="chat-area" className="bg-background flex" style={{ height: 600 }}>
      <AgentBackground threadId="example">
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
    // The controls live in the workspace card's Look pane; the layer publishes them.
    expect(document.querySelector('[aria-label="Wallpaper controls"]')).toBeNull();
    act(() => useWallpaperControlsStore.getState().controls?.openGallery());
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close gallery" }).click();
    act(() => useWallpaperControlsStore.getState().controls?.setEnabled(false));
    expect(document.querySelector('[data-agent-wallpaper="active"]')).toBeNull();
    await expect.element(page.getByText("A readable conversation")).toBeVisible();
  } finally {
    saveIsAgentWallpaperEnabled(false);
    await view.unmount();
  }
});

it.each(["ascii", "dither", "braille", "engrave", "stipple", "crosses", "mosaic"] as const)(
  "draws the %s print over the wallpaper and hides it when set to clean",
  async (style) => {
    saveIsAgentWallpaperEnabled(true);
    saveWallpaperPrintStyle(style);
    const view = await render(
      <div className="bg-background flex" style={{ height: 600, width: 900 }}>
        <AgentBackground threadId="example">
          <div>A readable conversation</div>
        </AgentBackground>
      </div>,
    );
    try {
      await vi.waitFor(
        () => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            `canvas[data-wallpaper-print="${style}"]`,
          );
          expect(canvas).not.toBeNull();
          const context = canvas!.getContext("2d")!;
          const { data } = context.getImageData(0, 0, canvas!.width, canvas!.height);
          let inked = 0;
          for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) inked++;
          expect(inked).toBeGreaterThan(200);
        },
        { timeout: 5000 },
      );
      expect(document.querySelector(".agent-wallpaper-halftone")).toBeNull();
    } finally {
      saveWallpaperPrintStyle("halftone");
      saveIsAgentWallpaperEnabled(false);
      await view.unmount();
    }
  },
);

it("shows no generated print when the style is clean", async () => {
  saveIsAgentWallpaperEnabled(true);
  saveWallpaperPrintStyle("none");
  const view = await render(
    <div className="bg-background flex" style={{ height: 400 }}>
      <AgentBackground threadId="example">
        <div>A readable conversation</div>
      </AgentBackground>
    </div>,
  );
  try {
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(document.querySelector(".agent-wallpaper-halftone")).toBeNull();
  } finally {
    saveWallpaperPrintStyle("halftone");
    saveIsAgentWallpaperEnabled(false);
    await view.unmount();
  }
});

it.each(["light", "dark"] as const)(
  "puts text on glass that hugs it, with real blur and no coloured edge in %s mode",
  async (theme) => {
    mockTheme = theme;
    saveIsAgentWallpaperEnabled(true);
    saveWallpaperPrintStyle("dither");
    const view = await render(
      <div
        data-wallpaper-shell="chat-area"
        className="bg-background flex"
        style={{ height: 400, width: 800 }}
      >
        <div
          data-slot="card"
          data-testid="radius-probe"
          style={{ position: "absolute", width: 4, height: 4 }}
        />
        <AgentBackground threadId="example">
          <div data-timeline-root="true" className="overflow-x-hidden" style={{ width: 700 }}>
            <div data-message-role="user" className="pb-4">
              <div className="user-message-row">
                <div className="user-message-frame">
                  <div className="user-message-actions" style={{ opacity: 1 }}>
                    <button data-message-copy="true" type="button">
                      copy
                    </button>
                    <p className="text-muted-foreground/30">11:35:23 AM</p>
                  </div>
                  <div className="user-message-content">
                    hi
                    <span className="user-message-receipt" data-seen="true">
                      ✓✓
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div data-message-role="assistant" className="pb-4">
              <div data-assistant-rail className="group relative min-w-0 pl-4">
                <div data-assistant-provider="true" title="codex">
                  <svg width="12" height="12" />
                  <span>codex</span>
                </div>
                <div data-assistant-footer="true" className="flex items-center gap-1.5 opacity-0">
                  <button data-message-copy="true" type="button">
                    copy
                  </button>
                  <p className="text-muted-foreground/30">11:35 AM</p>
                </div>
                <p className="text-muted-foreground/30">11:35 AM</p>
                <div className="chat-markdown">Hello there</div>
              </div>
            </div>
          </div>
        </AgentBackground>
      </div>,
    );
    try {
      const timeline = document.querySelector<HTMLElement>('[data-timeline-root="true"]')!;
      const probe = document.querySelector<HTMLElement>('[data-testid="radius-probe"]')!;
      for (const selector of ["[data-assistant-rail]", ".user-message-content"]) {
        const element = document.querySelector<HTMLElement>(selector)!;
        const style = getComputedStyle(element);
        // The glass is painted by a ::before layer, so children can blur the wallpaper themselves.
        const sheet = getComputedStyle(element, "::before");
        expect(sheet.backdropFilter).toContain("blur(30px)");
        expect(sheet.backdropFilter).toContain("saturate");
        expect(style.backdropFilter).toBe("none");
        // The glass hugs the text rather than stretching across the whole row.
        expect(element.getBoundingClientRect().width).toBeLessThan(timeline.clientWidth / 2);
        // No coloured side border, and the same corner radius as every other surface in the app.
        expect(style.borderRightWidth).toBe("0px");
        expect(style.borderTopLeftRadius).toBe(getComputedStyle(probe).borderTopLeftRadius);
      }
      // The provider is a round avatar on the bubble's corner, and its name takes no visible space.
      const avatar = document.querySelector<HTMLElement>("[data-assistant-provider]")!;
      const avatarBox = avatar.getBoundingClientRect();
      expect(Math.round(avatarBox.width)).toBe(Math.round(avatarBox.height));
      // It overlaps the print, so its glass blurs harder than the bubble's.
      expect(getComputedStyle(avatar, "::before").backdropFilter).toContain("blur(48px)");
      expect(getComputedStyle(avatar).position).toBe("absolute");
      expect(avatar.querySelector("span")!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      // Copy and time float below the bubble instead of reserving space in the message.
      const footer = document.querySelector<HTMLElement>("[data-assistant-footer]")!;
      expect(getComputedStyle(footer).position).toBe("absolute");
      expect(getComputedStyle(footer).pointerEvents).toBe("none");
      // An invisible bridge across the gap keeps the chip reachable while the pointer travels to it.
      expect(getComputedStyle(footer, "::after").height).not.toBe("auto");
      expect(parseFloat(getComputedStyle(footer, "::after").height)).toBeGreaterThan(8);
      expect(getComputedStyle(footer, "::after").position).toBe("absolute");
      // The double tick shows over a wallpaper and turns the info colour once seen.
      const receipt = document.querySelector<HTMLElement>(".user-message-receipt")!;
      expect(getComputedStyle(receipt).display).not.toBe("none");
      expect(getComputedStyle(receipt).color).not.toBe(
        getComputedStyle(document.querySelector(".user-message-content")!).color,
      );
      // The newest message's chip floats below its bubble; the clipping timeline must leave it room.
      expect(getComputedStyle(timeline).paddingBottom).toBe("48px");
      const footerBox = footer.getBoundingClientRect();
      const timelineBox = timeline.getBoundingClientRect();
      expect(footerBox.bottom).toBeLessThanOrEqual(timelineBox.bottom + 0.5);
      // The user's hover chip hangs below its bubble and must clear the next message's avatar.
      const promptChip = document.querySelector<HTMLElement>(".user-message-actions")!;
      expect(promptChip.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        avatar.getBoundingClientRect().top + 0.5,
      );
      // The hover actions size to their own text: the timestamp never spills out of its glass.
      const actions = document.querySelector<HTMLElement>(".user-message-actions")!;
      expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth + 1);
      expect(getComputedStyle(actions).maxWidth).toBe("none");
      // Chat-bubble tails: the agent's bottom-left and the user's bottom-right corners tighten.
      const rail = getComputedStyle(document.querySelector("[data-assistant-rail]")!);
      const prompt = getComputedStyle(document.querySelector(".user-message-content")!);
      expect(parseFloat(rail.borderBottomLeftRadius)).toBeLessThan(
        parseFloat(rail.borderBottomRightRadius),
      );
      expect(parseFloat(prompt.borderBottomRightRadius)).toBeLessThan(
        parseFloat(prompt.borderBottomLeftRadius),
      );
      // The copy button is a plain icon with no highlight disc.
      const copy = getComputedStyle(document.querySelector("[data-message-copy]")!);
      expect(copy.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      // Dim metadata is lifted to readable contrast while on glass.
      const meta = getComputedStyle(document.querySelector("[data-assistant-rail] p")!);
      expect(meta.color).not.toBe("");
    } finally {
      mockTheme = "dark";
      saveWallpaperPrintStyle("halftone");
      saveIsAgentWallpaperEnabled(false);
      await view.unmount();
    }
  },
);
