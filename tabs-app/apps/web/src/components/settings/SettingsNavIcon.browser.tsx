import "../../index.css";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SettingsNavIcon } from "./SettingsNavIcon";

const previousMotion = document.documentElement.dataset.reducedMotion;
afterEach(() => {
  if (previousMotion) document.documentElement.dataset.reducedMotion = previousMotion;
  else delete document.documentElement.dataset.reducedMotion;
});

it("animates the robot's internal parts on keyboard focus, without moving the navigation target", async () => {
  document.documentElement.dataset.reducedMotion = "no-preference";
  const view = await render(
    <button data-settings-nav-item="providers" style={{ width: 190, height: 36 }}>
      <SettingsNavIcon kind="providers" style={{ width: 20, height: 20 }} />
      Providers
    </button>,
  );
  try {
    const button = page.getByRole("button", { name: "Providers" });
    const node = button.element();
    const eye = node.querySelector(".sni-robot-eye")!;
    const before = node.getBoundingClientRect();
    expect(getComputedStyle(eye).animationName).toBe("none");
    await userEvent.keyboard("{Tab}");
    await expect.element(button).toHaveFocus();
    expect(getComputedStyle(eye).animationName).toBe("sni-blink");
    expect(getComputedStyle(eye).animationIterationCount).toBe("1");
    expect(node.getBoundingClientRect().toJSON()).toEqual(before.toJSON());
    expect(node.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  } finally {
    await view.unmount();
  }
});

it("keeps the reference shapes theme-aware and disables internal motion with reduced motion", async () => {
  const view = await render(
    <button data-settings-nav-item="labs" style={{ color: "rgb(21, 84, 138)" }}>
      <SettingsNavIcon kind="labs" style={{ width: 20, height: 20 }} />
      Labs
    </button>,
  );
  try {
    const button = page.getByRole("button", { name: "Labs" });
    await userEvent.hover(button);
    const bubble = button.element().querySelector(".sni-bubble-first")!;
    expect(getComputedStyle(bubble).fill).toBe("rgb(21, 84, 138)");
    document.documentElement.dataset.reducedMotion = "reduce";
    expect(getComputedStyle(bubble).animationName).toBe("none");
    expect(button.element().querySelectorAll("svg")).toHaveLength(1);
  } finally {
    await view.unmount();
  }
});

it("respects the app animation-off setting even when the pointer is over a selected page", async () => {
  document.documentElement.dataset.reducedMotion = "no-preference";
  const view = await render(
    <nav data-settings-icon-motion="off">
      <button data-settings-nav-item="workspace" aria-current="page">
        <SettingsNavIcon kind="workspace" style={{ width: 20, height: 20 }} />
        Workspace
      </button>
    </nav>,
  );
  try {
    const button = page.getByRole("button", { name: "Workspace" });
    await userEvent.hover(button);
    expect(getComputedStyle(button.element().querySelector(".sni-lamp")!).animationName).toBe(
      "none",
    );
  } finally {
    await view.unmount();
  }
});

it.each([
  { kind: "providers" as const, part: ".sni-robot-eye", animation: "sni-blink" },
  { kind: "general" as const, part: ".sni-compass-needle", animation: "sni-compass" },
])(
  "loops the selected $kind icon without hover and stops when deselected",
  async ({ kind, part, animation }) => {
    document.documentElement.dataset.reducedMotion = "no-preference";
    const view = await render(
      <button data-settings-nav-item={kind} aria-current="page">
        <SettingsNavIcon kind={kind} style={{ width: 20, height: 20 }} />
        Selected provider
      </button>,
    );
    try {
      const button = page.getByRole("button", { name: "Selected provider" });
      const node = button.element();
      const eye = node.querySelector(part)!;
      expect(node.matches(":hover")).toBe(false);
      expect(getComputedStyle(eye).animationName).toBe(animation);
      expect(getComputedStyle(eye).animationIterationCount).toBe("infinite");
      expect(getComputedStyle(eye).animationDuration).toBe(kind === "general" ? "5.6s" : "3.6s");
      if (kind === "general") {
        const effect = eye.getAnimations()[0]?.effect as KeyframeEffect | undefined;
        expect(effect).toBeDefined();
        const angles = effect!
          .getKeyframes()
          .map((frame) =>
            Number.parseFloat(String(frame.transform).match(/rotate\(([-\d.]+)deg\)/)?.[1] ?? "0"),
          );
        expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(10);
        expect(node.querySelector("svg")!.getAnimations()).toHaveLength(0);
      }
      node.removeAttribute("aria-current");
      expect(getComputedStyle(eye).animationName).toBe("none");
    } finally {
      await view.unmount();
    }
  },
);
