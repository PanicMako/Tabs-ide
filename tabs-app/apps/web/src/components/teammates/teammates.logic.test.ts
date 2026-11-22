import { describe, expect, it } from "vitest";
import type { TeammateItem, TeammateNotice, TeammateSuggestion } from "@tabs/contracts";
import {
  activityFor,
  badgeCount,
  createNoticeTracker,
  defaultTeammateName,
  formatBadge,
  groupItems,
  noticeToToast,
  normalizeTeammateName,
  resolveActiveTeammate,
  sortSuggestions,
} from "./teammates.logic";
import { moodLook } from "./notchMood";

const item = (id: string, status: TeammateItem["status"], updatedAt: string, teammateId = "t1") =>
  ({ id, teammateId, status, updatedAt, title: id }) as unknown as TeammateItem;
const suggestion = (id: string, status: TeammateSuggestion["status"], createdAt: string) =>
  ({ id, teammateId: "t1", status, createdAt }) as unknown as TeammateSuggestion;
const notice = (id: string, kind: TeammateNotice["kind"] = "needsYou") =>
  ({
    id,
    teammateId: "t1",
    kind,
    title: "Pick a branch",
    threadId: null,
  }) as unknown as TeammateNotice;

describe("defaultTeammateName", () => {
  it("starts at Notch and counts up", () => {
    expect(defaultTeammateName([])).toBe("Notch");
    expect(defaultTeammateName([{ name: "Notch" }])).toBe("Notch 2");
    expect(defaultTeammateName([{ name: "notch" }, { name: "Notch 2" }])).toBe("Notch 3");
  });
  it("reuses Notch when it was renamed", () => {
    expect(defaultTeammateName([{ name: "Ada" }])).toBe("Notch");
  });
});

describe("normalizeTeammateName", () => {
  it("rejects empty, unchanged and overlong names", () => {
    expect(normalizeTeammateName("  ", "A")).toBeNull();
    expect(normalizeTeammateName(" Ada ", "Ada")).toBeNull();
    expect(normalizeTeammateName("x".repeat(65))).toBeNull();
    expect(normalizeTeammateName(" Ada ", "Notch")).toBe("Ada");
  });
});

describe("groupItems", () => {
  it("puts Needs you first, hides closed items and filters by teammate", () => {
    const groups = groupItems(
      [
        item("a", "todo", "2026-01-01"),
        item("b", "needsYou", "2026-01-01"),
        item("c", "working", "2026-01-02"),
        item("d", "done", "2026-01-03"),
        item("e", "needsYou", "2026-01-05"),
        item("f", "todo", "2026-01-01", "t2"),
      ],
      "t1",
    );
    expect(groups.map((g) => g.label)).toEqual(["Needs you", "Working", "To do"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["e", "b"]);
    expect(groupItems([item("d", "done", "x")], "t1", { includeClosed: true })).toHaveLength(1);
  });
});

describe("sortSuggestions", () => {
  it("lists open first, newest first", () => {
    const sorted = sortSuggestions(
      [
        suggestion("s1", "started", "2026-01-09"),
        suggestion("s2", "open", "2026-01-01"),
        suggestion("s3", "open", "2026-01-02"),
      ],
      "t1",
    );
    expect(sorted.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
  });
});

describe("badge", () => {
  it("prefers needsYou over suggestions and caps at 9+", () => {
    expect(badgeCount({ needsYouCount: 2 }, 5)).toBe(2);
    expect(badgeCount({ needsYouCount: 0 }, 5)).toBe(5);
    expect(formatBadge(12)).toBe("9+");
    expect(formatBadge(3)).toBe("3");
  });
});

describe("notices", () => {
  it("seeds on the first snapshot, then toasts each id once", () => {
    const tracker = createNoticeTracker();
    expect(tracker.next([notice("n1")])).toEqual([]);
    expect(tracker.next([notice("n1"), notice("n2")]).map((n) => n.id)).toEqual(["n2"]);
    expect(tracker.next([notice("n1"), notice("n2")])).toEqual([]);
    tracker.reset();
    expect(tracker.next([notice("n3")])).toEqual([]);
  });
  it("words toasts with the teammate name", () => {
    const teammates = [{ id: "t1", name: "Ada" }] as never;
    expect(noticeToToast(notice("n"), teammates).title).toBe("Ada needs you");
    expect(noticeToToast(notice("n", "workDone"), teammates).type).toBe("success");
    expect(noticeToToast(notice("n", "couldntFinish"), teammates).type).toBe("error");
  });
});

describe("activity and active teammate", () => {
  it("falls back to idle and to the first teammate", () => {
    expect(activityFor([], "t1").mood).toBe("idle");
    expect(resolveActiveTeammate([{ id: "a" }, { id: "b" }], "b")?.id).toBe("b");
    expect(resolveActiveTeammate([{ id: "a" }], "gone")?.id).toBe("a");
    expect(resolveActiveTeammate([], null)).toBeNull();
  });
  it("only needsYou and error redirect the eyes", () => {
    expect(moodLook("needsYou")).toEqual({ x: 0, y: 6 });
    expect(moodLook("idle")).toBeUndefined();
  });
});

describe("memory helpers", () => {
  const facts = [
    { text: "Prefers small pull requests", topic: "Review", source: "owner" },
    { text: "Uses pnpm", topic: null, source: "teammate" },
    { text: "Tests live in __tests__", topic: "Review", source: "look-around" },
  ];
  it("labels sources in plain words and passes unknown ones through", async () => {
    const { memorySourceLabel } = await import("./teammates.logic");
    expect(memorySourceLabel("owner")).toBe("You told it");
    expect(memorySourceLabel("look-around")).toBe("From looking around");
    expect(memorySourceLabel("elsewhere")).toBe("elsewhere");
  });
  it("filters by text, topic and source label", async () => {
    const { filterMemoryFacts } = await import("./teammates.logic");
    expect(filterMemoryFacts(facts, "  ")).toHaveLength(3);
    expect(filterMemoryFacts(facts, "PNPM")).toHaveLength(1);
    expect(filterMemoryFacts(facts, "review")).toHaveLength(2);
    expect(filterMemoryFacts(facts, "you told")).toHaveLength(1);
  });
  it("groups by topic with loose facts last", async () => {
    const { groupMemoryFacts } = await import("./teammates.logic");
    const groups = groupMemoryFacts(facts);
    expect(groups.map((group) => group.topic)).toEqual(["Review", null]);
    expect(groups[0]!.facts).toHaveLength(2);
  });
});

describe("finish options", () => {
  it("names every finish exactly once, and every template uses a known one", async () => {
    const { FINISH_OPTIONS } = await import("./teammates.logic");
    const { TEAMMATE_TEMPLATES } = await import("./teammateTemplates");
    const { TeammatePresetFinish } = await import("@tabs/contracts");
    const ids = FINISH_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...TeammatePresetFinish.literals].sort());
    for (const template of TEAMMATE_TEMPLATES) expect(ids).toContain(template.finish);
  });
});

describe("finish swatches", () => {
  it("gives every finish a colour and gradients for lit materials", async () => {
    const { FINISH_OPTIONS } = await import("./teammates.logic");
    const { finishSwatch } = await import("./notchFinish");
    for (const option of FINISH_OPTIONS) expect(finishSwatch(option.id)).not.toBe("");
    expect(finishSwatch("signature")).toBe("#0e2af3");
    expect(finishSwatch("brass")).toContain("linear-gradient");
  });
});

describe("coverflow pose", () => {
  it("centres the chosen card and parks distant ones out of sight", async () => {
    const { coverflowPose } = await import("./TemplateCarousel");
    const middle = coverflowPose(0, 150);
    expect(middle).toMatchObject({ x: 0, rotationY: 0, scale: 1, opacity: 1 });
    expect(coverflowPose(1, 150).x).toBe(150);
    expect(coverflowPose(-1, 150).rotationY).toBeGreaterThan(0);
    expect(coverflowPose(5, 150).opacity).toBe(0);
    expect(coverflowPose(5, 150).x).toBe(coverflowPose(2, 150).x);
  });
});

describe("custom finishes", () => {
  it("round-trips a hue and rejects anything else", async () => {
    const { customFinishHue, customFinishId, finishSwatch, materialFor } =
      await import("./notchFinish");
    expect(customFinishId(212)).toBe("hue-212");
    expect(customFinishId(-30)).toBe("hue-330");
    expect(customFinishId(725)).toBe("hue-5");
    expect(customFinishHue("hue-212")).toBe(212);
    expect(customFinishHue("hue-360")).toBe(0);
    expect(customFinishHue("ember")).toBeNull();
    expect(finishSwatch("hue-120")).toContain("hsl(120");
    expect(materialFor("hue-120")?.stops).toHaveLength(3);
  });
  it("names a dial colour Custom", async () => {
    const { finishName } = await import("./teammates.logic");
    expect(finishName("hue-40")).toBe("Custom");
    expect(finishName("brass")).toBe("Brass");
  });
  it("accepts a custom finish in the contract", async () => {
    const { Schema } = await import("effect");
    const { TeammateFinish } = await import("@tabs/contracts");
    expect(Schema.is(TeammateFinish)("hue-212")).toBe(true);
    expect(Schema.is(TeammateFinish)("hue-x")).toBe(false);
    expect(Schema.is(TeammateFinish)("brass")).toBe(true);
  });
});

describe("starting soul", () => {
  it("builds a custom soul around its purpose and renames a starter's", async () => {
    const { CUSTOM_TEMPLATE, startingSoul, templateById } = await import("./teammateTemplates");
    const custom = startingSoul(CUSTOM_TEMPLATE, "Quill", "keeps our changelog honest.");
    expect(custom.startsWith("# Quill")).toBe(true);
    expect(custom).toContain("Your job: keeps our changelog honest.");
    expect(startingSoul(templateById("pr-reviewer"), "Rev", "").startsWith("# Rev")).toBe(true);
  });
});
