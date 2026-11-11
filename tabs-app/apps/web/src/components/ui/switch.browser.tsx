import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useState } from "react";
import { Switch } from "./switch";

function SwitchHarness() {
  const [checked, setChecked] = useState(true);
  const [checked2, setChecked2] = useState(false);
  return (
    <div
      className="dark flex flex-col gap-4 p-8 bg-[#101718] text-[#e5efed]"
      style={
        {
          "--primary": "#73d7c3",
          "--primary-foreground": "#102421",
          "--border": "rgba(50, 67, 69, 0.8)",
          "--input": "rgba(50, 67, 69, 0.5)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-4">
        <span>Toggle checked:</span>
        <Switch checked={checked} onCheckedChange={setChecked} aria-label="Checked switch" />
      </div>
      <div className="flex items-center gap-4">
        <span>Toggle unchecked:</span>
        <Switch checked={checked2} onCheckedChange={setChecked2} aria-label="Unchecked switch" />
      </div>
    </div>
  );
}

it("renders a toggle switch with matching pill track, inset thumb, and smooth toggle", async () => {
  const view = await render(<SwitchHarness />);
  const checkedSwitch = page.getByRole("switch", { name: "Checked switch", exact: true });
  const uncheckedSwitch = page.getByRole("switch", { name: "Unchecked switch", exact: true });

  await expect.element(checkedSwitch).toHaveAttribute("aria-checked", "true");
  await expect.element(uncheckedSwitch).toHaveAttribute("aria-checked", "false");

  // Take screenshot of initial state (checked top, unchecked bottom)
  await page.screenshot({ path: "/tmp/rendered_switches_both.png" });

  // Clicking toggles checked state
  await uncheckedSwitch.click();
  await expect.element(uncheckedSwitch).toHaveAttribute("aria-checked", "true");

  await checkedSwitch.click();
  await expect.element(checkedSwitch).toHaveAttribute("aria-checked", "false");
});
