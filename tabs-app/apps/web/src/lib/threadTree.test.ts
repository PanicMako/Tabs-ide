import { describe, expect, it } from "vitest";

import { buildThreadTree } from "./threadTree";

const t = (id: string, parent: string | null = null) => ({ id, parentThreadId: parent });
const none = new Set<string>();

describe("buildThreadTree", () => {
  it("draws a child under its parent even when they sit in different sections", () => {
    const lead = t("lead");
    const child = t("child", "lead");
    const entries = buildThreadTree(
      [
        { name: "active" as const, threads: [lead] },
        { name: "settled" as const, threads: [child] },
      ],
      [lead, child],
      none,
    );
    expect(entries.map((e) => [e.thread.id, e.kind, e.section, e.depth])).toEqual([
      ["lead", "thread", "active", 0],
      ["child", "thread", "active", 1],
    ]);
  });

  it("collapses a parent to one summary line with the nested count", () => {
    const a = t("a");
    const a1 = t("a1", "a");
    const a2 = t("a2", "a");
    const entries = buildThreadTree(
      [{ name: "active" as const, threads: [a, a1, a2] }],
      [a, a1, a2],
      new Set(["a"]),
    );
    expect(entries.map((e) => e.kind)).toEqual(["thread", "summary"]);
    const summary = entries[1]!;
    expect(summary.kind === "summary" && summary.count).toBe(2);
  });

  it("marks the last child so the connector can end there", () => {
    const a = t("a");
    const a1 = t("a1", "a");
    const a2 = t("a2", "a");
    const entries = buildThreadTree(
      [{ name: "active" as const, threads: [a, a1, a2] }],
      [a, a1, a2],
      none,
    );
    const last = entries.find((e) => e.thread.id === "a2");
    expect(last?.kind === "thread" && last.lastChild).toBe(true);
  });

  it("keeps orphans and never drops threads in a parent cycle", () => {
    const orphan = t("o", "missing");
    const x = t("x", "y");
    const y = t("y", "x");
    const entries = buildThreadTree(
      [{ name: "active" as const, threads: [orphan, x, y] }],
      [orphan, x, y],
      none,
    );
    expect(entries.map((e) => e.thread.id).toSorted()).toEqual(["o", "x", "y"]);
  });
});
