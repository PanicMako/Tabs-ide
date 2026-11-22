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
