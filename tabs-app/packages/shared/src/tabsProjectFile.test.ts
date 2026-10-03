import { describe, expect, it } from "vitest";

import { parseTabsProjectFile, parseT3ProjectFile } from "./tabsProjectFile.ts";

describe("tabsProjectFile", () => {
  it("parses valid JSONC with comments and trailing commas", () => {
    const jsonc = `
      {
        // Project configuration
        "defaultThreadEnvMode": "worktree",
        "scripts": [
          {
            "name": "Dev",
            "command": "bun run dev",
            "icon": "play",
          },
        ],
      }
    `;
    const parsed = parseTabsProjectFile(jsonc);
    expect(parsed).not.toBeNull();
    expect(parsed?.defaultThreadEnvMode).toBe("worktree");
    expect(parsed?.scripts?.length).toBe(1);
    expect(parsed?.scripts?.[0]?.name).toBe("Dev");
  });

  it("returns null for malformed JSON", () => {
    const invalid = `{ "scripts": [ invalid json }`;
    expect(parseTabsProjectFile(invalid)).toBeNull();
  });

  it("works with parseT3ProjectFile alias", () => {
    const parsed = parseT3ProjectFile(`{ "defaultThreadEnvMode": "local" }`);
    expect(parsed?.defaultThreadEnvMode).toBe("local");
  });
});
