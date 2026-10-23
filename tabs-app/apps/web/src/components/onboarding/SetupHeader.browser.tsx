import "../../index.css";
import "../../interface-study.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SetupHeader } from "./SetupHeader";

it("exposes three labelled actions and supports music toggling by keyboard", async () => {
  const wallpaper = vi.fn();
  const skip = vi.fn();
  function Harness() {
    const [playing, setPlaying] = useState(true);
    return (
      <SetupHeader
        logoSrc="/onboarding/app-icon-system.png"
        musicPlaying={playing}
        onToggleMusic={() => setPlaying((value) => !value)}
        onWallpaper={wallpaper}
        onSkip={skip}
      />
    );
  }
  const view = await render(<Harness />);
  try {
    expect(view.container.querySelectorAll("button").length).toBe(3);
    const music = page.getByRole("button", { name: "Music on", exact: true });
    await expect.element(music).toHaveAttribute("aria-pressed", "true");
    await music.click();
    const paused = page.getByRole("button", { name: "Music off", exact: true });
    await expect.element(paused).toHaveAttribute("aria-pressed", "false");
    (paused.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(music).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Wallpaper", exact: true }).click();
    expect(wallpaper).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "Skip setup", exact: true }).click();
    expect(skip).toHaveBeenCalledTimes(1);
  } finally {
    await view.unmount();
  }
});

it.each([320, 390, 1200])(
  "keeps setup controls compact and within a %spx window",
  async (width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 800);
    const view = await render(
      <div style={{ width: "100%", padding: 8, background: "#304c61" }}>
        <SetupHeader
          logoSrc="/onboarding/app-icon-system.png"
          musicPlaying
          onToggleMusic={() => {}}
          onWallpaper={() => {}}
          onSkip={() => {}}
        />
      </div>,
    );
    try {
      await document.fonts.load('400 16px "Manrope"');
      await document.fonts.load('600 14px "Aicon"');
      const titleStyle = getComputedStyle(
        page.getByRole("heading", { name: "Tabs Setup" }).element(),
      );
      expect(titleStyle.fontFamily.split(",")[0]).toBe("Aicon");
      expect(titleStyle.fontWeight).toBe("600");
      expect(titleStyle.textTransform).toBe("none");
      await expect
        .element(page.getByRole("heading", { name: "Tabs Setup", exact: true }))
        .toHaveTextContent("Tabs Setup");
      expect(parseFloat(titleStyle.fontSize)).toBeGreaterThanOrEqual(14);
      expect(parseFloat(titleStyle.fontSize)).toBeLessThanOrEqual(16);
      expect(
        getComputedStyle(
          page.getByRole("button", { name: "Music on", exact: true }).element(),
        ).fontFamily.split(",")[0],
      ).toBe("Manrope");
      expect(titleStyle.fontFamily).not.toBe(
        getComputedStyle(page.getByRole("button", { name: "Music on", exact: true }).element())
          .fontFamily,
      );
      const header = page.getByRole("banner", { name: "Setup controls" }).element();
      const bounds = header.getBoundingClientRect();
      expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
      expect(bounds.right).toBeLessThanOrEqual(width);
      if (width === 1200) {
        expect(bounds.height).toBeLessThanOrEqual(70);
        await page.screenshot({
          element: header,
          path: "__screenshots__/setup-header/desktop.png",
        });
      }
      for (const button of header.querySelectorAll("button")) {
        const control = button.getBoundingClientRect();
        expect(control.left).toBeGreaterThanOrEqual(bounds.left);
        expect(control.right).toBeLessThanOrEqual(bounds.right);
      }
    } finally {
      await view.unmount();
      await page.viewport(viewport.width, viewport.height);
    }
  },
);

it("disables all setup header actions during launch or skip", async () => {
  const view = await render(
    <SetupHeader
      disabled
      logoSrc="/onboarding/app-icon-system.png"
      musicPlaying
      onToggleMusic={() => {}}
      onWallpaper={() => {}}
      onSkip={() => {}}
    />,
  );
  try {
    for (const button of view.container.querySelectorAll("button"))
      expect(button.disabled).toBe(true);
  } finally {
    await view.unmount();
  }
});
