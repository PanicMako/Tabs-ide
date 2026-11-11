import { describe, expect, it } from "vitest";
import { detectPackageManager, suggestScripts } from "./scriptSuggestions";

const pkg = JSON.stringify({
  scripts: { test: "vitest", postinstall: "patch", lint: "oxlint", dev: "vite", custom: "x" },
});

describe("suggestScripts", () => {
  it("ranks everyday scripts first, skips lifecycle hooks and uses the project's manager", () => {
    const names = new Set(["package.json", "bun.lock"]);
    expect(detectPackageManager(names)).toBe("bun");
    expect(suggestScripts({ rootNames: names, packageJson: pkg }).map((s) => s.command)).toEqual([
      "bun run dev",
      "bun run test",
      "bun run lint",
      "bun run custom",
    ]);
  });

  it("does not suggest commands that are already presets, and covers Cargo and Go", () => {
    const names = new Set(["package.json", "yarn.lock", "Cargo.toml", "go.mod"]);
    const commands = suggestScripts({
      rootNames: names,
      packageJson: pkg,
      existingCommands: new Set(["yarn dev"]),
    }).map((s) => s.command);
    expect(commands).not.toContain("yarn dev");
    expect(commands.slice(0, 1)).toEqual(["yarn test"]);
    expect(commands.length).toBeLessThanOrEqual(6);
  });

  it("tolerates a broken package.json", () => {
    expect(suggestScripts({ rootNames: new Set(["package.json"]), packageJson: "{" })).toEqual([]);
  });
});
