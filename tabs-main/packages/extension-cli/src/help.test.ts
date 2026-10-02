import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cliHelp } from "./help.ts";

describe("CLI help", () => {
  it("lists real commands and the experimental credential workflow", () => {
    const help = cliHelp();
    for (const command of [
      "init",
      "dev",
      "validate",
      "pack",
      "inspect",
      "registry",
      "search",
      "publish",
      "status",
    ])
      expect(help).toContain(command);
    expect(help).toContain("TABS_EXCHANGE_TOKEN");
    expect(help).toContain("no CLI login");
  });

  it("explains that publishing is submission, not publication", () => {
    expect(cliHelp("publish")).toContain("does not mean approval or signed publication");
  });

  it("does not invent commands", () => {
    expect(() => cliHelp("login")).toThrow("Unknown command: login");
  });

  it.each([["--help"], ["-h"], ["publish", "--help"], ["help", "publish"]])(
    "exits successfully without running a command for %j",
    (...args) => {
      const result = spawnSync(
        "bun",
        [fileURLToPath(new URL("./cli.ts", import.meta.url)), ...args],
        {
          encoding: "utf8",
          env: { ...process.env, TABS_EXCHANGE_TOKEN: "invalid-help-must-not-read-this" },
          timeout: 10_000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Usage: tabsext");
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("invalid-help-must-not-read-this");
    },
  );
});
