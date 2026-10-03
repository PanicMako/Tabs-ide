import { describe, expect, it } from "vitest";
import type { ProjectId, ProjectScript, ServerSettings } from "@tabs/contracts";

import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  projectScriptsInheritDefaults,
  resolveProjectScripts,
  setupProjectScript,
} from "./projectScripts.ts";

const scriptA: ProjectScript = {
  id: "setup",
  name: "Setup",
  command: "bun install",
  icon: "configure",
  runOnWorktreeCreate: true,
};

const scriptB: ProjectScript = {
  id: "build",
  name: "Build",
  command: "bun run build",
  icon: "build",
  runOnWorktreeCreate: false,
};

const defaultSettings: Pick<ServerSettings, "defaultProjectScripts" | "projectScriptOverrides"> = {
  defaultProjectScripts: [scriptA],
  projectScriptOverrides: {},
};

describe("projectScripts", () => {
  it("resolves project scripts from project definition when present", () => {
    const project = { id: "p1" as ProjectId, scripts: [scriptB] };
    const resolved = resolveProjectScripts(defaultSettings, project);
    expect(resolved).toEqual([scriptB]);
  });

  it("resolves to default scripts when project has no scripts", () => {
    const project = { id: "p1" as ProjectId, scripts: [] };
    const resolved = resolveProjectScripts(defaultSettings, project);
    expect(resolved).toEqual([scriptA]);
  });

  it("respects project script overrides", () => {
    const settings = {
      ...defaultSettings,
      projectScriptOverrides: {
        ["p1" as ProjectId]: [scriptB],
      },
    };
    const project = { id: "p1" as ProjectId, scripts: [scriptA] };
    const resolved = resolveProjectScripts(settings, project);
    expect(resolved).toEqual([scriptB]);
  });

  it("resets to defaults when override is null", () => {
    const settings = {
      ...defaultSettings,
      projectScriptOverrides: {
        ["p1" as ProjectId]: null,
      },
    };
    const project = { id: "p1" as ProjectId, scripts: [scriptB] };
    const resolved = resolveProjectScripts(settings, project);
    expect(resolved).toEqual([scriptA]);
  });

  it("identifies setup script with runOnWorktreeCreate", () => {
    expect(setupProjectScript([scriptB, scriptA])).toBe(scriptA);
    expect(setupProjectScript([scriptB])).toBeNull();
  });

  it("constructs project script runtime env with TABS and T3 backward compatibility", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/workspace/my-app" },
      worktreePath: "/workspace/my-app/.worktrees/pr-1",
      extraEnv: { CUSTOM_VAR: "true" },
    });
    expect(env.TABS_PROJECT_ROOT).toBe("/workspace/my-app");
    expect(env.T3CODE_PROJECT_ROOT).toBe("/workspace/my-app");
    expect(env.TABS_WORKTREE_PATH).toBe("/workspace/my-app/.worktrees/pr-1");
    expect(env.T3CODE_WORKTREE_PATH).toBe("/workspace/my-app/.worktrees/pr-1");
    expect(env.CUSTOM_VAR).toBe("true");
  });

  it("determines working directory preference", () => {
    expect(projectScriptCwd({ project: { cwd: "/repo" } })).toBe("/repo");
    expect(projectScriptCwd({ project: { cwd: "/repo" }, worktreePath: "/wt" })).toBe("/wt");
  });

  it("checks if project inherits defaults", () => {
    expect(
      projectScriptsInheritDefaults(defaultSettings, { id: "p1" as ProjectId, scripts: [] }),
    ).toBe(true);
    expect(
      projectScriptsInheritDefaults(defaultSettings, { id: "p1" as ProjectId, scripts: [scriptB] }),
    ).toBe(false);
  });
});
