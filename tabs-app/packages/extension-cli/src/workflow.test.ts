import { describe, expect, it } from "vitest";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { humanOutput, targetVersion } from "./workflow.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

describe("developer CLI workflow", () => {
  it("initializes with a recorded target and supports readable or JSON validation", () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-cli-output-"));
    const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const project = Path.join(directory, "my-tool");
    const run = (args: string[], cwd = directory) =>
      spawnSync("bun", [cli, ...args], { cwd, encoding: "utf8", timeout: 10_000 });
    try {
      const missing = run(["init", project, "--template", "html"]);
      expect(missing.status).toBe(1);
      expect(FS.existsSync(project)).toBe(false);
      const incompatible = run(["init", project, "--template", "html", "--tabs-version", "1.2.0"]);
      expect(incompatible.status).toBe(1);
      expect(FS.existsSync(project)).toBe(false);
      const initialized = run([
        "init",
        project,
        "--template",
        "html",
        "--tabs-version",
        "1.3.17",
        "--json",
      ]);
      expect(initialized.status, initialized.stderr).toBe(0);
      expect(JSON.parse(initialized.stdout).directory).toBe(project);
      expect(targetVersion(undefined, project)).toBe("1.3.17");
      const build = spawnSync(process.execPath, ["scripts/stage.mjs"], {
        cwd: project,
        encoding: "utf8",
      });
      expect(build.status, build.stderr).toBe(0);
      const readable = run(["validate"], project);
      expect(readable.status, readable.stderr).toBe(0);
      expect(readable.stdout).toContain("Tabs extension validate");
      expect(readable.stdout).toContain("id: my-publisher.my-tool");
      const json = run(["validate", "--json"], project);
      expect(json.status, json.stderr).toBe(0);
      expect(JSON.parse(json.stdout).id).toBe("my-publisher.my-tool");
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("requires an explicit or recorded desktop target and allows override", () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-cli-target-"));
    try {
      expect(() => targetVersion(undefined, directory)).toThrow("--tabs-version");
      FS.writeFileSync(
        Path.join(directory, ".tabsext.json"),
        JSON.stringify({ tabsVersion: "1.3.17" }),
      );
      expect(targetVersion(undefined, directory)).toBe("1.3.17");
      expect(targetVersion("1.4.0", directory)).toBe("1.4.0");
      expect(() => targetVersion("latest", directory)).toThrow("--tabs-version");
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("renders readable bounded output without terminal escape sequences", () => {
    const output = humanOutput("inspect", {
      id: "publisher.tool",
      digest: "abc",
      manifest: { displayName: "Tool\u001b[2J" },
    });
    expect(output).toContain("id: publisher.tool");
    expect(output).toContain("digest: abc");
    expect(output).not.toContain("\u001b");
    expect(humanOutput("search", { extensions: Array(35).fill("tool") })).toContain(
      "5 more; use --json",
    );
  });
});
