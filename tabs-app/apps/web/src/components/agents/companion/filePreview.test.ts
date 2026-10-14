import { expect, it } from "vitest";
import { filePreviewKind, parseDelimitedPreview } from "./filePreview";
it("identifies supported media and source types case-insensitively", () => {
  expect(filePreviewKind("folder/IMAGE.PNG")).toBe("image");
  expect(filePreviewKind("movie.webm")).toBe("video");
  expect(filePreviewKind("sound.mp3")).toBe("audio");
  expect(filePreviewKind("doc.pdf")).toBe("pdf");
  expect(filePreviewKind("README.md")).toBe("markdown");
  expect(filePreviewKind("data.tsv")).toBe("csv");
  expect(filePreviewKind("code.ts")).toBe("text");
});
it("preserves quoted commas, multiline values and escaped quotes", () => {
  expect(
    parseDelimitedPreview('name,value\r\n"a,b","one\ntwo"\r\n"c","say ""hi"""\n').rows,
  ).toEqual([
    ["name", "value"],
    ["a,b", "one\ntwo"],
    ["c", 'say "hi"'],
  ]);
  expect(parseDelimitedPreview("a\tb\n1\t2", "\t").rows).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
});
it("bounds table previews and reports hidden rows", () => {
  expect(parseDelimitedPreview("a\nb\nc", ",", 2)).toEqual({
    rows: [["a"], ["b"]],
    truncated: true,
  });
});
