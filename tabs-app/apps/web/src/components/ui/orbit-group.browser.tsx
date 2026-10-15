import "../../index.css";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SegmentedControl } from "./segmented-control";
import { OrbitGroup } from "./orbit-group";

function Matrix() {
  const [value, setValue] = useState("all");
  const [theme, setTheme] = useState("system");
  const [extra, setExtra] = useState(false);
  return (
    <div>
      <SegmentedControl
        aria-label="Theme mode"
        orbitKind="theme"
        value={theme}
        onValueChange={setTheme}
        options={[
          { value: "system", label: "System" },
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
        ]}
      />
      <OrbitGroup
        role="group"
        aria-label="Custom filters"
        className="flex flex-wrap"
        style={{ width: 320 }}
      >
        {["all", "open", "merged", "closed", ...(extra ? ["long filter name"] : [])].map((v) => (
          <button
            key={v}
            type="button"
            style={{ padding: "8px 12px" }}
            aria-pressed={value === v}
            onClick={() => setValue(v)}
          >
            {v}
          </button>
        ))}
      </OrbitGroup>
      <button onClick={() => setExtra(!extra)}>Change options</button>
    </div>
  );
}
function aligned(button: Element) {
  const orb = button.parentElement!.querySelector("[data-orbit-orb]")!.getBoundingClientRect();
  const target = button.getBoundingClientRect();
  return Math.abs(orb.left + orb.width / 2 - (target.left + target.width / 2)) < 1.5;
}
it("positions one orb across variable-width, wrapped, dynamic and keyboard-selected choices", async () => {
  const view = await render(<Matrix />);
  try {
    const group = page.getByRole("group", { name: "Custom filters" });
    const all = group.getByRole("button", { name: "all", exact: true });
    await expect.poll(() => aligned(all.element())).toBe(true);
    await group.getByRole("button", { name: "closed", exact: true }).click();
    await expect
      .poll(() => aligned(group.getByRole("button", { name: "closed", exact: true }).element()))
      .toBe(true);
    await page.getByRole("button", { name: "Change options" }).click();
    const long = group.getByRole("button", { name: "long filter name" });
    await long.click();
    await expect.poll(() => aligned(long.element())).toBe(true);
    long.element().focus();
    await userEvent.keyboard("{Home}");
    await expect.element(all).toHaveAttribute("aria-pressed", "true");
    group.element().style.width = "220px";
    await expect.poll(() => aligned(all.element())).toBe(true);
    await group.getByRole("button", { name: "merged" }).click();
    await expect
      .poll(() => aligned(group.getByRole("button", { name: "merged" }).element()))
      .toBe(true);
    expect(group.element().querySelectorAll("[data-orbit-orb]").length).toBe(1);
  } finally {
    await view.unmount();
  }
});
it("keeps full theme symbols in sync and respects the app's reduced-motion preference", async () => {
  const view = await render(<Matrix />);
  const previous = document.documentElement.dataset.reducedMotion;
  try {
    const group = page.getByRole("radiogroup", { name: "Theme mode" });
    await group.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect.element(group).toHaveAttribute("data-orbit-value", "dark");
    await expect
      .poll(() => aligned(group.getByRole("radio", { name: "Dark", exact: true }).element()))
      .toBe(true);
    expect(group.element().querySelector("[data-orbit-orb] svg")).not.toBeNull();
    document.documentElement.dataset.reducedMotion = "reduce";
    expect(
      getComputedStyle(group.element().querySelector("[data-orbit-orb]")!).transitionDuration,
    ).toBe("0s");
    await group.getByRole("radio", { name: "Light", exact: true }).click();
    await expect.element(group).toHaveAttribute("data-orbit-value", "light");
    await expect
      .poll(() => {
        const bounds = group.element().getBoundingClientRect();
        const orb = group.element().querySelector("[data-orbit-orb]")!.getBoundingClientRect();
        return Math.abs(bounds.right - orb.right - 4) < 1;
      })
      .toBe(true);
    await group.getByRole("radio", { name: "System", exact: true }).click();
    await expect
      .poll(() => {
        const bounds = group.element().getBoundingClientRect();
        const orb = group.element().querySelector("[data-orbit-orb]")!.getBoundingClientRect();
        return Math.abs(orb.left - bounds.left - 4) < 1;
      })
      .toBe(true);
  } finally {
    if (previous) document.documentElement.dataset.reducedMotion = previous;
    else delete document.documentElement.dataset.reducedMotion;
    await view.unmount();
  }
});

it("uses moving symbols for icon choices and a rounded Spotlight pill for text choices", async () => {
  function Choices() {
    const [value, setValue] = useState("dark");
    return (
      <>
        <SegmentedControl
          aria-label="Icon choices"
          value={value}
          onValueChange={setValue}
          options={[
            {
              value: "dark",
              label: (
                <span>
                  <Moon size={16} />
                  Dark
                </span>
              ),
            },
            {
              value: "light",
              label: (
                <span>
                  <Sun size={16} />
                  Light
                </span>
              ),
            },
          ]}
        />
        <OrbitGroup role="group" aria-label="Grid choices" className="grid grid-cols-2">
          {["One", "Two", "Three", "Four"].map((label, index) => (
            <button key={label} aria-pressed={index === 2} style={{ padding: "8px 12px" }}>
              {label}
            </button>
          ))}
        </OrbitGroup>
      </>
    );
  }
  const view = await render(<Choices />);
  try {
    const icons = page.getByRole("radiogroup", { name: "Icon choices" });
    await expect.element(icons).toHaveAttribute("data-orbit-kind", "icons");
    expect(icons.element().querySelector("[data-orbit-orb] .lucide-moon")).not.toBeNull();
    await icons.getByRole("radio", { name: "Light" }).click();
    expect(icons.element().querySelector("[data-orbit-orb] .lucide-sun")).not.toBeNull();
    const grid = page.getByRole("group", { name: "Grid choices" });
    await expect.element(grid).toHaveAttribute("data-orbit-kind", "spotlight");
    expect(getComputedStyle(grid.element()).display).toBe("grid");
    const button = grid.getByRole("button", { name: "Three" });
    await expect.poll(() => aligned(button.element())).toBe(true);
    const orb = grid.element().querySelector("[data-orbit-orb]")!;
    expect(orb.getBoundingClientRect().width).toBe(button.element().getBoundingClientRect().width);
    expect(getComputedStyle(orb).borderRadius).toBe("9999px");
  } finally {
    await view.unmount();
  }
});
