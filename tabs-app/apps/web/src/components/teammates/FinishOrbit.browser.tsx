import "../../index.css";
import "./teammates.css";

import type { TeammateFinish } from "@tabs/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";

import { FinishOrbit } from "./FinishOrbit";

function Harness({ onChange }: { onChange: (finish: TeammateFinish) => void }) {
  const [finish, setFinish] = useState<TeammateFinish>("signature");
  return (
    <FinishOrbit
      value={finish}
      onChange={(next) => {
        setFinish(next);
        onChange(next);
      }}
    />
  );
}

describe("FinishOrbit", () => {
  it("picks a finish by clicking it on the orbit and names it", async () => {
    const onChange = vi.fn();
    await render(<Harness onChange={onChange} />);
    await expect
      .element(page.getByRole("radio", { name: "Blueprint" }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Brass" }).click();
    expect(onChange).toHaveBeenLastCalledWith("brass");
    await expect.element(page.getByText("Brass", { exact: true })).toBeVisible();
  });

  it("names a finish while it is hovered", async () => {
    await render(<Harness onChange={vi.fn()} />);
    await page.getByRole("radio", { name: "Moss" }).hover();
    await expect.element(page.getByText("Moss", { exact: true }).first()).toBeVisible();
  });

  it("opens a hue ring for a custom colour and turns it with the keyboard", async () => {
    const onChange = vi.fn();
    await render(<Harness onChange={onChange} />);
    await page.getByRole("radio", { name: "Custom colour" }).click();
    expect(onChange).toHaveBeenLastCalledWith("hue-212");
    const knob = page.getByRole("slider", { name: "Hue" });
    await expect.element(knob).toHaveAttribute("aria-valuenow", "212");
    (document.querySelector("[role=slider]") as HTMLElement).focus();
    (document.querySelector("[role=slider]") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(onChange).toHaveBeenLastCalledWith("hue-218");
    await expect.element(page.getByText("Custom", { exact: true })).toBeVisible();
  });
});
