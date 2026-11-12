import "../../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
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
    for (const name of ["Make it yours", "Agent desk", "Workbench", "Inside Tabs", "First look"]) {
      await expect.element(page.getByRole("group", { name, exact: true })).toBeVisible();
    }
    await expect
      .element(
        page
          .getByRole("group", { name: "First look", exact: true })
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

it("fits all groups in a short desktop window and keeps small-screen overflow inside the rail", async () => {
  await page.viewport(1280, 720);
  const view = await render(
    <div
      data-slot="settings-columns"
      className="settings-shell-columns"
      style={{ display: "flex", height: "calc(100dvh - 90px)", width: "100%" }}
    >
      <NavigationFixture />
      <main aria-label="Settings content" style={{ minWidth: 0, flex: 1 }}>
        Page content
      </main>
    </div>,
  );
  try {
    const nav = page.getByRole("navigation", { name: "Settings pages" }).element();
    const about = page.getByRole("button", { name: "Labs", exact: true }).element();
    expect(about.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      nav.getBoundingClientRect().bottom,
    );
    expect(nav.scrollHeight).toBeLessThanOrEqual(nav.clientHeight);
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
