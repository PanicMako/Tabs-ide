import "../../index.css";
import "../../interface-study.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorkbenchPreview } from "./WorkbenchPreview";
import { WelcomeOverview } from "./WelcomeOverview";
import { WallpaperGalleryModal } from "./WallpaperGalleryModal";

type Color = [number, number, number, number];
const canvas = document.createElement("canvas");
canvas.width = canvas.height = 1;
const context = canvas.getContext("2d", { willReadFrequently: true })!;
function color(value: string): Color {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!, a! / 255];
}
function over(front: Color, back: Color): Color {
  return [
    front[0] * front[3] + back[0] * (1 - front[3]),
    front[1] * front[3] + back[1] * (1 - front[3]),
    front[2] * front[3] + back[2] * (1 - front[3]),
    1,
  ];
}
function luminance(rgb: Color): number {
  const linear = rgb.slice(0, 3).map((n) => {
    const channel = n / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
function assertReadable(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.trim();
    const element = node.parentElement!;
    if (!text || element.closest('[aria-hidden="true"], .sr-only')) continue;
    const style = getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility === "hidden") continue;
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      ancestors.unshift(current);
    }
    let background: Color = [255, 255, 255, 1];
    for (const ancestor of ancestors) {
      background = over(color(getComputedStyle(ancestor).backgroundColor), background);
    }
    const foreground = over(color(style.color), background);
    const a = luminance(foreground);
    const b = luminance(background);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(ratio, `Contrast of "${text}": ${style.color} on ${background}`).toBeGreaterThanOrEqual(
      4.5,
    );
  }
}

for (const outer of ["light", "dark"] as const) {
  for (const study of [null, "light", "dark"] as const) {
    it.each(["light", "dark"] as const)(
      `keeps the %s preview readable in ${outer} app / ${study ?? "normal"} chrome`,
      async (mode) => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        await page.viewport(900, 700);
        const html = document.documentElement;
        const previousClass = html.className;
        const previousStudy = html.getAttribute("data-interface-study");
        html.classList.toggle("dark", outer === "dark");
        if (study) html.setAttribute("data-interface-study", study);
        else html.removeAttribute("data-interface-study");
        const view = await render(
          <div style={{ width: 620 }}>
            <WorkbenchPreview mode={mode} />
          </div>,
        );
        try {
          assertReadable(view.container);
          const projects = view.container.querySelectorAll('[data-slot="onboarding-project-tab"]');
          expect(projects.length).toBe(3);
          for (const tab of projects) {
            expect(getComputedStyle(tab).borderBottomLeftRadius).toBe("0px");
          }
          for (const name of [
            "Project 2",
            "Project 3",
            "Project 1",
            "Agents",
            "Launchpad",
            "Git",
            "Browser",
            "Code",
          ]) {
            await view.getByRole("button", { name, exact: true }).click();
            assertReadable(view.container);
          }
          if (outer === "dark" && study === null) {
            await page.screenshot({
              element: view.container.querySelector<HTMLElement>(
                '[data-slot="onboarding-workbench-preview"]',
              )!,
              path: `__screenshots__/onboarding-contrast/${mode}-preview-dark-app.png`,
            });
          }
        } finally {
          await view.unmount();
          await page.viewport(viewport.width, viewport.height);
          html.className = previousClass;
          if (previousStudy === null) html.removeAttribute("data-interface-study");
          else html.setAttribute("data-interface-study", previousStudy);
        }
      },
    );
  }
}

it("keeps setup copy readable over even a bright wallpaper in a light app", async () => {
  const html = document.documentElement;
  const previousClass = html.className;
  html.classList.remove("dark");
  const view = await render(
    <div style={{ background: "white", padding: 20, width: 1100 }}>
      <WelcomeOverview onNext={() => {}} />
    </div>,
  );
  try {
    assertReadable(view.container);
  } finally {
    await view.unmount();
    html.className = previousClass;
  }
});

it.each(["light", "dark"] as const)(
  "keeps wallpaper gallery actions legible in %s mode",
  async (theme) => {
    const view = await render(
      <WallpaperGalleryModal
        isOpen
        theme={theme}
        activeWallpaperUrl=""
        wallpapers={[]}
        onSelectWallpaper={() => {}}
        onClose={() => {}}
      />,
    );
    try {
      const custom = page.getByRole("button", { name: "Add Custom", exact: true });
      await custom.click();
      assertReadable(custom.element() as HTMLElement);
      const add = page.getByRole("button", { name: "Add", exact: true });
      const input = page.getByPlaceholder("Paste image URL (https://...)");
      await input.fill("https://example.com/wallpaper.jpg");
      assertReadable(add.element() as HTMLElement);
      assertReadable(page.getByRole("dialog").element() as HTMLElement);
    } finally {
      await view.unmount();
    }
  },
);
