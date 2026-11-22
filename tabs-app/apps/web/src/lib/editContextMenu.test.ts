import { describe, expect, it } from "vitest";
import { ADD_TO_DICTIONARY_ID, buildEditMenu, spellSuggestionId } from "./editContextMenu";

describe("edit context menu", () => {
  it("offers cut and paste only in editable fields", () => {
    expect(buildEditMenu({ editable: true, hasSelection: true }).map((i) => i.id)).toEqual([
      "cut",
      "copy",
      "paste",
      "select-all",
    ]);
    expect(buildEditMenu({ editable: false, hasSelection: true }).map((i) => i.id)).toEqual([
      "copy",
      "select-all",
    ]);
  });

  it("disables cut and copy without a selection", () => {
    const items = buildEditMenu({ editable: true, hasSelection: false });
    expect(items.find((i) => i.id === "cut")?.disabled).toBe(true);
    expect(items.find((i) => i.id === "copy")?.disabled).toBe(true);
    expect(items.find((i) => i.id === "paste")?.disabled).toBeUndefined();
  });

  it("puts spelling suggestions and Add to dictionary above the edit actions", () => {
    const items = buildEditMenu({
      editable: true,
      hasSelection: false,
      misspelledWord: "teh",
      suggestions: ["the", "tech"],
    });
    expect(items.slice(0, 4).map((i) => i.id)).toEqual([
      spellSuggestionId(0),
      spellSuggestionId(1),
      ADD_TO_DICTIONARY_ID,
      "edit-header",
    ]);
    expect(items[0]?.label).toBe("the");
    expect(items[2]?.label).toBe('Add "teh" to dictionary');
    expect(items.at(-1)?.id).toBe("select-all");
  });

  it("says so when a misspelling has no suggestions", () => {
    const items = buildEditMenu({
      editable: true,
      hasSelection: false,
      misspelledWord: "xqzv",
      suggestions: [],
    });
    expect(items[0]).toMatchObject({ id: "no-suggestions", disabled: true });
  });

  it("omits spelling items outside editable fields or without a misspelling", () => {
    expect(
      buildEditMenu({ editable: false, hasSelection: true, misspelledWord: "teh" }).map(
        (i) => i.id,
      ),
    ).toEqual(["copy", "select-all"]);
    expect(
      buildEditMenu({ editable: true, hasSelection: true }).some((i) => i.id.startsWith("spell:")),
    ).toBe(false);
  });
});
