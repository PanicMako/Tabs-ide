import { afterEach, beforeEach, expect, it } from "vitest";
import {
  clearFindHighlights,
  findTextRanges,
  nextMatchIndex,
  paintFindHighlights,
} from "~/lib/chatFind";

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="root">
      <p>The Sidebar and the sidebar again.</p>
      <p>No match here <span aria-hidden="true">sidebar hidden</span></p>
      <script>var sidebar = 1;</script>
      <p>Sidebar</p>
    </div>`;
  root = document.getElementById("root")!;
});

afterEach(() => {
  clearFindHighlights();
  document.body.innerHTML = "";
});

it("finds every match regardless of case, in reading order, skipping hidden text and scripts", () => {
  const ranges = findTextRanges(root, "sidebar");
  expect(ranges.map((range) => range.toString())).toEqual(["Sidebar", "sidebar", "Sidebar"]);
});

it("finds nothing for an empty or whitespace query", () => {
  expect(findTextRanges(root, "")).toEqual([]);
  expect(findTextRanges(root, "   ")).toEqual([]);
});

it("stops at the limit", () => {
  expect(findTextRanges(root, "sidebar", 2)).toHaveLength(2);
});

it("paints the matches and the current one, and clears them", () => {
  const ranges = findTextRanges(root, "sidebar");
  paintFindHighlights(ranges, 1);
  const highlights = (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights;
  expect(highlights.get("chat-find")?.size).toBe(3);
  expect(highlights.get("chat-find-current")?.size).toBe(1);
  clearFindHighlights();
  expect(highlights.has("chat-find")).toBe(false);
});

it("steps through matches and wraps", () => {
  expect(nextMatchIndex(3, 2, 1)).toBe(0);
  expect(nextMatchIndex(3, 0, -1)).toBe(2);
  expect(nextMatchIndex(3, -1, 1)).toBe(0);
  expect(nextMatchIndex(3, -1, -1)).toBe(2);
  expect(nextMatchIndex(0, -1, 1)).toBe(-1);
});
