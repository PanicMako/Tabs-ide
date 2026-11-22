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
  it(`lands the halftone intro quickly and reports it (${theme}, ${palette})`, async () => {
    await page.viewport(900, 600);
    let landedAt = 0;
    const started = performance.now();
    const view = await render(
      <div style={{ width: 900, height: 600 }}>
        <SplashScreen
          loader="mascot"
          palette={palette}
          theme={theme}
          onIntroComplete={() => {
            landedAt = performance.now() - started;
          }}
        />
      </div>,
    );
    try {
      await expect.poll(() => landedAt, { timeout: 3_000 }).toBeGreaterThan(0);
      // Snappy: the whole lockup lands in about two seconds.
      expect(landedAt).toBeLessThan(2_300);
      expect(view.container.querySelector(".mm-root[data-motion='halftone']")).not.toBeNull();
      expect(view.container.querySelectorAll(".mm-eye")).toHaveLength(2);
      // The meta counter is driven by the same timeline and lands on 100.
      expect(view.container.querySelector(".mm-meta-count")?.textContent).toBe("100");
      // The lockup: the TABS wordmark sits beside the mascot.
      expect(view.container.querySelector(".mm-word-solid")).not.toBeNull();
      await page.screenshot({
        element: view.container,
        path: `__screenshots__/splash/halftone-${theme}-${palette}.png`,
      });
    } finally {
      await view.unmount();
    }
  });
}

it("reads a retired Molten Glass choice as the mascot and plays the halftone close", async () => {
  let ended = false;
  const view = await render(
    <div style={{ width: 900, height: 600 }}>
      <CloseScreen
        loader="glass"
        palette="mono"
        theme="light"
        phase="closing"
        onIntroEnd={() => {
          ended = true;
        }}
      />
    </div>,
  );
  try {
    expect(view.container.querySelector(".mm-root[data-mode='outro']")).not.toBeNull();
    expect(view.container.querySelector(".mm-meta-signoff")?.textContent).toBe("See you soon");
    await expect.poll(() => ended, { timeout: 3_500 }).toBe(true);
  } finally {
    await view.unmount();
  }
});

it("holds the settled lockup until the close actually starts", async () => {
  let ended = false;
  const view = await render(
    <div style={{ width: 900, height: 600 }}>
      <CloseScreen
        loader="mascot"
        palette="mono"
        theme="dark"
        phase="idle"
        onIntroEnd={() => {
          ended = true;
        }}
      />
    </div>,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(ended).toBe(false);
    expect(view.container.querySelector(".mm-word-solid")).not.toBeNull();
  } finally {
    await view.unmount();
  }
});
