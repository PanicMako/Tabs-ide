import "../../index.css";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { previewTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
import { Input } from "./input";

it("leaves a field's inner input square so its caret and first letter are not clipped", async () => {
  const view = await render(
    <label style={{ display: "flex", alignItems: "center", height: 40, width: 320 }}>
      <svg width="14" height="14" aria-hidden="true" />
      <input aria-label="Find a file" className="bg-transparent" style={{ height: 22 }} />
    </label>,
  );
  try {
    const input = page.getByRole("textbox", { name: "Find a file" }).element() as HTMLElement;
    expect(getComputedStyle(input).borderTopLeftRadius).toBe("0px");
    await userEvent.click(input);
    await userEvent.keyboard("a");
    expect(getComputedStyle(input).outlineStyle).toBe("none");
  } finally {
    await view.unmount();
  }
});

it.each(["true-black", "solarized-light"] as const)(
  "focuses a text field without a coloured ring in %s",
  async (theme) => {
    const snapshot = snapshotThemeState();
    previewTheme(theme);
    const view = await render(<Input aria-label="Search drafts" />);
    try {
      const input = page.getByRole("textbox", { name: "Search drafts" }).element() as HTMLElement;
      await userEvent.click(input);
      await userEvent.keyboard("a");
      const field = input.closest('[data-slot="input-control"]') as HTMLElement;
      const ring = getComputedStyle(field).getPropertyValue("--ring").trim();
      const text = getComputedStyle(field).getPropertyValue("--foreground").trim();
      // The field's ring token is derived from its own text colour, never the theme accent.
      expect(ring).toContain("color-mix");
      expect(text.length).toBeGreaterThan(0);
      expect(getComputedStyle(input).outlineStyle).toBe("none");
    } finally {
      await view.unmount();
      restoreThemeSnapshot(snapshot);
    }
  },
);
