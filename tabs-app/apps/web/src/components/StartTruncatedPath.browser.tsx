import "../index.css";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { StartTruncatedPath } from "./StartTruncatedPath";

const path = "apps/web/src/components/agents/companion/designs/DeviceSettingsFile.tsx";

it("keeps the end of a long path visible and drops the start", async () => {
  const view = await render(
    <div style={{ width: 160 }}>
      <StartTruncatedPath path={path} className="font-mono text-[11px]" />
    </div>,
  );
  try {
    const box = view.container.querySelector<HTMLElement>("span[title]")!;
    expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
    const text = box.querySelector("bdi")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, path.length - 1);
    range.setEnd(text, path.length);
    const last = range.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    expect(last.right).toBeLessThanOrEqual(frame.right + 1);
    expect(last.left).toBeGreaterThanOrEqual(frame.left);
    expect(box.title).toBe(path);
  } finally {
    await view.unmount();
  }
});

it("shows a short path whole", async () => {
  const view = await render(
    <div style={{ width: 300 }}>
      <StartTruncatedPath path="src/a.ts" />
    </div>,
  );
  try {
    const box = view.container.querySelector<HTMLElement>("span[title]")!;
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    expect(box.textContent).toBe("src/a.ts");
  } finally {
    await view.unmount();
  }
});
