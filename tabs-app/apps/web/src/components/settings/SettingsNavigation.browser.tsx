import "../../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { applyTestColorScheme, resetTestColorScheme } from "../../test/colorScheme";
import { SettingsNavigation, SETTINGS_NAV, type SettingsPageId } from "./SettingsNavigation";

function NavigationFixture() {
  const [active, setActive] = useState<SettingsPageId>("general");
  return (
    <SettingsNavigation
      activeSection={active}
      onSelect={setActive}
      reducedMotion={false}
      notificationBadge={<span>2</span>}
    />
  );
}

it("groups every existing settings page once under labelled sections", async () => {
  const view = await render(<NavigationFixture />);
  try {
    for (const name of ["Make it yours", "Agent desk", "Workbench", "Inside Tabs"]) {
      await expect.element(page.getByRole("group", { name, exact: true })).toBeVisible();
    }
    await expect
      .element(
        page
          .getByRole("group", { name: "Inside Tabs", exact: true })
          .getByRole("button", { name: "Labs", exact: true }),
      )
      .toBeVisible();
    // Every page appears exactly once, however many pages Settings grows to.
    expect(new Set(SETTINGS_NAV.map((item) => item.id)).size).toBe(SETTINGS_NAV.length);
    expect(document.querySelectorAll("[data-settings-nav-item]")).toHaveLength(SETTINGS_NAV.length);
    await expect
      .element(page.getByRole("button", { name: "General", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(page.getByRole("button", { name: "Notifications 2", exact: true }))
      .toBeVisible();
  } finally {
    await view.unmount();
  }
});

it("preserves page selection, badges and keyboard access across groups", async () => {
  const view = await render(<NavigationFixture />);
  try {
    const providers = page.getByRole("button", { name: "Providers", exact: true });
    await providers.click();
    await expect.element(providers).toHaveAttribute("aria-current", "page");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const general = page.getByRole("button", { name: "General", exact: true });
    general.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Tab}");
    await expect
      .element(page.getByRole("button", { name: "Notifications 2", exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("button", { name: "Notifications", exact: true }))
      .toHaveAttribute("aria-current", "page");
  } finally {
    await view.unmount();
  }
});

function ShellFixture() {
  return (
    <div
      data-slot="settings-columns"
      className="settings-shell-columns bg-background"
      style={{ display: "flex", height: "calc(100dvh - 53px)", width: "100%", padding: "0 64px" }}
    >
      <NavigationFixture />
      <main aria-label="Settings content" style={{ minWidth: 0, flex: 1 }}>
        Page content
      </main>
    </div>
  );
}

async function expectNavFits() {
  const nav = page.getByRole("navigation", { name: "Settings pages" }).element();
  const last = page.getByRole("button", { name: "About", exact: true }).element();
  expect(nav.scrollHeight).toBeLessThanOrEqual(nav.clientHeight);
  expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    nav.getBoundingClientRect().bottom,
  );
}

for (const [width, height] of [
  [1440, 900],
  [1512, 982],
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    it(`shows every page without a scrollbar at ${width}x${height} (${scheme})`, async () => {
      await page.viewport(width, height);
      applyTestColorScheme(scheme);
      const view = await render(<ShellFixture />);
      try {
        await expectNavFits();
        // Rows stay comfortable (never squeezed under 26px) at these sizes.
        const row = page.getByRole("button", { name: "General", exact: true }).element();
        expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(26);
        await page.screenshot({
          path: `__screenshots__/settings-nav-${width}x${height}-${scheme}.png`,
        });
      } finally {
        await view.unmount();
        resetTestColorScheme();
      }
    });
  }
}

it("falls back to a themed scrollbar inside the rail on very short windows and stacks on phones", async () => {
  await page.viewport(1280, 600);
  const view = await render(<ShellFixture />);
  try {
    const nav = page.getByRole("navigation", { name: "Settings pages" }).element();
    expect(nav.scrollHeight).toBeGreaterThan(nav.clientHeight);
    expect(getComputedStyle(nav).overflowY).toBe("auto");
    await page.viewport(390, 844);
    expect(nav.getBoundingClientRect().width).toBeLessThanOrEqual(390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    expect(
      page.getByRole("main", { name: "Settings content" }).element().getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(nav.getBoundingClientRect().bottom);
  } finally {
    await view.unmount();
    await page.viewport(1280, 720);
  }
});
