import { describe, expect, it } from "vitest";
import { ComputerTreeBaselines, diffComputerTreeText, formatIndexRanges } from "./treeDiff.ts";
import { joinComputerTreeText, parseComputerTreeText } from "./treeText.ts";

const tree = (lines: ReadonlyArray<string>, footer = "N elements.") =>
  ["App: Notes (com.apple.Notes, pid 1)", 'Window: "A"', "", ...lines, "", footer].join("\n");

const BASE = tree([
  '1 Window "Notes"',
  "\t2 Toolbar",
  '\t\t3 Button "New note"',
  '\t\t4 Button "Share" (disabled)',
  '\t5 TextArea value="hello"',
  '\t6 StaticText "Saved"',
  ...Array.from(
    { length: 12 },
    (_, i) => `\t${7 + i} StaticText "padding line ${i} to keep the tree long enough for a diff"`,
  ),
]);

describe("parseComputerTreeText", () => {
  it("splits header, indexed elements and footer", () => {
    const parsed = parseComputerTreeText(BASE);
    expect(parsed.header).toEqual(["App: Notes (com.apple.Notes, pid 1)", 'Window: "A"', ""]);
    expect(parsed.elements.map((element) => [element.index, element.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 1],
      [6, 1],
      [7, 1],
      [8, 1],
      [9, 1],
      [10, 1],
      [11, 1],
      [12, 1],
      [13, 1],
      [14, 1],
      [15, 1],
      [16, 1],
      [17, 1],
      [18, 1],
    ]);
    expect(parsed.footer).toEqual(["", "N elements."]);
  });

  it("attaches unindexed lines to the element above", () => {
    const parsed = parseComputerTreeText(
      tree(["1 Window", "\t... 3 more not shown", "\t2 Button"]),
    );
    expect(parsed.elements[0]?.lines).toHaveLength(2);
    expect(parsed.elements).toHaveLength(2);
  });

  it("returns no elements for text without indexed lines", () => {
    expect(parseComputerTreeText("nothing here").elements).toEqual([]);
  });

  it("round-trips through joinComputerTreeText", () => {
    const parsed = parseComputerTreeText(BASE);
    const body = parsed.elements.flatMap((element) => element.lines);
    expect(
      joinComputerTreeText(
        parsed.header,
        body,
        parsed.footer.slice(1).length ? ["", ...parsed.footer.slice(1)] : [],
      ),
    ).toContain("18 StaticText");
  });
});

describe("diffComputerTreeText", () => {
  it("reports no change for identical trees", () => {
    const diff = diffComputerTreeText(BASE, BASE);
    expect(diff?.changed).toBe(0);
    expect(diff?.text).toContain("No change in the accessibility tree");
  });

  it("lists only changed element lines and keeps indexes", () => {
    const next = BASE.replace("(disabled)", "").replace('"Saved"', '"Saving"');
    const diff = diffComputerTreeText(BASE, next);
    expect(diff?.changed).toBe(2);
    expect(diff?.text).toContain('~ \t\t4 Button "Share" ');
    expect(diff?.text).toContain('~ \t6 StaticText "Saving"');
    expect(diff?.text).not.toContain("New note");
  });

  it("reports removed indexes as ranges", () => {
    const lines = BASE.split("\n");
    const next = lines.filter((line) => !/^\t(17|18) /.test(line)).join("\n");
    const diff = diffComputerTreeText(BASE, next);
    expect(diff?.removed).toBe(2);
    expect(diff?.text).toContain("- 17-18");
  });

  it("falls back to the full tree when an element was added", () => {
    const lines = BASE.split("\n");
    const insertAt = lines.findIndex((line) => line.startsWith("\t18 ")) + 1;
    lines.splice(insertAt, 0, '\t19 Button "New"');
    expect(diffComputerTreeText(BASE, lines.join("\n"))).toBeNull();
  });

  it("falls back when an element moved to another parent", () => {
    const next = BASE.replace("\t\t4 Button", "\t4 Button");
    expect(diffComputerTreeText(BASE, next)).toBeNull();
  });

  it("falls back when the diff would not be smaller than the tree", () => {
    const small = tree(["1 Window", '\t2 Button "a"']);
    const changed = tree(['1 Window "different title"', '\t2 Button "b"']);
    expect(diffComputerTreeText(small, changed)).toBeNull();
  });
});

describe("formatIndexRanges", () => {
  it("collapses consecutive indexes", () => {
    expect(formatIndexRanges([5, 3, 4, 9, 11, 10])).toBe("3-5, 9-11");
    expect(formatIndexRanges([7])).toBe("7");
    expect(formatIndexRanges([])).toBe("");
  });
});

describe("ComputerTreeBaselines", () => {
  const snapshot = (
    treeText: string,
    over: Partial<{ session: string; windowKey: string; pid: number }> = {},
  ) => ({
    session: "thread-1",
    pid: 10,
    windowKey: "index:0",
    snapshotId: `s-${treeText.length}`,
    treeText,
    ...over,
  });
  const changed = BASE.replace('"Saved"', '"Saving"');

  it("returns the full tree the first time and a diff afterwards when asked", () => {
    const baselines = new ComputerTreeBaselines();
    expect(baselines.apply(snapshot(BASE), true).diff).toBeUndefined();
    const second = baselines.apply(snapshot(changed), true);
    expect(second.diff?.changed).toBe(1);
    expect(second.treeText).toContain("Changes since the previous snapshot");
  });

  it("never diffs when the caller wants the full tree, but still records the baseline", () => {
    const baselines = new ComputerTreeBaselines();
    baselines.apply(snapshot(BASE), true);
    expect(baselines.apply(snapshot(changed), false).treeText).toBe(changed);
    expect(baselines.apply(snapshot(changed), true).diff?.changed).toBe(0);
  });

  it("keeps sessions, processes and windows apart", () => {
    const baselines = new ComputerTreeBaselines();
    baselines.apply(snapshot(BASE), true);
    expect(baselines.apply(snapshot(changed, { session: "thread-2" }), true).diff).toBeUndefined();
    expect(baselines.apply(snapshot(changed, { pid: 11 }), true).diff).toBeUndefined();
    expect(baselines.apply(snapshot(changed, { windowKey: "index:1" }), true).diff).toBeUndefined();
  });

  it("drops baselines older than two minutes", () => {
    let now = 0;
    const baselines = new ComputerTreeBaselines(() => now);
    baselines.apply(snapshot(BASE), true);
    now = 121_000;
    expect(baselines.apply(snapshot(changed), true).diff).toBeUndefined();
  });
});
