import "../index.css";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { WallpaperPrintLayer } from "./WallpaperPrintLayer";

function snapshot(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext("2d")!;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let hash = 0;
  for (let index = 3; index < data.length; index += 4) hash = (hash * 31 + data[index]!) | 0;
  return String(hash);
}

for (const style of ["ascii", "dither", "braille", "stipple"] as const) {
  it(`flows the ${style} print: it changes between frames and returns to still`, async () => {
    const view = await render(
      <div style={{ position: "relative", width: 640, height: 360 }}>
        <WallpaperPrintLayer
          url="/wallpapers/wp2394184-anime-sky-wallpapers.jpg"
          style={style}
          strength={2}
          ink="light"
          animate
        />
      </div>,
    );
    try {
      const canvas = view.container.querySelector<HTMLCanvasElement>("canvas")!;
      await vi.waitFor(() => expect(snapshot(canvas)).not.toBe("0"), { timeout: 5000 });
      const frames = new Set<string>();
      for (let index = 0; index < 6; index++) {
        await new Promise((resolve) => setTimeout(resolve, 260));
        frames.add(snapshot(canvas));
      }
      // A moving print produces several distinct frames.
      expect(frames.size).toBeGreaterThan(2);
    } finally {
      await view.unmount();
    }
  });
}

it("holds perfectly still when animation is off", async () => {
  const view = await render(
    <div style={{ position: "relative", width: 640, height: 360 }}>
      <WallpaperPrintLayer
        url="/wallpapers/wp2394184-anime-sky-wallpapers.jpg"
        style="ascii"
        strength={2}
        ink="light"
      />
    </div>,
  );
  try {
    const canvas = view.container.querySelector<HTMLCanvasElement>("canvas")!;
    await vi.waitFor(() => expect(snapshot(canvas)).not.toBe("0"), { timeout: 5000 });
    const first = snapshot(canvas);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(snapshot(canvas)).toBe(first);
  } finally {
    await view.unmount();
  }
});
