import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileUserThemeCss } from "@tabs/shared/themeCss";
import { EMPTY_USER_THEME } from "@tabs/contracts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// The reading plates and print styles keep text legible over artwork. Theme CSS lives in a
// cascade layer, which loses to any unlayered rule, so these sheets must stay unlayered.
describe("user theme vs wallpaper reading plates", () => {
  for (const file of [
    "./components/settings/wallpaper-labs.css",
    "./components/settings/theme-printer.css",
  ]) {
    it(`${file} stays outside a cascade layer`, () => {
      expect(read(file)).not.toMatch(/@layer\b/);
    });
  }

  it("covers both light and dark plates", () => {
    const css = read("./components/settings/wallpaper-labs.css");
    expect(css).toContain(
      '[data-agent-wallpaper="active"]:not([data-theme="light"]) .user-message-content',
    );
    expect(css).toContain(
      '[data-agent-wallpaper="active"][data-theme="light"] .user-message-content',
    );
  });

  it("wraps theme CSS in a layer and never emits !important for it", () => {
    const out = compileUserThemeCss({
      ...EMPTY_USER_THEME,
      css: ".user-message-content{background:red !important;color:red!important}",
    });
    expect(out.startsWith("@layer user-theme{")).toBe(true);
    expect(out).not.toMatch(/important/i);
  });
});
