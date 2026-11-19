import { describe, expect, it } from "vitest";
import { threadHoverCardRows } from "./threadHoverCard.logic";

const format = (iso: string) => `at ${iso}`;

describe("threadHoverCardRows", () => {
  it("lists status, branch and last activity", () => {
    expect(
      threadHoverCardRows(
        { statusLabel: "Working", branch: "feature/x", updatedAt: "2026-11-19T10:00:00.000Z" },
        format,
      ),
    ).toEqual([
      { label: "Status", value: "Working" },
      { label: "Branch", value: "feature/x" },
      { label: "Last activity", value: "at 2026-11-19T10:00:00.000Z" },
    ]);
  });

  it("falls back to snoozed or pinned when there is no status pill", () => {
    expect(
      threadHoverCardRows({ snoozed: true, updatedAt: "2026-11-19T10:00:00.000Z" }, format)[0],
    ).toEqual({ label: "Status", value: "Snoozed" });
    expect(
      threadHoverCardRows({ pinned: true, updatedAt: "2026-11-19T10:00:00.000Z" }, format)[0],
    ).toEqual({ label: "Status", value: "Pinned" });
  });

  it("skips empty branches and unreadable times", () => {
    expect(threadHoverCardRows({ branch: "  ", updatedAt: "nope" }, format)).toEqual([]);
  });
});
