import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { useTheme } from "../../hooks/useTheme";
import { FONT_COMBOS } from "../../lib/themes";

const selectedCombo = FONT_COMBOS.find((combo) => combo.id === "unbounded-swag")!;

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
        Select Unbounded
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

  await page.getByRole("button", { name: "Select Unbounded" }).click();
  await expect
    .element(page.getByRole("status", { name: "Selected font" }))
    .toHaveTextContent("Unbounded");
  expect(JSON.parse(localStorage.getItem("tabs:font-preferences")!).uiFont).toBe(
    selectedCombo.uiFont,
  );
  await screen.unmount();
});
