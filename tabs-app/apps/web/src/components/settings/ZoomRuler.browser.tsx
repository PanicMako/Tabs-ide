import "../../index.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ZoomRuler } from "./ZoomRuler";

function Harness() {
  const [value, setValue] = useState(1);
  return <ZoomRuler value={value} onValueChange={setValue} />;
}

it("uses existing zoom steps, keyboard bounds, clickable labels and a 100% reset", async () => {
  const view = await render(<Harness />);
  try {
    const slider = page.getByRole("slider", { name: "Interface zoom" });
    await expect.element(slider).toHaveAttribute("aria-valuenow", "100");
    slider.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(slider).toHaveAttribute("aria-valuenow", "110");
    await userEvent.keyboard("{End}");
    await expect.element(slider).toHaveAttribute("aria-valuenow", "150");
    await expect.element(page.getByRole("button", { name: "Zoom in", exact: true })).toBeDisabled();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(slider).toHaveAttribute("aria-valuenow", "150");
    await page.getByRole("button", { name: "Reset zoom to 100%" }).click();
    await expect.element(slider).toHaveAttribute("aria-valuenow", "100");
    await page.getByRole("button", { name: "Zoom to 90%" }).click();
    await expect.element(slider).toHaveAttribute("aria-valuenow", "90");
    slider.element().focus();
    await userEvent.keyboard("{Home}");
    await expect.element(slider).toHaveAttribute("aria-valuenow", "75");
    await expect
      .element(page.getByRole("button", { name: "Zoom out", exact: true }))
      .toBeDisabled();
  } finally {
    await view.unmount();
  }
});
it("previews dragging without resizing the app until release, and cancels without saving", async () => {
  const changed = vi.fn();
  const view = await render(<ZoomRuler value={1} onValueChange={changed} />);
  try {
    const slider = page.getByRole("slider", { name: "Interface zoom" });
    const node = slider.element();
    vi.spyOn(node, "setPointerCapture").mockImplementation(() => {});
    vi.spyOn(node, "releasePointerCapture").mockImplementation(() => {});
    const bounds = node.getBoundingClientRect(),
      x = bounds.left + bounds.width / 2;
    const fire = (type: string, clientX: number) =>
      node.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          isPrimary: true,
          button: 0,
          clientX,
        }),
      );
    fire("pointerdown", x);
    fire("pointermove", x - 52);
    await expect.element(slider).toHaveAttribute("aria-valuenow", "110");
    expect(changed).not.toHaveBeenCalled();
    fire("pointerup", x - 52);
    expect(changed).toHaveBeenCalledExactlyOnceWith(1.1);
    changed.mockClear();
    fire("pointerdown", x);
    fire("pointermove", x - 104);
    fire("pointercancel", x - 104);
    await expect.element(slider).toHaveAttribute("aria-valuenow", "100");
    expect(changed).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    await view.unmount();
  }
});
it("fits narrow settings rows, follows theme tokens and respects reduced motion", async () => {
  const previous = document.documentElement.dataset.reducedMotion;
  const view = await render(
    <div style={{ width: 260, "--primary": "rgb(12, 34, 56)" } as React.CSSProperties}>
      <ZoomRuler value={1} onValueChange={() => {}} />
    </div>,
  );
  try {
    const slider = page.getByRole("slider", { name: "Interface zoom" });
    const control = slider.element().closest<HTMLElement>(".zoom-ruler-control")!;
    expect(control.scrollWidth).toBeLessThanOrEqual(260);
    expect(getComputedStyle(control.querySelector(".zoom-ruler-needle")!).backgroundColor).toBe(
      "rgb(12, 34, 56)",
    );
    document.documentElement.dataset.reducedMotion = "reduce";
    expect(getComputedStyle(control.querySelector(".zoom-ruler-tape")!).transitionDuration).toBe(
      "0s",
    );
  } finally {
    if (previous) document.documentElement.dataset.reducedMotion = previous;
    else delete document.documentElement.dataset.reducedMotion;
    await view.unmount();
  }
});
