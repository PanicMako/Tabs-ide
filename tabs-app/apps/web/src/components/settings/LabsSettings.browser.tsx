import "../../index.css";
import "../../localFonts.css";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  SettingsEditorialFrame,
  SettingsWorkspaceIdentity,
  useSettingsStudyAppearance,
} from "./SettingsEditorialFrame";
import { SettingsSection, SettingsRow, SettingsSectionHeader } from "./SettingsLayout";
import { useSettingsLabsStore } from "../../stores/settingsLabsStore";
import LabsSettings from "./LabsSettings";
import { Popover, PopoverTrigger, PopoverPopup } from "../ui/popover";

function NestedAppearanceProbe() {
  const appearance = useSettingsStudyAppearance();
  return <span data-testid="nested-study-appearance">{appearance ?? "workspace"}</span>;
}

it("switches shared settings surfaces together, preserves fonts, and restores the classic layout", async () => {
  useSettingsLabsStore.getState().setEditorialSettingsOnly(false);
  useSettingsLabsStore.getState().setEditorialSettings(false);
  useSettingsLabsStore.getState().setEditorialAppearance("dark");
  await page.viewport(1280, 800);
  const view = await render(
    <SettingsEditorialFrame>
      <header data-slot="settings-topbar">
        <SettingsWorkspaceIdentity onBack={() => {}} pageName="General" onSettingsHome={() => {}} />
      </header>
      <LabsSettings />
      <div data-testid="workspace-study-card" className="study-workspace-card">
        Workspace card
      </div>
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
    const workspaceCard = page.getByTestId("workspace-study-card").element();
    expect(getComputedStyle(workspaceCard).borderBottomLeftRadius).toBe("14px");
    expect(getComputedStyle(workspaceCard).marginLeft).toBe("12px");
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

it("limits the study to Settings while preserving the workspace appearance", async () => {
  const store = useSettingsLabsStore.getState();
  store.setEditorialSettings(false);
  store.setEditorialSettingsOnly(false);
  store.setEditorialAppearance("dark");
  const view = await render(
    <SettingsEditorialFrame>
      <LabsSettings />
      <NestedAppearanceProbe />
      <Popover>
        <PopoverTrigger>Open settings overlay</PopoverTrigger>
        <PopoverPopup>
          <span data-testid="settings-overlay">Scoped overlay</span>
        </PopoverPopup>
      </Popover>
      <div data-testid="appearance-probe" className="dark:hidden">
        Light settings
      </div>
    </SettingsEditorialFrame>,
  );
  const background = document.documentElement.style.getPropertyValue("--background");
  const originalDark = document.documentElement.classList.contains("dark");
  const savedTheme = localStorage.getItem("tabs:theme");
  try {
    await page.getByRole("switch", { name: "Interface study", exact: true }).click();
    await page.getByRole("switch", { name: "Settings page only", exact: true }).click();
    expect(document.documentElement.hasAttribute("data-interface-study")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--background")).toBe(background);
    expect(document.documentElement.classList.contains("dark")).toBe(originalDark);
    await expect.element(page.getByTestId("appearance-probe")).not.toBeVisible();
    await expect.element(page.getByTestId("nested-study-appearance")).toHaveTextContent("dark");
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect.element(page.getByTestId("nested-study-appearance")).toHaveTextContent("light");
    await expect.element(page.getByTestId("appearance-probe")).toBeVisible();
    const frame = page.getByTestId("appearance-probe").element().closest("[data-settings-design]")!;
    expect(getComputedStyle(frame).backgroundColor).toBe("rgb(245, 244, 240)");
    expect(frame.getAttribute("data-settings-scope")).toBe("settings");
    expect(getComputedStyle(frame).borderRadius).toBe("14px");
    const option = frame.querySelector('[data-slot="settings-study-scope"]')!;
    expect(getComputedStyle(option).borderRadius).toBe("12px");
    expect(option.classList.contains("border-l")).toBe(false);
    await page.getByRole("button", { name: "Open settings overlay", exact: true }).click();
    await expect.element(page.getByTestId("settings-overlay")).toBeVisible();
    expect(page.getByTestId("settings-overlay").element().closest("[data-settings-design]")).toBe(
      frame,
    );
    expect(
      getComputedStyle(page.getByTestId("settings-overlay").element())
        .getPropertyValue("--background")
        .trim(),
    ).toBe("#f5f4f0");
    await userEvent.keyboard("{Escape}");
    expect(document.documentElement.classList.contains("dark")).toBe(originalDark);
    expect(document.documentElement.style.getPropertyValue("--background")).toBe(background);
    expect(localStorage.getItem("tabs:theme")).toBe(savedTheme);
    expect(localStorage.getItem("tabs_settings_labs_v1")).toContain('"editorialSettingsOnly":true');
    await page.getByRole("switch", { name: "Interface study", exact: true }).click();
    await expect
      .element(page.getByRole("switch", { name: "Settings page only", exact: true }))
      .not.toBeInTheDocument();
    expect(frame.getAttribute("data-settings-design")).toBe("classic");
  } finally {
    store.setEditorialSettings(false);
    store.setEditorialSettingsOnly(false);
    store.setEditorialAppearance("dark");
    await view.unmount();
  }
});
