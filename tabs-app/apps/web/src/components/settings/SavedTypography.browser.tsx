import "../../index.css";
import "../../localFonts.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  type FontPreferences,
  DEFAULT_FONT_PREFERENCES,
  prepareCustomFontPreferences,
} from "../../lib/themes";
import { SAVED_FONT_MIXES_KEY } from "../../lib/savedFontMixes";
import { SavedTypography } from "./SavedTypography";

function Probe() {
  const [showMixer, setShowMixer] = useState(false);
  const [fonts, setFonts] = useState<FontPreferences>({
    ...prepareCustomFontPreferences(DEFAULT_FONT_PREFERENCES),
    headingFont: "'Coconat', serif",
    sectionFont: "'Ronzino', sans-serif",
    supportingFont: "'Absans', sans-serif",
    fontSizeInterface: 17,
  });
  return (
    <>
      <button onClick={() => setShowMixer(true)}>Create mix</button>
      <button
        onClick={() =>
          setFonts({
            ...prepareCustomFontPreferences(DEFAULT_FONT_PREFERENCES),
            fontSizeInterface: 15,
          })
        }
      >
        Different mix
      </button>
      <output aria-label="Active mix">{JSON.stringify(fonts)}</output>
      <SavedTypography
        fonts={fonts}
        onChange={setFonts}
        showMixer={showMixer}
        onCloseMixer={() => setShowMixer(false)}
      />
    </>
  );
}

it("saves named mixes across reloads, reapplies all roles without changing sizes, and allows rename and removal", async () => {
  localStorage.removeItem(SAVED_FONT_MIXES_KEY);
  let view = await render(<Probe />);
  try {
    await page.getByRole("button", { name: "Create mix" }).click();
    await page.getByRole("button", { name: "Save this mix" }).click();
    await page.getByRole("textbox", { name: "Name your mix" }).fill("Personal Signal");
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Apply Personal Signal" })).toBeVisible();
    await view.unmount();
    view = await render(<Probe />);
    await page.getByRole("button", { name: "Different mix" }).click();
    await page.getByRole("button", { name: "Apply Personal Signal" }).click();
    const active = JSON.parse(
      page.getByRole("status", { name: "Active mix" }).element().textContent!,
    );
    expect(active).toMatchObject({
      headingFont: "'Coconat', serif",
      sectionFont: "'Ronzino', sans-serif",
      supportingFont: "'Absans', sans-serif",
      fontSizeInterface: 15,
    });
    await expect
      .element(page.getByRole("combobox", { name: "Page heading font" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Remove Personal Signal" }))
      .not.toBeInTheDocument();
    const specimen = page.getByRole("button", { name: "Apply Personal Signal" }).element();
    const lines = specimen.querySelectorAll<HTMLElement>("[data-specimen-line]");
    await document.fonts.ready;
    await expect.poll(() => lines[0]!.scrollWidth <= lines[0]!.clientWidth + 1).toBe(true);
    expect(lines[0]!.textContent).toBe("Personal");
    expect(lines[1]!.textContent).toBe("Signal");
    expect(getComputedStyle(lines[0]!).whiteSpace).toBe("nowrap");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(page.getByRole("combobox", { name: "Page heading font" })).toBeVisible();
    await page.getByRole("combobox", { name: "Page heading font" }).click();
    await page.getByRole("option", { name: "Messapia", exact: true }).click();
    await page.getByRole("button", { name: "Save this mix" }).click();
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    const saved = JSON.parse(localStorage.getItem(SAVED_FONT_MIXES_KEY)!);
    expect(saved).toHaveLength(1);
    expect(saved[0].fonts.headingFont).toBe("'Messapia', monospace");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Rename Personal Signal" }).click();
    await page.getByRole("textbox", { name: "Name your mix" }).fill("Night Signal");
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Apply Night Signal" })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Remove Night Signal" }).click();
    expect(JSON.parse(localStorage.getItem(SAVED_FONT_MIXES_KEY)!)).toEqual([]);
    await expect
      .element(page.getByRole("combobox", { name: "Page heading font" }))
      .not.toBeInTheDocument();
  } finally {
    await view.unmount();
    localStorage.removeItem(SAVED_FONT_MIXES_KEY);
  }
});
