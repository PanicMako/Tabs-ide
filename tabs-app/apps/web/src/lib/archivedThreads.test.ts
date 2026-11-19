import { describe, expect, it } from "vitest";
import { archivedAgoLabel, archivedThreadRows } from "./archivedThreads";

const projects = [{ id: "p1", environmentId: "e1", name: "Tabs" }];
const thread = (id: string, archivedAt: string | null, title = id) => ({
  id,
  environmentId: "e1",
  projectId: "p1",
  title,
  archivedAt,
});

describe("archivedThreadRows", () => {
  it("lists only archived threads, newest archive first, with their project", () => {
    const rows = archivedThreadRows(
      [
        thread("old", "2026-11-01T00:00:00.000Z"),
        thread("live", null),
        thread("new", "2026-11-10T00:00:00.000Z"),
      ],
      projects,
    );
    expect(rows.map((row) => row.threadId)).toEqual(["new", "old"]);
    expect(rows[0]?.projectName).toBe("Tabs");
  });

  it("names untitled threads and unknown projects", () => {
    const rows = archivedThreadRows(
      [{ ...thread("t", "2026-11-01T00:00:00.000Z", "  "), projectId: "gone" }],
      projects,
    );
    expect(rows[0]).toMatchObject({ title: "Untitled thread", projectName: "Unknown project" });
  });

  it("is empty when nothing is archived", () => {
    expect(archivedThreadRows([thread("a", null)], projects)).toEqual([]);
  });
});

describe("archivedAgoLabel", () => {
  const now = Date.parse("2026-11-19T12:00:00.000Z");
  it("describes how long ago in plain words", () => {
    expect(archivedAgoLabel("2026-11-19T01:00:00.000Z", now)).toBe("Archived today");
    expect(archivedAgoLabel("2026-11-18T01:00:00.000Z", now)).toBe("Archived yesterday");
    expect(archivedAgoLabel("2026-11-14T01:00:00.000Z", now)).toBe("Archived 5 days ago");
  });
});
