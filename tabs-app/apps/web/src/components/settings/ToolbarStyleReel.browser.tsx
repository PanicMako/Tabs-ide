import "../../index.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ToolbarStyle } from "@tabs/contracts/settings";
import { previewTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
import { ToolbarStyleReel } from "./ToolbarStyleReel";

const motion = vi.hoisted(() => ({ reduced: true }));
vi.mock("../../panelAnimations", () => ({
  usePanelAnimationSettings: () => ({ reducedMotion: motion.reduced }),
}));

it("previews with arrows, scroll and keyboard, and applies only on request", async () => {
  const onApply = vi.fn();
  function Fixture() {
    const [style, setStyle] = useState<ToolbarStyle>("solid");
    return (
      <ToolbarStyleReel
        value={style}
        onApply={(value) => {
          onApply(value);
          setStyle(value);
        }}
      />
    );
  }
  const view = await render(<Fixture />);
  try {
    const track = page.getByRole("region", { name: "Toolbar style previews" });
    const next = page.getByRole("button", { name: "Next toolbar style" });
    const progress = page.getByRole("progressbar", { name: "Toolbar style position" });
    const thumb = progress.element().firstElementChild!;
    const thumbOffset = () => parseFloat(getComputedStyle(thumb).left);
    expect(thumbOffset()).toBe(0);
    await next.click();
    await expect.element(page.getByRole("heading", { name: "Aurora" })).toBeVisible();
    await next.click();
    await expect.element(page.getByRole("heading", { name: "Rim Light" })).toBeVisible();
    await expect.element(progress).toHaveAttribute("aria-valuenow", "3");
    await expect.poll(thumbOffset).toBeGreaterThan(0);
    expect(onApply).not.toHaveBeenCalled();

    const browserTrack = track.element();
    const lens = track.getByRole("button", { name: "Frosted Lens" }).element();
    const lensBounds = lens.getBoundingClientRect();
    browserTrack.scrollLeft +=
      lensBounds.left +
      lensBounds.width / 2 -
      browserTrack.getBoundingClientRect().left -
      browserTrack.clientWidth / 2;
    await expect.element(page.getByRole("heading", { name: "Frosted Lens" })).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();

    (browserTrack as HTMLElement).focus();
    await userEvent.keyboard("{End}");
    await expect.element(page.getByRole("heading", { name: "Focus Pull" })).toBeVisible();
    await expect.element(next).toBeDisabled();
    await expect.element(progress).toHaveAttribute("aria-valuenow", "7");
    await expect.poll(thumbOffset).toBeGreaterThan(progress.element().clientWidth * 0.8);
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(progress).toHaveAttribute("aria-valuenow", "6");
    await expect.poll(thumbOffset).toBeLessThan(progress.element().clientWidth * 0.8);
    await page.getByRole("button", { name: "Use this style" }).click();
    expect(onApply).toHaveBeenCalledExactlyOnceWith("dot");
    await expect.element(page.getByRole("button", { name: "In use", exact: true })).toBeDisabled();
  } finally {
    await view.unmount();
  }
});

it.each([
  ["true-black", 1100],
  ["solarized-light", 390],
] as const)("centers Frosted Lens in %s at %d pixels", async (theme, width) => {
  const viewport = { width: innerWidth, height: innerHeight };
  const snapshot = snapshotThemeState();
  previewTheme(theme);
  await page.viewport(width, 850);
  const view = await render(
    <section className="toolbar-style-panel mx-auto max-w-4xl border">
      <ToolbarStyleReel value="refraction" onApply={() => {}} />
    </section>,
  );
  try {
    const track = page.getByRole("region", { name: "Toolbar style previews" });
    await expect.element(page.getByRole("heading", { name: "Frosted Lens" })).toBeVisible();
    const tile = track.getByRole("button", { name: /^Frosted Lens/ });
    await expect
      .poll(() => {
        const bounds = track.element().getBoundingClientRect();
        const preview = tile.element().getBoundingClientRect();
        return Math.abs(bounds.left + bounds.width / 2 - preview.left - preview.width / 2);
      })
      .toBeLessThan(2);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const lensTrack = tile.element().querySelector(".design-refraction")!;
    const trackStyle = getComputedStyle(lensTrack);
    expect(trackStyle.backgroundImage).toContain("radial-gradient");
    expect(trackStyle.backgroundClip).toBe("content-box, padding-box");
    expect(getComputedStyle(lensTrack.querySelector(".active-pill")!).backdropFilter).toBe(
      "blur(2.8px)",
    );
    await page.screenshot({
      element: view.container.querySelector("section")!,
      path: `__screenshots__/toolbar-style/frosted-lens-${theme}-${width}.png`,
    });
  } finally {
    await view.unmount();
    restoreThemeSnapshot(snapshot);
    await page.viewport(viewport.width, viewport.height);
  }
});

it("keeps Rim Light horizontal while its light sweeps and supports pausing the reel", async () => {
  const viewport = { width: innerWidth, height: innerHeight };
  await page.viewport(1100, 850);
  const snapshot = snapshotThemeState();
  const html = document.documentElement;
  const previousMotion = html.getAttribute("data-reduced-motion");
  motion.reduced = false;
  html.dataset.reducedMotion = "no-preference";
  previewTheme("true-black");
  const view = await render(
    <section className="toolbar-style-panel mx-auto max-w-4xl border">
      <span hidden data-accent-swatch style={{ color: "oklch(from var(--primary) l c h)" }} />
      <ToolbarStyleReel value="ghost-mesh" onApply={() => {}} />
    </section>,
  );
  try {
    const track = page.getByRole("region", { name: "Toolbar style previews" });
    const next = page.getByRole("button", { name: "Next toolbar style" });
    const aurora = track.getByRole("button", { name: /^Aurora/ }).element();
    const auroraEffect = aurora.querySelector(".toolbar-pill-effect")!;
    await expect
      .poll(() => getComputedStyle(auroraEffect).animationName)
      .toBe("toolbar-aurora-drift");
    expect(getComputedStyle(auroraEffect).animationIterationCount).toBe("infinite");
    const accent = view.container.querySelector("[data-accent-swatch]")!;
    const hue = (color: string) => Number(/oklch\(\S+ \S+ ([\d.]+)/.exec(color)?.[1]);
    const accentHue = hue(getComputedStyle(accent).color);
    expect(hue(getComputedStyle(auroraEffect).backgroundImage)).toBeCloseTo(accentHue);
    const [drift] = auroraEffect.getAnimations();
    drift!.pause();
    drift!.currentTime = 2500;
    await page.screenshot({
      element: view.container.querySelector("section")!,
      path: "__screenshots__/toolbar-style/aurora-true-black.png",
    });
    previewTheme("deep-blue");
    expect(hue(getComputedStyle(accent).color)).not.toBeCloseTo(accentHue);
    expect(hue(getComputedStyle(auroraEffect).backgroundImage)).toBeCloseTo(
      hue(getComputedStyle(accent).color),
    );
    await next.click();
    const rim = track.getByRole("button", { name: "Rim Light" });
    await expect.element(rim).toHaveAttribute("aria-current", "true");
    const effect = rim.element().querySelector(".toolbar-pill-effect")!;
    await expect
      .poll(() => getComputedStyle(effect, "::before").animationName)
      .toBe("toolbar-rim-sweep");
    const start = getComputedStyle(effect, "::before").transform;
    await expect.poll(() => getComputedStyle(effect, "::before").transform).not.toBe(start);
    expect(getComputedStyle(effect).transform).toBe("none");

    await page.getByRole("button", { name: "Pause preview" }).click();
    expect(getComputedStyle(effect, "::before").animationPlayState).toBe("paused");
    await page.getByRole("button", { name: "Resume preview" }).click();
    expect(getComputedStyle(effect, "::before").animationPlayState).toBe("running");
    html.dataset.reducedMotion = "reduce";
    expect(getComputedStyle(effect, "::before").animationName).toBe("none");

    await next.click();
    await next.click();
    const clay = track.getByRole("button", { name: "Soft Clay" });
    await expect.element(clay).toHaveAttribute("aria-current", "true");
    const card = clay.element();
    const sample = card.querySelector(".nav-track")!;
    expect(getComputedStyle(card).height).toBe("148px");
    expect(getComputedStyle(card).borderRadius).toBe("32px");
    expect(getComputedStyle(sample).borderRadius).toBe("999px");
    expect(getComputedStyle(sample.querySelector(".active-pill")!).borderRadius).toBe("999px");
    await expect
      .poll(() => {
        const rail = track.element().getBoundingClientRect();
        const bounds = card.getBoundingClientRect();
        return Math.abs(rail.left + rail.width / 2 - bounds.left - bounds.width / 2);
      })
      .toBeLessThan(2);
    await page.screenshot({
      element: view.container.querySelector("section")!,
      path: "__screenshots__/toolbar-style/soft-clay-grove.png",
    });
  } finally {
    await view.unmount();
    if (previousMotion === null) html.removeAttribute("data-reduced-motion");
    else html.setAttribute("data-reduced-motion", previousMotion);
    motion.reduced = true;
    restoreThemeSnapshot(snapshot);
    await page.viewport(viewport.width, viewport.height);
  }
});
