import { describe, expect, it } from "vitest";

import { extractAccessibilityYaml } from "./playwrightMcp";

describe("Playwright MCP accessibility snapshots", () => {
  it("accepts a transient empty inline snapshot", () => {
    expect(extractAccessibilityYaml("### Snapshot\n```yaml\n\n```\n")).toBe("");
  });

  it("rejects responses without an inline accessibility snapshot", () => {
    expect(() => extractAccessibilityYaml("### Snapshot\nNo inline tree")).toThrow(
      "Playwright MCP did not return an inline accessibility snapshot",
    );
  });
});
