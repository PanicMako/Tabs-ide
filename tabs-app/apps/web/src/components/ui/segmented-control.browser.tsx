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
  const track = system.element().parentElement!;
  const initialX = track.style.getPropertyValue("--orbit-x");
  await always.click();
  await expect.element(always).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => track.style.getPropertyValue("--orbit-x")).not.toBe(initialX);
  always.element().focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect
    .element(page.getByRole("radio", { name: "Never reduce" }))
    .toHaveAttribute("aria-checked", "true");

  const startup = page.getByRole("tab", { name: "Startup" });
  const close = page.getByRole("tab", { name: "Close" });
  expect(startup.element().parentElement!.querySelector("[data-orbit-orb]")).not.toBeNull();
  await close.click();
  await expect.element(close).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => close.element().parentElement!.dataset.orbitValue).toBe("close");
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
test("keeps rounded themed tracks and skips disabled choices with keyboard navigation", async () => {
  const view = await render(<Fixture />);
  try {
    const system = page.getByRole("radio", { name: "System" });
    const light = page.getByRole("radio", { name: "Light" });
    system.element().parentElement!.setAttribute("data-theme", "dracula");
    const orb = system.element().parentElement!.querySelector<HTMLElement>("[data-orbit-orb]")!;
    const draculaBackground = getComputedStyle(orb).backgroundColor;
    expect(getComputedStyle(system.element().parentElement!).borderRadius).toBe("36px");
    system.element().parentElement!.setAttribute("data-theme", "tabs-dark");
    await expect.poll(() => getComputedStyle(orb).backgroundColor).not.toBe(draculaBackground);
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

test("hugs content inside flex-col containers without stretching across full width", async () => {
  function FlexColContainer() {
    const [mode, setMode] = useState("icons");
    return (
      <div className="flex flex-col w-[500px]">
        <SegmentedControl
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "icons", label: "Icons" },
            { value: "emoji", label: "Emoji" },
          ]}
          aria-label="Icon mode"
        />
        <SegmentedControl
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "icons", label: "Icons" },
            { value: "emoji", label: "Emoji" },
          ]}
          className="w-full flex"
          itemClassName="flex-1"
          aria-label="Full width mode"
        />
      </div>
    );
  }

  const view = await render(<FlexColContainer />);
  try {
    const defaultCtrl = page.getByRole("radiogroup", { name: "Icon mode" });
    const fullWidthCtrl = page.getByRole("radiogroup", { name: "Full width mode" });

    const defaultEl = defaultCtrl.element();
    const fullEl = fullWidthCtrl.element();

    // Default segmented control inside flex-col should hug its content (< 250px), not stretch to 500px
    expect(defaultEl.clientWidth).toBeLessThan(250);
    // Explicit full-width segmented control should span approximately 500px
    expect(fullEl.clientWidth).toBeGreaterThanOrEqual(480);
  } finally {
    await view.unmount();
  }
});
