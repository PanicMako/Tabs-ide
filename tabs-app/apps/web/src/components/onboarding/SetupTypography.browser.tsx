import "../../index.css";
import "../../interface-study.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WelcomeOverview } from "./WelcomeOverview";
import { AppIconStep, AppearanceStep } from "./PersonalizeSteps";
import { WallpaperGalleryModal } from "./WallpaperGalleryModal";

it("keeps every setup step on bundled KS Bistra/Pavot/Manrope pairing when app typography changes", async () => {
  const html = document.documentElement;
  const savedStyle = html.getAttribute("style");
  const savedClass = html.className;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1200, 1300);
  const view = await render(
    <div
      style={{
        width: 1100,
        padding: 24,
        backgroundImage: "url(/wallpapers/wp2394184-anime-sky-wallpapers.jpg)",
        backgroundSize: "cover",
      }}
    >
      <p data-testid="app-text" style={{ fontFamily: "var(--font-sans)" }}>
        Application font
      </p>
      <WelcomeOverview onNext={() => {}} />
      <AppIconStep selected="system" onSelect={() => {}} onBack={() => {}} onNext={() => {}} />
      <AppearanceStep
        selected="light"
        resolvedMode="light"
        onSelect={() => {}}
        onBack={() => {}}
        onLaunch={() => {}}
        launching={false}
      />
    </div>,
  );
  try {
    expect((await document.fonts.load('400 16px "KS Bistra"')).length).toBeGreaterThan(0);
    expect((await document.fonts.load('400 16px "Manrope"')).length).toBeGreaterThan(0);
    expect((await document.fonts.load('500 16px "Manrope"')).length).toBeGreaterThan(0);
    expect((await document.fonts.load('italic 700 16px "Pavot"')).length).toBeGreaterThan(0);
    for (const family of ['"Courier New", monospace', '"Georgia", serif']) {
      html.classList.toggle("dark", family.includes("Georgia"));
      for (const role of [
        "sans",
        "display",
        "controls",
        "mono",
        "section",
        "supporting",
        "row",
        "ui-meta",
      ]) {
        html.style.setProperty(`--font-${role}`, family);
      }
      expect(
        getComputedStyle(view.getByTestId("app-text").element()).fontFamily.replaceAll('"', ""),
      ).toBe(family.replaceAll('"', ""));
      const cards = view.container.querySelectorAll("section.setup-typography");
      expect(cards.length).toBe(3);
      for (const [index, card] of Array.from(cards).entries()) {
        expect(card.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
          `Setup step ${index + 1} of 3`,
        );
        const heading = getComputedStyle(card.querySelector("h2")!);
        expect(heading.fontWeight).toBe("400");
        expect(parseFloat(heading.webkitTextStrokeWidth)).toBe(0);

        const background = getComputedStyle(card).backgroundColor;
        const paint = document.createElement("canvas").getContext("2d")!;
        paint.fillStyle = background;
        paint.fillRect(0, 0, 1, 1);
        const alpha = paint.getImageData(0, 0, 1, 1).data[3]! / 255;
        expect(alpha).toBeLessThanOrEqual(0.65);
        expect(alpha).toBeGreaterThanOrEqual(0.4);
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (!node.textContent?.trim()) continue;
          expect(
            getComputedStyle(node.parentElement!).fontFamily.split(",")[0]!.replaceAll('"', ""),
          ).toBe(
            node.parentElement!.closest(".setup-heading-accent")
              ? "Pavot"
              : node.parentElement!.closest("h1, h2, h3")
                ? "KS Bistra"
                : "Manrope",
          );
        }
      }
    }
    const welcome = view.container.querySelector("section")!;
    const titleBounds = welcome.querySelector("h2")!.getBoundingClientRect();
    const previewBounds = welcome
      .querySelector('[data-slot="setup-welcome-preview"]')!
      .getBoundingClientRect();
    expect(titleBounds.right).toBeLessThan(previewBounds.left);
    expect(welcome.getBoundingClientRect().width).toBeLessThanOrEqual(960);
    expect(welcome.getBoundingClientRect().height).toBeLessThan(720);
    const accent = view.container.querySelector<HTMLElement>(".setup-heading-accent")!;
    const accentStyle = getComputedStyle(accent);
    expect(accentStyle.fontWeight).toBe("700");
    expect(accentStyle.fontStyle).toBe("italic");
    expect(parseFloat(accentStyle.webkitTextStrokeWidth)).toBe(0);
    const mainSize = parseFloat(getComputedStyle(welcome.querySelector("h2")!).fontSize);
    expect(parseFloat(accentStyle.fontSize)).toBeGreaterThanOrEqual(mainSize * 0.95);
    expect(parseFloat(accentStyle.fontSize)).toBeLessThanOrEqual(mainSize * 1.15);
    expect(accent.getBoundingClientRect().height).toBeLessThan(
      parseFloat(accentStyle.lineHeight) * 1.1,
    );
    expect(parseFloat(accentStyle.letterSpacing)).toBeGreaterThan(1);
    expect(accent.getBoundingClientRect().top).toBeGreaterThan(
      accent.previousElementSibling!.getBoundingClientRect().bottom,
    );
    const wallpaper = new Image();
    wallpaper.src = "/wallpapers/wp2394184-anime-sky-wallpapers.jpg";
    await wallpaper.decode();
    for (const [index, name] of ["welcome", "app-icon", "appearance"].entries()) {
      await page.screenshot({
        element: view.container.querySelectorAll("section")[index]!,
        path: `__screenshots__/setup-typography/${name}.png`,
      });
    }
  } finally {
    await view.unmount();
    if (savedStyle === null) html.removeAttribute("style");
    else html.setAttribute("style", savedStyle);
    html.className = savedClass;
    await page.viewport(viewport.width, viewport.height);
  }
});

it.each([false, true])(
  "scopes wallpaper portal typography to its caller (setup: %s)",
  async (setupTypography) => {
    const savedStyle = document.documentElement.getAttribute("style");
    for (const role of ["sans", "controls"])
      document.documentElement.style.setProperty(`--font-${role}`, '"Courier New", monospace');
    const view = await render(
      <WallpaperGalleryModal
        isOpen
        setupTypography={setupTypography}
        activeWallpaperUrl=""
        wallpapers={[]}
        onSelectWallpaper={() => {}}
        onClose={() => {}}
      />,
    );
    try {
      const expected = setupTypography ? "Manrope" : '"Courier New"';
      expect(
        getComputedStyle(
          page.getByRole("heading", { name: "Wallpaper Gallery" }).element(),
        ).fontFamily.split(",")[0],
      ).toBe(setupTypography ? '"KS Bistra"' : expected);
      expect(
        getComputedStyle(
          page.getByRole("button", { name: "Add Custom", exact: true }).element(),
        ).fontFamily.split(",")[0],
      ).toBe(expected);
    } finally {
      await view.unmount();
      if (savedStyle === null) document.documentElement.removeAttribute("style");
      else document.documentElement.setAttribute("style", savedStyle);
    }
  },
);

it("keeps all three setup cards within a narrow window with the thicker headings", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(390, 844);
  const view = await render(
    <div style={{ padding: 12 }}>
      <WelcomeOverview onNext={() => {}} />
      <AppIconStep selected="system" onSelect={() => {}} onBack={() => {}} onNext={() => {}} />
      <AppearanceStep
        selected="system"
        resolvedMode="dark"
        onSelect={() => {}}
        onBack={() => {}}
        onLaunch={() => {}}
        launching={false}
      />
    </div>,
  );
  try {
    await document.fonts.load('400 44px "KS Bistra"');
    await document.fonts.load('400 16px "Manrope"');
    for (const card of view.container.querySelectorAll<HTMLElement>("section")) {
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
      expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(390);
      const bounds = card.getBoundingClientRect();
      for (const button of card.querySelectorAll("button")) {
        // Tool tabs intentionally scroll horizontally inside the clipped preview.
        if (button.closest('[aria-label="Explore project tools"]')) continue;
        expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(bounds.left);
        expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
      }
    }
  } finally {
    await view.unmount();
    await page.viewport(viewport.width, viewport.height);
  }
});
