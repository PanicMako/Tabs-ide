import "../../index.css";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useState } from "react";

import { SegmentedControl } from "./segmented-control";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

function Choices() {
  const [value, setValue] = useState("system");
  return (
    <div className="dark">
      <SegmentedControl
        value={value}
        onValueChange={setValue}
        options={[
          { value: "system", label: "System" },
          { value: "always", label: "Always reduce" },
          { value: "never", label: "Never reduce" },
        ]}
        aria-label="Motion preference"
      />
      <Tabs defaultValue="startup">
        <TabsList>
          <TabsTrigger value="startup">Startup</TabsTrigger>
          <TabsTrigger value="close">Close</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

test("grouped choices retain their selection and keyboard behavior", async () => {
  const view = await render(<Choices />);
  const system = page.getByRole("radio", { name: "System" });
  const always = page.getByRole("radio", { name: "Always reduce" });

  await expect.element(system).toHaveAttribute("aria-checked", "true");
  await expect.element(always).toHaveAttribute("aria-checked", "false");
  const selectedShadow = getComputedStyle(system.element()).boxShadow;
  expect(selectedShadow).not.toBe("none");
  expect(getComputedStyle(always.element()).boxShadow).toBe("none");

  await always.click();
  await expect.element(always).toHaveAttribute("aria-checked", "true");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(getComputedStyle(always.element()).boxShadow).toBe(selectedShadow);
  expect(getComputedStyle(system.element()).boxShadow).toBe("none");
  always.element().focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect
    .element(page.getByRole("radio", { name: "Never reduce" }))
    .toHaveAttribute("aria-checked", "true");

  const startup = page.getByRole("tab", { name: "Startup" });
  const close = page.getByRole("tab", { name: "Close" });
  expect(getComputedStyle(startup.element()).boxShadow).not.toBe("none");
  await close.click();
  await expect.element(close).toHaveAttribute("aria-selected", "true");
  expect(getComputedStyle(close.element()).boxShadow).not.toBe("none");
  close.element().focus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(startup).toHaveAttribute("aria-selected", "true");
  await view.unmount();
});

function Fixture() {
  const [value, setValue] = useState("system");
  return (
    <SegmentedControl
      aria-label="Theme"
      value={value}
      onValueChange={setValue}
      options={[
        { value: "system", label: "System" },
        { value: "dark", label: "Dark", disabled: true },
        { value: "light", label: "Light" },
      ]}
    />
  );
}
test("keeps flat themed tiles and skips disabled choices with keyboard navigation", async () => {
  const view = await render(<Fixture />);
  try {
    const system = page.getByRole("radio", { name: "System" });
    const light = page.getByRole("radio", { name: "Light" });
    system.element().parentElement!.setAttribute("data-theme", "tabs-light");
    await expect
      .poll(() => getComputedStyle(system.element()).backgroundColor)
      .toBe("rgb(255, 255, 255)");
    const lightBackground = getComputedStyle(system.element()).backgroundColor;
    expect(getComputedStyle(system.element()).borderRadius).toBe("7px");
    system.element().parentElement!.setAttribute("data-theme", "tabs-dark");
    await expect
      .poll(() => getComputedStyle(system.element()).backgroundColor)
      .not.toBe(lightBackground);
    system.element().focus();
    system
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await expect.element(light).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(light.element());
    light.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await expect.element(system).toHaveAttribute("aria-checked", "true");
  } finally {
    await view.unmount();
  }
});
