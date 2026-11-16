import { describe, expect, it } from "vitest";

import { buildThreadTree, markActiveThreadPath, splitSidebarHelpers } from "./threadTree";

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

  it("hides sub-threads whose lead is in a section that is not shown", () => {
    const lead = t("lead");
    const child = t("child", "lead");
    const grandchild = t("grand", "child");
    const other = t("other");
    // Active view: the lead is done, so its whole subtree stays out of this view.
    const active = buildThreadTree(
      [{ name: "active" as const, threads: [child, grandchild, other] }],
      [lead, child, grandchild, other],
      none,
    );
    expect(active.map((e) => e.thread.id)).toEqual(["other"]);
    // Done view: the lead brings its sub-threads with it.
    const done = buildThreadTree(
      [{ name: "settled" as const, threads: [lead] }],
      [lead, child, grandchild, other],
      none,
    );
    expect(done.map((e) => [e.thread.id, e.depth])).toEqual([
      ["lead", 0],
      ["child", 1],
      ["grand", 2],
    ]);
  });
});

describe("splitSidebarHelpers", () => {
  const t = (id: string, title: string, parentThreadId: string | null, isSubagent = false) => ({
    id,
    title,
    parentThreadId,
    isSubagent,
  });

  it("keeps plain sub-agents out of the list, grouped under their parent, with their descendants", () => {
    const threads = [
      t("lead", "Lead", null),
      t("helper", "Check the API", "lead", true),
      t("deep", "Helper's helper", "helper", true),
      t("plan", "Overmind · api:research · Read docs", "lead", true),
      t("fork", "Forked idea", "lead", false),
    ];
    const { listed, helpersByParent } = splitSidebarHelpers(threads);
    expect(listed.map((thread) => thread.id)).toEqual(["lead", "plan", "fork"]);
    expect(helpersByParent.get("lead")?.map((thread) => thread.id)).toEqual(["helper"]);
    expect(helpersByParent.get("helper")?.map((thread) => thread.id)).toEqual(["deep"]);
  });

  it("survives a parent cycle", () => {
    const threads = [t("a", "A", "b"), t("b", "B", "a")];
    expect(splitSidebarHelpers(threads).listed).toHaveLength(2);
  });
});

describe("markActiveThreadPath", () => {
  const threads = [
    { id: "lead", parentThreadId: null },
    { id: "one", parentThreadId: "lead" },
    { id: "two", parentThreadId: "lead" },
    { id: "three", parentThreadId: "lead" },
    { id: "other", parentThreadId: null },
  ];
  const entries = buildThreadTree([{ name: "active", threads }], threads, new Set<string>());

  it("bars the family, lights the guide down to the open sub-thread and only its title", () => {
    const mark = markActiveThreadPath(entries, threads, "three");
    expect(mark("lead")).toMatchObject({ familyBar: true, selected: false });
    expect(mark("one")).toMatchObject({ railLit: true, elbowLit: false, selected: false });
    expect(mark("two")).toMatchObject({ railLit: true, elbowLit: false });
    expect(mark("three")).toMatchObject({ selected: true, elbowLit: true, railLit: false });
    expect(mark("other")).toMatchObject({ familyBar: false, selected: false });
  });

  it("leaves later siblings unlit and treats an open top-level thread as plain selection", () => {
    const toFirst = markActiveThreadPath(entries, threads, "one");
    expect(toFirst("two")).toMatchObject({ railLit: false });
    const top = markActiveThreadPath(entries, threads, "lead");
    expect(top("lead")).toMatchObject({ selected: true, familyBar: false, elbowLit: false });
    expect(top("one")).toMatchObject({ railLit: false });
  });
});
