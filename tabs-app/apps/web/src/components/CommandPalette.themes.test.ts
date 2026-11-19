import { describe, expect, it, vi } from "vitest";
import { buildThemeSubmenuItem, reduceCommandPaletteUiState } from "./CommandPalette.logic";

const build = (activeThemeId: string, onSelect = vi.fn()) =>
  buildThemeSubmenuItem({
    themes: [
      { id: "tabs-dark", name: "Tabs Dark", description: "Carbon surfaces" },
      { id: "tabs-light", name: "Tabs Light" },
    ],
    activeThemeId,
    onSelect,
    icon: "i",
    addonIcon: "a",
    itemIcon: "t",
  });

describe("buildThemeSubmenuItem", () => {
  it("lists system first and then every theme", () => {
    const items = build("system").groups[0]!.items;
    expect(items.map((item) => item.value)).toEqual([
      "theme:system",
      "theme:tabs-dark",
      "theme:tabs-light",
    ]);
  });

  it("marks the theme in use", () => {
    const titles = build("tabs-dark").groups[0]!.items.map((item) => item.title);
    expect(titles).toEqual(["System", "Tabs Dark (current)", "Tabs Light"]);
  });

  it("applies the chosen theme", async () => {
    const onSelect = vi.fn();
    const items = build("system", onSelect).groups[0]!.items;
    const light = items.find((item) => item.value === "theme:tabs-light");
    if (light?.kind === "action") await light.run();
    expect(onSelect).toHaveBeenCalledWith("tabs-light");
  });

  it("can be found by searching for theme or appearance", () => {
    const terms = build("system").searchTerms;
    expect(terms).toContain("theme");
    expect(terms).toContain("appearance");
  });
});

describe("opening the palette with a query", () => {
  it("opens in command mode with the query as a search intent", () => {
    expect(
      reduceCommandPaletteUiState(
        { open: false, mode: "command", openIntent: null },
        { _tag: "OpenWithQuery", query: "Switch theme" },
      ),
    ).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "search", query: "Switch theme" },
    });
  });
});
