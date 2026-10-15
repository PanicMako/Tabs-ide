import { expect, it } from "vitest";
import { resolveProjectScripts, projectScriptsInheritDefaults } from "./projectScripts.ts";
it("uses folded overrides including empty arrays and ignores legacy aggregate after folding", () => {
  const old = { id: "old" },
    defaults = { id: "default" };
  const project = { id: "p", scripts: [old] } as never;
  const settings = {
    defaultProjectScripts: [defaults],
    projectScriptOverrides: { p: [old] },
    projectSettingsFolded: true,
    projectSettingsOverrides: {},
  };
  expect(resolveProjectScripts(settings as never, project)).toEqual([defaults]);
  expect(projectScriptsInheritDefaults(settings as never, project)).toBe(true);
  const explicit = { ...settings, projectSettingsOverrides: { p: { defaultProjectScripts: [] } } };
  expect(resolveProjectScripts(explicit as never, project)).toEqual([]);
  expect(projectScriptsInheritDefaults(explicit as never, project)).toBe(false);
});
