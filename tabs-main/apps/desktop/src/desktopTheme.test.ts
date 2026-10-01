import { describe, expect, it } from "vite-plus/test";
import { isLightDesktopTheme } from "./desktopTheme";
import { resolveCodeOssWorkbenchTheme } from "./codeHostManager";

describe("desktop theme appearance", () => {
  it.each(["tabs-light", "solarized-light", "light"])("recognizes the %s light theme", (theme) => {
    expect(isLightDesktopTheme(theme)).toBe(true);
  });
  it("keeps published light themes light for both native controls and the embedded editor", () => {
    const config = { baseVariant: "light" };
    expect(isLightDesktopTheme("environment:published-theme", config)).toBe(true);
    expect(resolveCodeOssWorkbenchTheme("environment:published-theme", config)).toBe(
      "Default Light Modern",
    );
    expect(isLightDesktopTheme("environment:published-theme", { baseVariant: "dark" })).toBe(false);
  });
  it("handles custom themes and incomplete or malformed appearance metadata", () => {
    expect(isLightDesktopTheme("custom", { baseVariant: "light" })).toBe(true);
    for (const config of [undefined, null, "light", { baseVariant: "invalid" }]) {
      expect(isLightDesktopTheme("custom", config)).toBe(false);
      expect(isLightDesktopTheme("environment:published-theme", config)).toBe(false);
    }
    expect(isLightDesktopTheme("tabs-dark", { baseVariant: "light" })).toBe(false);
  });
});
