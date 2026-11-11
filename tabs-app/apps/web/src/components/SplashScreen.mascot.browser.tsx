import "../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SplashScreen } from "./SplashScreen";
import { CloseScreen } from "./CloseScreen";

for (const [theme, palette] of [
  ["dark", "mono"],
  ["light", "mono"],
  ["dark", "block"],
] as const) {
  it(`plays the mascot intro (${theme}, ${palette})`, async () => {
    await page.viewport(900, 600);
    const view = await render(
      <div style={{ width: 900, height: 600 }}>
        <SplashScreen loader="mascot" palette={palette} theme={theme} />
      </div>,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 1700));
      expect(view.container.querySelector(".tabs-stroll")).not.toBeNull();
      expect(view.container.querySelectorAll(".tabs-mascot-eye")).toHaveLength(2);
      await page.screenshot({
        element: view.container,
        path: `__screenshots__/splash/mascot-${theme}-${palette}.png`,
      });
    } finally {
      await view.unmount();
    }
  });
}

it("reads a retired Molten Glass choice as the mascot and plays the goodbye", async () => {
  const view = await render(
    <div style={{ width: 900, height: 600 }}>
      <CloseScreen loader="glass" palette="mono" theme="dark" phase="closing" />
    </div>,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(view.container.querySelector(".tabs-bed[data-phase='closing']")).not.toBeNull();
    expect(view.container.textContent).toContain("Shutting down");
    expect(view.container.textContent).toContain("Bye, see you soon!");
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/splash/mascot-goodbye.png",
    });
  } finally {
    await view.unmount();
  }
});

it("tucks the mascot into bed", async () => {
  await page.viewport(1200, 760);
  const view = await render(
    <div style={{ width: 1200, height: 760 }}>
      <CloseScreen loader="mascot" palette="mono" theme="dark" phase="closing" />
    </div>,
  );
  const scene = view.container.querySelector<HTMLElement>(".tabs-bed")!;
  try {
    for (const [name, atMs] of [
      ["1-bye", 800],
      ["2-hop", 1650],
      ["3-tuck", 2500],
      ["4-asleep", 3550],
    ] as const) {
      for (const animation of scene.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = atMs;
      }
      await page.screenshot({
        element: view.container,
        path: `__screenshots__/splash/bed-${name}.png`,
      });
    }
  } finally {
    await view.unmount();
  }
});

it("walks in, hammers the broken app back together and counts up to 100", async () => {
  await page.viewport(1200, 760);
  const view = await render(
    <div id="curtain" style={{ width: 1200, height: 760, overflow: "hidden" }}>
      <SplashScreen loader="mascot" palette="mono" theme="dark" />
    </div>,
  );
  const stroll = view.container.querySelector<HTMLElement>(".tabs-stroll")!;
  // Screenshots take real time, so each frame freezes the timeline at a set moment.
  const freeze = (atMs: number) => {
    for (const animation of stroll.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = atMs;
    }
  };
  const shot = async (name: string, atMs: number) => {
    freeze(atMs);
    await page.screenshot({
      element: view.container,
      path: `__screenshots__/splash/stroll-${name}.png`,
    });
  };
  const [running, done] = view.container.querySelectorAll<HTMLElement>(".tabs-gag-count");
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(view.container.querySelector(".tabs-app")).not.toBeNull();
    expect(view.container.querySelectorAll(".tabs-flag-strip")).toHaveLength(35);
    await shot("1-walking", 1200);
    await shot("2-windup", 2860);
    await shot("3-first-hit", 3040);
    await shot("4-last-hit", 4040);
    await shot("5-flag-throw", 4400);
    await shot("6-fling", 5280);
    await shot("7-walk-to-pole", 5650);
    await shot("8-repaired", 6500);
    const flag = view.container.querySelector(".tabs-stroll-flag")!.getBoundingClientRect();
    expect(Math.abs(flag.left + flag.width / 2 - 600)).toBeLessThan(12);
    // It waits at 99 until the workspace is ready, then completes.
    expect(getComputedStyle(running!).opacity).not.toBe("0");
    expect(getComputedStyle(done!).opacity).toBe("0");
    view.container.querySelector<HTMLElement>("#curtain")!.dataset.leaving = "true";
    expect(getComputedStyle(running!).opacity).toBe("0");
    expect(getComputedStyle(done!).opacity).toBe("1");
    expect(done!.textContent).toBe("100");
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/splash/stroll-9-done.png",
    });
  } finally {
    await view.unmount();
  }
});
