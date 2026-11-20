import { describe, expect, it } from "vitest";
import {
  arrangeFavoritesFirst,
  getFavoriteModels,
  isFavoritesFirst,
  setFavoritesFirst,
  toggleFavoriteModel,
} from "./modelFavorites";
import { resetModelOrder, updateHiddenModels, updateModelOrder } from "./modelOrdering";

const models = ["a", "b", "c", "d", "e"].map((slug) => ({ slug, name: slug.toUpperCase() }));
const slugs = (list: ReadonlyArray<{ slug: string }>) => list.map((model) => model.slug);

describe("favorites preference", () => {
  it("is off by default and only on for the provider it was turned on for", () => {
    expect(isFavoritesFirst({}, "codex")).toBe(false);
    expect(isFavoritesFirst(undefined, "codex")).toBe(false);
    const prefs = setFavoritesFirst({}, "codex", true);
    expect(isFavoritesFirst(prefs, "codex")).toBe(true);
    expect(isFavoritesFirst(prefs, "claudeAgent")).toBe(false);
  });

  it("stars and unstars models and drops an entry that is back to defaults", () => {
    let prefs = toggleFavoriteModel({}, "codex", "b");
    prefs = toggleFavoriteModel(prefs, "codex", "d");
    expect(getFavoriteModels(prefs, "codex")).toEqual(["b", "d"]);
    prefs = toggleFavoriteModel(prefs, "codex", "b");
    prefs = toggleFavoriteModel(prefs, "codex", "d");
    expect(prefs).toEqual({});
  });

  it("keeps favorites when the switch is turned off, so turning it on restores them", () => {
    let prefs = setFavoritesFirst({}, "codex", true);
    prefs = toggleFavoriteModel(prefs, "codex", "c");
    prefs = setFavoritesFirst(prefs, "codex", false);
    expect(isFavoritesFirst(prefs, "codex")).toBe(false);
    expect(getFavoriteModels(prefs, "codex")).toEqual(["c"]);
    expect(isFavoritesFirst(setFavoritesFirst(prefs, "codex", true), "codex")).toBe(true);
  });

  it("survives resetting the model order or clearing hidden models", () => {
    let prefs = toggleFavoriteModel({}, "codex", "c");
    prefs = setFavoritesFirst(prefs, "codex", true);
    prefs = updateModelOrder(prefs, "codex", ["e", "a"]);
    prefs = resetModelOrder(prefs, "codex");
    prefs = updateHiddenModels(prefs, "codex", ["b"]);
    prefs = updateHiddenModels(prefs, "codex", []);
    expect(getFavoriteModels(prefs, "codex")).toEqual(["c"]);
    expect(isFavoritesFirst(prefs, "codex")).toBe(true);
  });
});

describe("arrangeFavoritesFirst", () => {
  const keepNothing = () => false;

  it("shows only favorites, in provider order, with the rest behind Show more", () => {
    const result = arrangeFavoritesFirst(models, ["d", "b"], keepNothing, false);
    expect(slugs(result.shown)).toEqual(["b", "d"]);
    expect(result.hidden).toBe(3);
  });

  it("always keeps the selected model visible", () => {
    const result = arrangeFavoritesFirst(models, ["d"], (model) => model.slug === "a", false);
    expect(slugs(result.shown)).toEqual(["d", "a"]);
    expect(result.hidden).toBe(3);
  });

  it("lists everything once expanded, favorites still first", () => {
    const result = arrangeFavoritesFirst(models, ["d", "b"], keepNothing, true);
    expect(slugs(result.shown)).toEqual(["b", "d", "a", "c", "e"]);
    expect(result.hidden).toBe(0);
  });

  it("leaves the list alone when nothing is starred yet", () => {
    const result = arrangeFavoritesFirst(models, [], keepNothing, false);
    expect(slugs(result.shown)).toEqual(slugs(models));
    expect(result.hidden).toBe(0);
  });

  it("treats a grouped thinking variant as the favorite model", () => {
    const grouped = [
      { slug: "opus", name: "Opus", thinkingVariants: [{ model: { slug: "opus-high" } }] },
      { slug: "sonnet", name: "Sonnet" },
    ];
    const result = arrangeFavoritesFirst(grouped, ["opus-high"], keepNothing, false);
    expect(slugs(result.shown)).toEqual(["opus"]);
    expect(result.hidden).toBe(1);
  });
});
