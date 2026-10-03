import { describe, expect, it } from "vitest";

import {
  dedupeProviderSkillsByName,
  formatProviderSkillDisplayName,
  getProviderSlashCommandsForSlashMenu,
  getProviderSkillsForSlashMenu,
  resolveProviderSkillSourceKind,
} from "./providerSkills";

const skill = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  path: `/repo/.agents/skills/${name}/SKILL.md`,
  enabled: true,
  ...overrides,
});

describe("provider skill presentation", () => {
  it("formats, filters and deduplicates invocable skills", () => {
    expect(formatProviderSkillDisplayName(skill("code-review"))).toBe("Code Review");
    expect(
      getProviderSkillsForSlashMenu([
        skill("review"),
        skill("REVIEW"),
        skill("disabled", { enabled: false }),
        skill("agent-only", { userInvocable: false }),
      ]),
    ).toEqual([skill("review")]);
    expect(dedupeProviderSkillsByName([skill("one"), skill("ONE")])).toHaveLength(1);
  });

  it("keeps provider commands distinct from skills and identifies skill scope", () => {
    expect(
      getProviderSlashCommandsForSlashMenu(
        [{ name: "review" }, { name: "compact" }],
        [skill("review")],
      ),
    ).toEqual([{ name: "compact" }]);
    expect(resolveProviderSkillSourceKind(skill("repo", { scope: "repository" }))).toBe("repo");
    expect(
      resolveProviderSkillSourceKind(
        skill("plugin", { path: "/Users/me/.codex/plugins/example/skills/plugin/SKILL.md" }),
      ),
    ).toBe("app");
  });
});
