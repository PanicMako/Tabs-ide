import "../../index.css";
import "../../localFonts.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useTheme } from "../../hooks/useTheme";
import { DEFAULT_FONT_PREFERENCES } from "../../lib/themes";
import { SettingsRow, SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import { TypographyMixer } from "./TypographyMixer";

function MixerProbe() {
  const { fontPreferences, setFontPreferences } = useTheme();
  return (
    <>
      <button onClick={() => setFontPreferences(DEFAULT_FONT_PREFERENCES)}>Restore original</button>
      <TypographyMixer fonts={fontPreferences} onChange={setFontPreferences} />
      <SettingsSectionHeader
        title="About"
        description="Supporting description across the page"
        actions={<button>Check for updates and view releases</button>}
      />
      <SettingsSection title="Application Details">
        <SettingsRow title="Version" description="Inside the card" />
      </SettingsSection>
    </>
  );
}

it("mixes locally loaded roles independently and keeps the description outside the action row", async () => {
  const view = await render(<MixerProbe />);
  try {
    await page.getByRole("button", { name: "Restore original" }).click();
    for (const [label, option] of [
      ["Page heading font", "Coconat"],
      ["Section heading font", "Parkinsans"],
      ["Supporting text font", "Absans"],
    ] as const) {
      await page.getByRole("combobox", { name: label }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    }
    const styles = (name: string) =>
      getComputedStyle(page.getByRole("heading", { name, exact: true }).element());
    expect(styles("About").fontFamily).toContain("Coconat");
    expect(styles("About").fontWeight).toBe("700");
    expect(styles("Application Details").fontFamily).toContain("Parkinsans");
    expect(styles("Version").fontFamily).toContain("Syne");
    const paragraph = page
      .getByText("Supporting description across the page", { exact: true })
      .element();
    expect(getComputedStyle(paragraph).fontFamily).toContain("Absans");
    const heading = page.getByRole("heading", { name: "About", exact: true }).element();
    expect(paragraph.parentElement).toBe(heading.closest('[data-slot="settings-page-header"]'));
    const stored = JSON.parse(localStorage.getItem("tabs:font-preferences")!);
    expect(stored).toMatchObject({
      uiFont: "'Syne', sans-serif",
      headingFont: "'Coconat', serif",
      sectionFont: "'Parkinsans', sans-serif",
      supportingFont: "'Absans', sans-serif",
      editorFont: DEFAULT_FONT_PREFERENCES.editorFont,
    });
  } finally {
    await page.getByRole("button", { name: "Restore original" }).click();
    await view.unmount();
  }
});
