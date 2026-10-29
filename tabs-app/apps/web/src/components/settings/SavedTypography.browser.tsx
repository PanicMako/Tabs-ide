import "../../index.css";
import "../../localFonts.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  type FontPreferences,
  DEFAULT_FONT_PREFERENCES,
  prepareCustomFontPreferences,
} from "../../lib/themes";
import { SAVED_FONT_MIXES_KEY } from "../../lib/savedFontMixes";
import { SavedTypography } from "./SavedTypography";
import { previewTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";

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
      .toBeVisible();
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
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    const saved = JSON.parse(localStorage.getItem(SAVED_FONT_MIXES_KEY)!);
    expect(saved).toHaveLength(1);
    expect(saved[0].fonts.headingFont).toBe("'Messapia', monospace");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Name your mix" }).fill("Night Signal");
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Apply Night Signal" })).toBeVisible();
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

it("keeps editing in a scrollable dialog and retains the draft when storage fails", async () => {
  localStorage.removeItem(SAVED_FONT_MIXES_KEY);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const theme = snapshotThemeState();
  await page.viewport(1280, 900);
  const view = await render(<Probe />);
  const write = Storage.prototype.setItem;
  let storage: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await page.getByRole("button", { name: "New mix", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create typography mix" });
    previewTheme("true-black");
    await dialog.screenshot({ path: "__screenshots__/typography-dialog.png" });
    await page.viewport(390, 844);
    await expect
      .poll(() => dialog.element().getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(844);
    await page.getByRole("textbox", { name: "Name your mix" }).fill("Mobile Signal");
    await page.getByRole("combobox", { name: "Editor font" }).click();
    await page.getByRole("option", { name: "Menlo / Monaco (Default)", exact: true }).click();
    storage = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key === SAVED_FONT_MIXES_KEY) throw new Error("Storage full");
        return write.call(this, key, value);
      });
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByRole("alert")).toHaveTextContent(/could not be saved/);
    await expect
      .element(page.getByRole("textbox", { name: "Name your mix" }))
      .toHaveValue("Mobile Signal");
    expect(readSaved()).toEqual([]);
    storage.mockRestore();
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(readSaved()).toHaveLength(1);
  } finally {
    storage?.mockRestore();
    await view.unmount();
    localStorage.removeItem(SAVED_FONT_MIXES_KEY);
    restoreThemeSnapshot(theme);
    await page.viewport(viewport.width, viewport.height);
  }
});

function readSaved() {
  return JSON.parse(localStorage.getItem(SAVED_FONT_MIXES_KEY) ?? "[]");
}

it("creates multiple independent mixes, supports saving a copy, and discards cancelled edits", async () => {
  localStorage.removeItem(SAVED_FONT_MIXES_KEY);
  const view = await render(<Probe />);
  try {
    await page.getByRole("button", { name: "New mix", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create typography mix" });
    await expect.element(dialog).toBeVisible();
    await page.getByRole("textbox", { name: "Name your mix" }).fill("First Signal");
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    await page.getByRole("button", { name: "New mix", exact: true }).click();
    await page.getByRole("textbox", { name: "Name your mix" }).fill("Second Signal");
    await page.getByRole("combobox", { name: "Page heading font" }).click();
    await page.getByRole("option", { name: "Messapia", exact: true }).click();
    await page.getByRole("button", { name: "Save mix", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(SAVED_FONT_MIXES_KEY)!);
    expect(saved).toHaveLength(2);
    expect(saved[0].id).not.toBe(saved[1].id);
    expect(saved[0].fonts.headingFont).toBe("'Coconat', serif");
    expect(saved[1].fonts.headingFont).toBe("'Messapia', monospace");
    const active = page.getByRole("status", { name: "Active mix" }).element().textContent;
    await page.getByRole("button", { name: "Edit First Signal" }).click();
    await page.getByRole("textbox", { name: "Name your mix" }).fill("Discarded name");
    await page.getByRole("combobox", { name: "Page heading font" }).click();
    await page.getByRole("option", { name: "Syne", exact: true }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(page.getByRole("status", { name: "Active mix" }).element().textContent).toBe(active);
    expect(JSON.parse(localStorage.getItem(SAVED_FONT_MIXES_KEY)!)).toEqual(saved);
    await expect.element(page.getByRole("button", { name: "Edit First Signal" })).toHaveFocus();
    await page.getByRole("button", { name: "Edit First Signal" }).click();
    await page.getByRole("textbox", { name: "Name your mix" }).fill("Third Signal");
    await page.getByRole("button", { name: "Save as new mix" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SAVED_FONT_MIXES_KEY)!)).toHaveLength(3);
    await expect.element(page.getByRole("button", { name: "Apply First Signal" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Apply Third Signal" })).toBeVisible();
  } finally {
    await view.unmount();
    localStorage.removeItem(SAVED_FONT_MIXES_KEY);
  }
});
