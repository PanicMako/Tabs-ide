import "../../index.css";
import { beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { BrandIdentitySettings } from "./BrandIdentitySettings";
import { previewTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
const iconState = vi.hoisted(() => ({ preference: "blue-ink" }));
const update = vi.fn();
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({ ...DEFAULT_UNIFIED_SETTINGS, desktopIconTheme: iconState.preference }),
  useUpdateSettings: () => ({ updateSettings: update }),
}));
beforeEach(() => {
  iconState.preference = "blue-ink";
  update.mockReset();
  update.mockImplementation(async (patch: { desktopIconTheme: string }) => {
    iconState.preference = patch.desktopIconTheme;
    return true;
  });
});

it("previews actual artwork on hover without changing the saved icon, and applies only on selection", async () => {
  const view = await render(<BrandIdentitySettings />);
  try {
    await expect
      .element(page.getByRole("button", { name: "Use Afterglow", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByRole("img", { name: "Afterglow app icon", exact: true }))
      .toHaveAttribute("data-variant", "blue-ink");
    expect(view.container.querySelectorAll("button[aria-pressed]").length).toBe(5);
    await page.getByRole("button", { name: "Use Blueprint", exact: true }).hover();
    await expect
      .element(page.getByRole("img", { name: "Blueprint app icon", exact: true }))
      .toBeVisible();
    expect(update).not.toHaveBeenCalled();
    expect(
      view.container.querySelector(".brand-identity-follower")?.getAttribute("data-visible"),
    ).toBe("true");
    await page.getByText("One mascot. Five finishes.", { exact: true }).hover();
    await expect
      .element(page.getByRole("img", { name: "Afterglow app icon", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Use Daybreak", exact: true }).click();
    expect(update).toHaveBeenLastCalledWith({ desktopIconTheme: "blue-white" });
  } finally {
    await view.unmount();
  }
});

it("supports keyboard exploration without silently applying a finish", async () => {
  const view = await render(<BrandIdentitySettings />);
  try {
    const first = view.container.querySelector<HTMLButtonElement>(".brand-identity-row")!;
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(page.getByRole("img", { name: "Daybreak app icon", exact: true }))
      .toBeVisible();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Use Daybreak");
    expect(update).not.toHaveBeenCalled();
    (document.activeElement as HTMLButtonElement).click();
    expect(update).toHaveBeenLastCalledWith({ desktopIconTheme: "blue-white" });
  } finally {
    await view.unmount();
  }
});

it("fits the identity index and context preview at desktop, tablet and phone widths", async () => {
  const theme = snapshotThemeState();
  const view = await render(<BrandIdentitySettings />);
  try {
    for (const width of [1440, 768, 390]) {
      await page.viewport(width, 1000);
      previewTheme(width === 768 ? "tabs-light" : "true-black");
      await page.getByText("One mascot. Five finishes.", { exact: true }).hover();
      await expect
        .element(page.getByRole("img", { name: "Afterglow app icon", exact: true }))
        .toBeVisible();
      const panel = view.container.querySelector<HTMLElement>(".brand-identity")!;
      expect(
        panel.scrollWidth,
        JSON.stringify(
          [...panel.querySelectorAll<HTMLElement>("*")]
            .filter((el) => el.getBoundingClientRect().right > panel.getBoundingClientRect().right)
            .map((el) => [
              el.className,
              el.clientWidth,
              el.scrollWidth,
              getComputedStyle(el).display,
            ]),
        ),
      ).toBeLessThanOrEqual(panel.clientWidth);
      for (const row of panel.querySelectorAll<HTMLElement>(".brand-identity-row")) {
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
      }
      await Promise.allSettled(
        panel.getAnimations({ subtree: true }).map((animation) => animation.finished),
      );
      await page.screenshot({
        element: view.container,
        path: `__screenshots__/identity/index-${width}.png`,
      });
      if (width === 1440) {
        await page.getByRole("button", { name: "Use Moonstone", exact: true }).hover();
        await expect
          .element(page.getByRole("img", { name: "Moonstone app icon", exact: true }))
          .toBeVisible();
        await Promise.allSettled(
          panel.getAnimations({ subtree: true }).map((animation) => animation.finished),
        );
        await page.screenshot({
          element: view.container,
          path: "__screenshots__/identity/index-hover.png",
        });
        await page.getByText("One mascot. Five finishes.", { exact: true }).hover();
      }
    }
  } finally {
    restoreThemeSnapshot(theme);
    await page.viewport(1280, 900);
    await view.unmount();
  }
});

it("keeps the hover logo anchored on pointer selection and preserves the preview slots", async () => {
  const view = await render(<BrandIdentitySettings />);
  try {
    const row = page.getByRole("button", { name: "Use Moonstone", exact: true });
    await row.hover();
    const follower = view.container.querySelector<HTMLElement>(".brand-identity-follower")!;
    const artwork = view.container.querySelector<HTMLElement>(".brand-identity-artwork")!;
    const dock = view.container.querySelector<HTMLElement>(".brand-identity-dock-tabs")!;
    const before = artwork.getBoundingClientRect();
    // Pointer focus is the source of the old sideways jump. It must not enqueue a new anchor.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const transform = follower.style.transform;
    row.element().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(follower.style.transform).toBe(transform);
    await row.click();
    expect(view.container.querySelector(".brand-identity-artwork")).toBe(artwork);
    expect(view.container.querySelector(".brand-identity-dock-tabs")).toBe(dock);
    expect(artwork.getBoundingClientRect().x).toBe(before.x);
    expect(artwork.getBoundingClientRect().width).toBe(before.width);
    expect(view.container.querySelector("figcaption")).toBeNull();
    expect(view.container.querySelectorAll(".brand-identity-neighbor").length).toBe(4);
    expect(view.container.querySelector(".brand-identity-neighbor svg")).toBeNull();
    const style = getComputedStyle(row.element(), "::before");
    expect(style.height).toBe("1px");
    expect(getComputedStyle(row.element(), "::after").height).toBe("1px");
  } finally {
    await view.unmount();
  }
});

it("confirms an applied finish with a distinct animation that can replay after hover", async () => {
  const view = await render(<BrandIdentitySettings />);
  try {
    const row = page.getByRole("button", { name: "Use Moonstone", exact: true });
    await row.hover();
    const preview = view.container.querySelector<HTMLElement>(".brand-identity-preview")!;
    expect(
      preview
        .getAnimations({ subtree: true })
        .some((animation) => animation.id === "identity-apply"),
    ).toBe(false);
    await row.click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Moonstone icon applied.");
    const first = preview
      .getAnimations({ subtree: true })
      .filter((animation) => animation.id === "identity-apply");
    expect(first.length).toBe(2);
    await row.click();
    await expect.poll(() => update.mock.calls.length).toBe(2);
    await expect
      .poll(() =>
        preview
          .getAnimations({ subtree: true })
          .filter((animation) => animation.id === "identity-apply")
          .every((animation) => !first.includes(animation)),
      )
      .toBe(true);
    await Promise.allSettled(
      preview.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/identity/applied-feedback.png",
    });
    await page.getByRole("button", { name: "Use Blueprint", exact: true }).hover();
    await expect
      .element(page.getByRole("button", { name: "Use Moonstone", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(update).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
  }
});
it("does not animate or claim success when saving fails", async () => {
  update.mockResolvedValue(false);
  const view = await render(<BrandIdentitySettings />);
  try {
    await page.getByRole("button", { name: "Use Moonstone", exact: true }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Icon could not be applied");
    expect(
      view.container
        .getAnimations({ subtree: true })
        .some((animation) => animation.id === "identity-apply"),
    ).toBe(false);
  } finally {
    await view.unmount();
  }
});
it("keeps application feedback visible without animation when reduced motion is enabled", async () => {
  const original = window.matchMedia.bind(window);
  const media = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      query === "(prefers-reduced-motion: reduce)"
        ? ({ matches: true } as MediaQueryList)
        : original(query),
    );
  const view = await render(<BrandIdentitySettings />);
  try {
    await page.getByRole("button", { name: "Use Moonstone", exact: true }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Moonstone icon applied.");
    expect(
      view.container
        .getAnimations({ subtree: true })
        .some((animation) => animation.id.startsWith("identity-apply")),
    ).toBe(false);
  } finally {
    await view.unmount();
    media.mockRestore();
  }
});
