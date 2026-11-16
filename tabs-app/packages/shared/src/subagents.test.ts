import { describe, expect, it } from "vitest";

import {
  applySubagentModel,
  buildSubagentTaskPrompt,
  DEFAULT_SUBAGENT_MODEL_SETTINGS,
  describeSubagentModelsForLead,
  isSubagentStaffingActive,
  resolveSubagentModel,
} from "./subagents.ts";

const luna = { instanceId: "codex", model: "gpt-6-luna" } as never;
const strong = {
  instanceId: "claude",
  model: "opus",
  options: [{ id: "effort", value: "high" }],
} as never;
const settings = { enabled: true, workers: luna, roles: { review: strong } } as never;

describe("sub-agent model resolution", () => {
  it("is inactive when off or when nothing is picked", () => {
    expect(isSubagentStaffingActive(DEFAULT_SUBAGENT_MODEL_SETTINGS)).toBe(false);
    expect(isSubagentStaffingActive({ enabled: false, workers: luna, roles: {} } as never)).toBe(
      false,
    );
    expect(isSubagentStaffingActive({ enabled: true, workers: null, roles: {} })).toBe(false);
    expect(isSubagentStaffingActive(undefined)).toBe(false);
  });

  it("prefers the role's own model, then the default; no role counts as general", () => {
    expect(resolveSubagentModel(settings, "review")).toBe(strong);
    expect(resolveSubagentModel(settings, "design")).toBe(luna);
    expect(resolveSubagentModel(settings, undefined)).toBe(luna);
    const roleOnly = { enabled: true, workers: null, roles: { design: strong } } as never;
    expect(resolveSubagentModel(roleOnly, "design")).toBe(strong);
    expect(resolveSubagentModel(roleOnly, "test")).toBeNull();
  });

  it("replaces the lead's target whole while active, and keeps it otherwise", () => {
    const requested = {
      providerInstanceId: "claude",
      model: "sonnet",
      options: [{ id: "effort", value: "low" }],
    } as never;
    expect(applySubagentModel(settings, "implementation", requested)).toEqual({
      providerInstanceId: "codex",
      model: "gpt-6-luna",
    });
    expect(applySubagentModel(settings, "review", requested)).toEqual({
      providerInstanceId: "claude",
      model: "opus",
      options: [{ id: "effort", value: "high" }],
    });
    expect(applySubagentModel(DEFAULT_SUBAGENT_MODEL_SETTINGS, "review", requested)).toBe(
      requested,
    );
    expect(applySubagentModel(undefined, "review", undefined)).toBeUndefined();
  });

  it("tells the lead what is enforced", () => {
    expect(describeSubagentModelsForLead(settings)).toEqual({
      enforced: true,
      default: { providerInstanceId: "codex", model: "gpt-6-luna" },
      roles: [{ role: "review", providerInstanceId: "claude", model: "opus" }],
    });
    expect(describeSubagentModelsForLead(undefined)).toEqual({
      enforced: false,
      default: null,
      roles: [],
    });
  });
});

describe("sub-agent role briefs", () => {
  it("leads the task with the role's brief", () => {
    const prompt = buildSubagentTaskPrompt("design", "Restyle the header");
    expect(prompt.startsWith("You are the design sub-agent for this task.")).toBe(true);
    expect(prompt).toContain("design rules");
    expect(prompt.endsWith("\n\nRestyle the header")).toBe(true);
    expect(buildSubagentTaskPrompt("review", "x")).toContain("do not modify files");
  });

  it("leaves general and role-less tasks as written", () => {
    expect(buildSubagentTaskPrompt("general", "Do it")).toBe("Do it");
    expect(buildSubagentTaskPrompt(undefined, "Do it")).toBe("Do it");
  });
});
