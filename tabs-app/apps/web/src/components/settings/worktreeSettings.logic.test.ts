import { describe, expect, it } from "vitest";
import {
  branchNamingFields,
  submodulesChoice,
  submodulesFromChoice,
} from "./worktreeSettings.logic";

describe("worktree settings helpers", () => {
  it("treats no submodule setting as following the repository", () => {
    expect(submodulesChoice(null)).toBe("repository");
    expect(submodulesChoice(undefined)).toBe("repository");
    expect(submodulesFromChoice("repository")).toBeNull();
  });

  it("round-trips an explicit submodule choice", () => {
    for (const value of ["recursive", "top-level", "none"] as const) {
      expect(submodulesFromChoice(submodulesChoice(value))).toBe(value);
    }
  });

  it("shows only the branch-naming fields that apply to the mode", () => {
    expect(branchNamingFields("static")).toEqual({ prefix: true, instructions: false });
    expect(branchNamingFields("semantic")).toEqual({ prefix: false, instructions: false });
    expect(branchNamingFields("custom")).toEqual({ prefix: false, instructions: true });
  });
});
