import { describe, expect, it } from "vitest";
import { formatSelection, markdownFormatForKey } from "./composerMarkdownFormat";

describe("formatSelection", () => {
  it("wraps a selection in the right markers", () => {
    expect(formatSelection("word", "bold")).toEqual({ text: "**word**", caretBack: 0 });
    expect(formatSelection("word", "italic")).toEqual({ text: "*word*", caretBack: 0 });
    expect(formatSelection("word", "code")).toEqual({ text: "`word`", caretBack: 0 });
  });
  it("takes the markers off a selection that already has them", () => {
    expect(formatSelection("**word**", "bold").text).toBe("word");
    expect(formatSelection("*word*", "italic").text).toBe("word");
    expect(formatSelection("`word`", "code").text).toBe("word");
  });
  it("does not read bold markers as italic", () => {
    expect(formatSelection("**word**", "italic").text).toBe("***word***");
  });
  it("inserts an empty pair with the caret between when nothing is selected", () => {
    expect(formatSelection("", "bold")).toEqual({ text: "****", caretBack: 2 });
    expect(formatSelection("", "code")).toEqual({ text: "``", caretBack: 1 });
  });
  it("does not treat a lone marker as a wrapped selection", () => {
    expect(formatSelection("**", "bold").text).toBe("****" + "**");
    expect(formatSelection("`", "code").text).toBe("```");
  });
});

describe("markdownFormatForKey", () => {
  const key = (k: string, extra: Partial<{ mod: boolean; shift: boolean; alt: boolean }> = {}) =>
    markdownFormatForKey({ key: k, mod: true, shift: false, alt: false, ...extra });
  it("maps mod+b, mod+i and mod+e", () => {
    expect(key("b")).toBe("bold");
    expect(key("I")).toBe("italic");
    expect(key("e")).toBe("code");
  });
  it("ignores other keys and other modifiers", () => {
    expect(key("k")).toBeNull();
    expect(key("b", { mod: false })).toBeNull();
    expect(key("b", { shift: true })).toBeNull();
    expect(key("b", { alt: true })).toBeNull();
  });
});
