import "../../index.css";
import { useState, type CSSProperties } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PanelAnimationPill } from "./PanelAnimationPill";

function Harness() {
  const [value, setValue] = useState(150);
  return <PanelAnimationPill value={value} onValueChange={setValue} />;
}

it("supports native keyboard steps, Off, and both duration bounds", async () => {
  const view = await render(<Harness />);
  try {
    const slider = page.getByRole("slider", { name: "Panel animation duration" });
    slider.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(slider).toHaveValue("175");
    await userEvent.keyboard("{Home}");
    await expect.element(slider).toHaveValue("0");
    await expect.element(slider).toHaveAttribute("aria-valuetext", "Off, instant panel changes");
    await userEvent.keyboard("{End}{ArrowRight}");
    await expect.element(slider).toHaveValue("400");
  } finally {
    await view.unmount();
  }
});

it("keeps the value pill inside narrow rows and follows the segmented selection colors", async () => {
  const view = await render(
    <div
      style={
        {
          width: 220,
          "--primary": "rgb(12, 34, 56)",
          "--primary-foreground": "rgb(240, 241, 242)",
        } as CSSProperties
      }
    >
      <PanelAnimationPill value={400} onValueChange={() => {}} />
    </div>,
  );
  try {
    const slider = page.getByRole("slider", { name: "Panel animation duration" });
    const control = slider.element().parentElement!;
    const pill = control.querySelector<HTMLElement>(".panel-animation-pill-value")!;
    expect(control.scrollWidth).toBeLessThanOrEqual(220);
    expect(pill.getBoundingClientRect().right).toBeLessThanOrEqual(
      control.getBoundingClientRect().right,
    );
    expect(getComputedStyle(pill).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(pill).boxShadow).toContain("inset");
  } finally {
    await view.unmount();
  }
});
