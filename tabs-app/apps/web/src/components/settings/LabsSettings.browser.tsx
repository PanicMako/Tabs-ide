import "../../index.css";
import "../../localFonts.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SettingsEditorialFrame, SettingsWorkspaceIdentity } from "./SettingsEditorialFrame";
import { SettingsSection, SettingsRow, SettingsSectionHeader } from "./SettingsLayout";
import { useSettingsLabsStore } from "../../stores/settingsLabsStore";
import LabsSettings from "./LabsSettings";

it("switches shared settings surfaces together, preserves fonts, and restores the classic layout", async () => {
  useSettingsLabsStore.getState().setEditorialSettings(false);
  useSettingsLabsStore.getState().setEditorialAppearance("dark");
  await page.viewport(1280, 800);
  const view = await render(
    <SettingsEditorialFrame>
      <header data-slot="settings-topbar">
        <SettingsWorkspaceIdentity onBack={() => {}} pageName="General" onSettingsHome={() => {}} />
      </header>
      <LabsSettings />
      <SettingsSectionHeader title="General" description="Your workflow" />
      <SettingsSection title="Preferences">
        <SettingsRow title="Interface scale" description="Find your space" />
      </SettingsSection>
    </SettingsEditorialFrame>,
  );
  try {
    const heading = page.getByRole("heading", { name: "General", exact: true }).element();
    const before = getComputedStyle(heading).fontFamily;
    const savedTheme = localStorage.getItem("tabs:theme");
    const rootBackground = document.documentElement.style.getPropertyValue("--background");
    expect(getComputedStyle(heading).fontSize).toBe("28px");
    await page.getByRole("switch", { name: "Interface study" }).click();
    await expect.poll(() => getComputedStyle(heading).fontSize).toBe("30px");
    await expect.element(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Personal workspace" })).toBeVisible();
    const frame = heading.closest("[data-settings-design]")!;
    expect(getComputedStyle(frame).backgroundColor).toBe("rgb(32, 32, 32)");
    await expect.element(page.getByText("Make Tabs work your way.")).toBeVisible();
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect.poll(() => getComputedStyle(frame).backgroundColor).toBe("rgb(245, 244, 240)");
    expect(localStorage.getItem("tabs_settings_labs_v1")).toContain(
      '"editorialAppearance":"light"',
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    expect(getComputedStyle(heading).fontFamily).toBe(before);
    expect(document.documentElement.getAttribute("data-interface-study")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#202020");
    expect(localStorage.getItem("tabs:theme")).toBe(savedTheme);
    const panel = page
      .getByRole("heading", { name: "Preferences", exact: true })
      .element()
      .closest("section")!
      .querySelector('[data-slot="settings-section-panel"]')!;
    expect(getComputedStyle(panel).borderRadius).toBe("14px");
    const section = panel.closest("section")!;
    expect(getComputedStyle(section).display).toBe("grid");
    expect(getComputedStyle(section).gridTemplateColumns.split(" ")).toHaveLength(2);
    await page.viewport(900, 800);
    await expect
      .poll(() => getComputedStyle(section).gridTemplateColumns.split(" ").length)
      .toBe(1);
    await page.viewport(1280, 800);
    expect(localStorage.getItem("tabs_settings_labs_v1")).toContain('"editorialSettings":true');
    await page.getByRole("switch", { name: "Interface study" }).click();
    await expect.poll(() => getComputedStyle(heading).fontSize).toBe("28px");
    expect(document.documentElement.hasAttribute("data-interface-study")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--background")).toBe(rootBackground);
    expect(localStorage.getItem("tabs:theme")).toBe(savedTheme);
    await page.getByRole("button", { name: "Explore wallpapers" }).click();
    await expect.element(page.getByRole("button", { name: "Back to Labs" })).toBeVisible();
    await page.getByRole("button", { name: "Back to Labs" }).click();
    await expect.element(page.getByRole("button", { name: "Explore extensions" })).toBeVisible();
  } finally {
    useSettingsLabsStore.getState().setEditorialSettings(false);
    useSettingsLabsStore.getState().setEditorialAppearance("dark");
    await view.unmount();
  }
});
