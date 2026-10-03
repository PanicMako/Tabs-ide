import { describe, expect, it } from "vitest";
import { playwrightToolConfig } from "./playwrightToolConfig";

describe("per-run official Playwright tool configuration", () => {
  it("leaves normal generation unchanged", () => expect(playwrightToolConfig()).toEqual([]));
  it("uses the selected run's paths without changing global configuration", () => {
    const args = playwrightToolConfig({
      command: "/runtime/node",
      args: ["/path with spaces/cli.js", "run-test-mcp-server"],
      cwd: "/candidate",
      nodePath: "/modules",
    });
    expect(args).toContain('mcp_servers.tabs_playwright.command="/runtime/node"');
    expect(args).toContain("mcp_servers.tabs_playwright.required=true");
    expect(args).toContain(
      'mcp_servers.tabs_playwright.env={ ELECTRON_RUN_AS_NODE = "1", NODE_PATH = "/modules" }',
    );
    expect(args.join(" ")).not.toContain("skip-permissions");
  });
});
