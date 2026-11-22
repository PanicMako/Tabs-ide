import { TEAMMATE_SOUL_MAX_LENGTH } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import { appendSoulLine } from "./TeammateSoul";
import { suggestTeammateNames, TEAMMATE_TEMPLATES, templateById } from "./teammateTemplates";
import {
  railStatus,
  statusSentence,
  uniqueTeammateName,
  workerStatusLine,
} from "./teammates.logic";

const calm = { mood: "idle", needsYouCount: 0, workingCount: 0, thinkingCount: 0 } as const;

describe("templates", () => {
  it("ship five starters with valid souls and unique ids", () => {
    expect(TEAMMATE_TEMPLATES.map((t) => t.id)).toHaveLength(5);
    expect(new Set(TEAMMATE_TEMPLATES.map((t) => t.id)).size).toBe(5);
    for (const template of TEAMMATE_TEMPLATES) {
      expect(template.soul.length).toBeLessThan(TEAMMATE_SOUL_MAX_LENGTH);
      expect(template.soul.startsWith(`# ${template.name}`)).toBe(true);
      expect(template.asks.length).toBeGreaterThanOrEqual(3);
    }
    expect(templateById("nope").id).toBe("generalist");
  });
  it("suggests free names only", () => {
    const names = suggestTeammateNames([{ name: "pip" }, { name: "Marlo" }], 3);
    expect(names).toHaveLength(3);
    expect(names).not.toContain("Pip");
    expect(names).not.toContain("Marlo");
  });
  it("makes names unique", () => {
    expect(uniqueTeammateName("Reviewer", [{ name: "Notch" }])).toBe("Reviewer");
    expect(uniqueTeammateName("Reviewer", [{ name: "reviewer" }])).toBe("Reviewer 2");
  });
});

describe("status copy", () => {
  it("puts needs-you first and speaks plainly", () => {
    expect(railStatus({ ...calm, needsYouCount: 2, workingCount: 1 }, 0, false)).toBe(
      "Needs you on 2 things",
    );
    expect(railStatus({ ...calm, workingCount: 1 }, 0, false)).toBe("Working on 1 thing");
    expect(railStatus(calm, 0, true)).toBe("Paused");
    expect(railStatus(calm, 2, false)).toBe("2 ideas for you");
    expect(statusSentence("Notch", calm, 0, false)).toContain("free");
    expect(statusSentence("Notch", { ...calm, workingCount: 2 }, 0, false)).toContain("2 things");
  });
  it("describes workers", () => {
    expect(workerStatusLine(null, 0)).toBe("Not started yet");
    expect(workerStatusLine(null, 1)).toBe("Worker started");
    expect(workerStatusLine({ title: "t", running: true, failed: false }, 2)).toBe(
      "2 workers running",
    );
    expect(workerStatusLine({ title: "t", running: false, failed: true }, 1)).toContain("error");
  });
});

describe("soul lines", () => {
  it("appends once", () => {
    const once = appendSoulLine("# A\n", "Be direct.");
    expect(once).toBe("# A\n- Be direct.\n");
    expect(appendSoulLine(once, "Be direct.")).toBe(once);
  });
});
