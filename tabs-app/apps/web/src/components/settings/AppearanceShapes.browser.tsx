import "../../index.css";
import "../../localFonts.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ThemesSettings } from "./ThemesSettings";
import { AnimationsSettings } from "./AnimationsSettings";
import { SplashScreen } from "../SplashScreen";
import { CloseScreen } from "../CloseScreen";
import { Button } from "../ui/button";
import { Group } from "../ui/group";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { previewTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";

vi.mock("../../state/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/settings")>()),
  useServerConfig: () => null,
}));

it("keeps theme, font and animation specimens rectangular with gentle corners", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const savedTheme = snapshotThemeState();
  for (const component of [<ThemesSettings />, <AnimationsSettings />]) {
    await page.viewport(1280, 900);
    const view = await render(component);
    try {
      const cards = view.container.querySelectorAll('[data-shape="preview"]');
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) expect(getComputedStyle(card).borderRadius).toBe("28px");
      for (const thumbnail of view.container.querySelectorAll('[data-shape="thumbnail"]')) {
        expect(getComputedStyle(thumbnail).borderRadius).toBe("24px");
      }
      await document.fonts.ready;
      previewTheme("true-black");
      await page.screenshot({
        element:
          cards[0]!.closest('[data-slot="settings-section-panel"]') ?? cards[0]!.parentElement!,
        path: `__screenshots__/appearance-shapes/${component.type === ThemesSettings ? "themes" : "animation-fonts"}.png`,
      });
      const font = view.container.querySelector('[data-shape="preview"][aria-label^="Select "]');
      if (font) {
        await page.screenshot({
          element: font.parentElement!,
          path: "__screenshots__/appearance-shapes/fonts.png",
        });
      }
      await page.viewport(390, 844);
      for (const specimen of view.container.querySelectorAll('[data-slot="font-specimen"]')) {
        expect(specimen.scrollWidth).toBeLessThanOrEqual(specimen.clientWidth + 1);
      }
    } finally {
      await view.unmount();
      restoreThemeSnapshot(savedTheme);
      await page.viewport(viewport.width, viewport.height);
    }
  }
});

it("preserves the squarish split-flap tiles in both startup and close animations", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(540, 700);
  const view = await render(
    <>
      <div data-testid="startup-preview" style={{ width: 480, height: 280 }}>
        <SplashScreen loader="solari" palette="mono" theme="dark" />
      </div>
      <div data-testid="close-preview" style={{ width: 480, height: 280 }}>
        <CloseScreen loader="solari" palette="mono" theme="dark" phase="holding" />
      </div>
    </>,
  );
  try {
    const tiles = view.container.querySelectorAll('[data-shape="tile"]');
    expect(tiles.length).toBe(16);
    for (const tile of tiles) expect(getComputedStyle(tile).borderRadius).toBe("10px");
    await page.getByTestId("startup-preview").screenshot({
      path: "__screenshots__/appearance-shapes/startup.png",
    });
    await page.getByTestId("close-preview").screenshot({
      path: "__screenshots__/appearance-shapes/close.png",
    });
  } finally {
    await view.unmount();
    await page.viewport(viewport.width, viewport.height);
  }
});

it("keeps split buttons joined and caps the rounding on unclassified large cards", async () => {
  const view = await render(
    <>
      <div data-slot="joined-control">
        <Button aria-label="Send" className="rounded-l-lg rounded-r-none">
          Send
        </Button>
        <Button aria-label="Schedule" className="rounded-l-none rounded-r-lg">
          Schedule
        </Button>
      </div>
      <Group>
        <Button>First</Button>
        <Button>Second</Button>
      </Group>
      <Group orientation="vertical">
        <Button>Top</Button>
        <Button>Bottom</Button>
      </Group>
      <ToggleGroup variant="outline" defaultValue={["one"]}>
        <Toggle value="one">One</Toggle>
        <Toggle value="two">Two</Toggle>
      </ToggleGroup>
      <button style={{ width: 240, height: 160 }} data-testid="large-card">
        Content card
      </button>
    </>,
  );
  try {
    const buttons = view.container.querySelectorAll("button");
    expect(getComputedStyle(buttons[0]!).borderTopLeftRadius).toBe("16px");
    expect(getComputedStyle(buttons[0]!).borderTopRightRadius).toBe("0px");
    expect(getComputedStyle(buttons[1]!).borderTopLeftRadius).toBe("0px");
    expect(getComputedStyle(buttons[1]!).borderTopRightRadius).toBe("16px");
    expect(getComputedStyle(buttons[2]!).borderTopRightRadius).toBe("0px");
    expect(getComputedStyle(buttons[3]!).borderTopLeftRadius).toBe("0px");
    expect(getComputedStyle(buttons[4]!).borderBottomLeftRadius).toBe("0px");
    expect(getComputedStyle(buttons[5]!).borderTopLeftRadius).toBe("0px");
    expect(getComputedStyle(buttons[6]!).borderTopRightRadius).toBe("0px");
    expect(getComputedStyle(buttons[7]!).borderTopLeftRadius).toBe("0px");
    expect(getComputedStyle(buttons[8]!).borderRadius).toBe("36px");
  } finally {
    await view.unmount();
  }
});
