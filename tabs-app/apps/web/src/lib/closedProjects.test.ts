import { beforeEach, describe, expect, it } from "vitest";
import {
  rememberClosedProject,
  resetClosedProjectsForTest,
  takeClosedProject,
} from "./closedProjects";

describe("closed project tabs", () => {
  beforeEach(resetClosedProjectsForTest);

  it("brings back the most recently closed project first", () => {
    rememberClosedProject("a");
    rememberClosedProject("b");
    expect(takeClosedProject(() => true)).toBe("b");
    expect(takeClosedProject(() => true)).toBe("a");
    expect(takeClosedProject(() => true)).toBeNull();
  });

  it("skips projects that can no longer be reopened", () => {
    rememberClosedProject("a");
    rememberClosedProject("gone");
    expect(takeClosedProject((id) => id !== "gone")).toBe("a");
    expect(takeClosedProject(() => true)).toBeNull();
  });

  it("moves a project to the end when it is closed again, without duplicates", () => {
    rememberClosedProject("a");
    rememberClosedProject("b");
    rememberClosedProject("a");
    expect(takeClosedProject(() => true)).toBe("a");
    expect(takeClosedProject(() => true)).toBe("b");
    expect(takeClosedProject(() => true)).toBeNull();
  });

  it("only remembers the last ten", () => {
    for (let n = 0; n < 12; n += 1) rememberClosedProject(`p${n}`);
    const taken: string[] = [];
    for (let id = takeClosedProject(() => true); id; id = takeClosedProject(() => true)) {
      taken.push(id);
    }
    expect(taken).toHaveLength(10);
    expect(taken[0]).toBe("p11");
    expect(taken.at(-1)).toBe("p2");
  });
});
