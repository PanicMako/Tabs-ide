import "../../index.css";
import "../../localFonts.css";
import { SettingsRow, SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { useTheme } from "../../hooks/useTheme";
import { FONT_COMBOS } from "../../lib/themes";

const selectedCombo = FONT_COMBOS.find((combo) => combo.id === "funnel-weights")!;

function FontPreferencesProbe() {
  const { fontPreferences, setFontPreferences } = useTheme();
  return (
    <div>
      <output aria-label="Selected font">{fontPreferences.uiFont}</output>
      <button
        type="button"
        onClick={() =>
          setFontPreferences((previous) => ({
            ...previous,
            uiFont: selectedCombo.uiFont,
            headingFont: selectedCombo.headingFont,
          }))
        }
      >
        Select Liquid Syntax
      </button>
    </div>
  );
}

afterEach(() => {
  localStorage.removeItem("tabs:font-preferences");
  localStorage.removeItem("tabs:client-settings:v1");
});

test("the selected font changes without remounting the theme hook", async () => {
  localStorage.setItem(
    "tabs:font-preferences",
    JSON.stringify({ uiFont: "'Syne', sans-serif", headingFont: "'Newsreader', serif" }),
  );
  localStorage.setItem(
    "tabs:client-settings:v1",
    JSON.stringify({ fontFamilySans: "'Syne', sans-serif" }),
  );

  const screen = await render(<FontPreferencesProbe />);
  await expect
    .element(page.getByRole("status", { name: "Selected font" }))
    .toHaveTextContent("Syne");

  await page.getByRole("button", { name: "Select Liquid Syntax" }).click();
  await expect
    .element(page.getByRole("status", { name: "Selected font" }))
    .toHaveTextContent("Funnel Sans");
  expect(JSON.parse(localStorage.getItem("tabs:font-preferences")!).uiFont).toBe(
    selectedCombo.uiFont,
  );
  await screen.unmount();
});

function ApprovedTypographyProbe() {
  const { setFontPreferences } = useTheme();
  return (
    <>
      {["dot-matrix", "funnel-weights"].map((id) => {
        const combo = FONT_COMBOS.find((item) => item.id === id)!;
        return (
          <button
            key={id}
            onClick={() =>
              setFontPreferences((previous) => ({
                ...previous,
                uiFont: combo.uiFont,
                headingFont: combo.headingFont,
              }))
            }
          >
            Select {combo.name}
          </button>
        );
      })}
      <SettingsSectionHeader title="About" description="Application details" />
      <SettingsSection title="Application Details">
        <SettingsRow
          title="Version"
          description="Public Beta"
          control={<code style={{ fontFamily: "var(--font-ui-meta)" }}>1.3.34</code>}
        />
      </SettingsSection>
    </>
  );
}

test("approved pairings apply distinct page, section, row and control typography", async () => {
  const screen = await render(<ApprovedTypographyProbe />);
  const codeFont = document.documentElement.style.getPropertyValue("--font-mono");
  const heading = () =>
    getComputedStyle(page.getByRole("heading", { name: "About", exact: true }).element());
  const section = () =>
    getComputedStyle(
      page.getByRole("heading", { name: "Application Details", exact: true }).element(),
    );
  const row = () =>
    getComputedStyle(page.getByRole("heading", { name: "Version", exact: true }).element());
  try {
    await page.getByRole("button", { name: "Select Pixel Mischief" }).click();
    expect(heading().fontFamily).toContain("Doto");
    expect(heading().fontWeight).toBe("900");
    expect(section().fontFamily).toContain("Syne");
    expect(row().fontFamily).toContain("Doto");
    expect(row().fontWeight).toBe("800");
    expect(
      getComputedStyle(page.getByText("1.3.34", { exact: true }).element()).fontFamily,
    ).toContain("Geist Mono");
    expect(
      getComputedStyle(page.getByRole("button", { name: "Select Liquid Syntax" }).element())
        .fontFamily,
    ).toContain("Geist Mono");
    await page.getByRole("button", { name: "Select Liquid Syntax" }).click();
    expect(heading().fontFamily).toContain("Funnel Display");
    expect(heading().fontWeight).toBe("800");
    expect(row().fontFamily).toContain("Funnel Sans");
    expect(row().fontWeight).toBe("600");
    expect(
      getComputedStyle(page.getByText("1.3.34", { exact: true }).element()).fontFamily,
    ).toContain("Fragment Mono");
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(codeFont);
  } finally {
    await screen.unmount();
  }
});
