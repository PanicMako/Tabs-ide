import "../../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SimpleSelect } from "./simple-select";
import { Slider } from "./slider";
import { TimeField } from "./TimeField";
import { SuggestInput } from "./suggest-input";
import { Details, Summary } from "./disclosure";
import { applyTestColorScheme, resetTestColorScheme } from "../../test/colorScheme";

function Fixture() {
  const [kind, setKind] = useState("interval");
  const [time, setTime] = useState("09:00");
  const [size, setSize] = useState(14);
  const [text, setText] = useState("");
  return (
    <div className="flex w-[420px] flex-col gap-4 bg-background p-6 text-foreground">
      <SimpleSelect
        aria-label="Schedule type"
        value={kind}
        onValueChange={setKind}
        options={[
          { value: "interval", label: "Repeat every" },
          { value: "fixed_time", label: "Daily" },
        ]}
      />
      <TimeField aria-label="Time" value={time} onValueChange={setTime} />
      <Slider aria-label="Font size" value={size} min={10} max={20} onValueChange={setSize} />
      <SuggestInput
        aria-label="Reviewer"
        value={text}
        onValueChange={setText}
        suggestions={["octocat", "hubot"]}
      />
      <Details>
        <Summary>More options</Summary>
        <p>Hidden until opened</p>
      </Details>
      <output data-testid="state">{`${kind}|${time}|${size}|${text}`}</output>
      <div data-testid="scroller" className="h-24 overflow-y-auto border border-border">
        <div className="h-96">tall content</div>
      </div>
    </div>
  );
}

for (const scheme of ["light", "dark"] as const) {
  it(`themed select, slider, suggest input and disclosure work without native controls (${scheme})`, async () => {
    applyTestColorScheme(scheme);
    const view = await render(<Fixture />);
    try {
      expect(document.querySelector("select, datalist, details")).toBeNull();
      await page.getByRole("combobox", { name: "Schedule type" }).click();
      await page.getByRole("option", { name: "Daily" }).click();
      await expect.element(page.getByTestId("state")).toHaveTextContent(/^fixed_time/);

      const thumb = page.getByRole("slider", { name: "Font size" });
      thumb.element().focus();
      await userEvent.keyboard("{ArrowRight}");
      await expect.element(page.getByTestId("state")).toHaveTextContent(/\|15\|/);

      await expect.element(page.getByText("Hidden until opened")).not.toBeVisible();
      await page.getByRole("button", { name: "More options" }).click();
      await expect.element(page.getByText("Hidden until opened")).toBeVisible();

      await page.getByRole("combobox", { name: "Time period" }).click();
      await page.getByRole("option", { name: "PM" }).click();
      await expect.element(page.getByTestId("state")).toHaveTextContent(/\|21:00\|/);
      await page.getByRole("combobox", { name: "Time minute" }).click();
      await page.screenshot({ path: `__screenshots__/native-replacements-${scheme}.png` });
    } finally {
      await view.unmount();
      resetTestColorScheme();
    }
  });
}

it("global scrollbar is thin, transparent-tracked and hides its thumb until hover", async () => {
  const view = await render(<Fixture />);
  try {
    const el = page.getByTestId("scroller").element() as HTMLElement;
    expect(el.scrollHeight).toBeGreaterThan(el.clientHeight);
    const thumb = getComputedStyle(el, "::-webkit-scrollbar-thumb");
    expect(thumb.backgroundColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    const bar = getComputedStyle(el, "::-webkit-scrollbar");
    expect(parseFloat(bar.width)).toBeLessThanOrEqual(8);
  } finally {
    await view.unmount();
  }
});
