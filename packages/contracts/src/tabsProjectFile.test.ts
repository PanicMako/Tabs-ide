import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  TABS_PROJECT_FILE_NAME,
  T3_PROJECT_FILE_NAME,
  TabsProjectFile,
} from "./tabsProjectFile.ts";

const decode = Schema.decodeUnknownSync(TabsProjectFile);

describe("TabsProjectFile", () => {
  it("defines standard file names", () => {
    expect(TABS_PROJECT_FILE_NAME).toBe("tabs.json");
    expect(T3_PROJECT_FILE_NAME).toBe("t3.json");
  });

  it("decodes valid empty project file", () => {
    const result = decode({});
    expect(result).toEqual({});
  });

  it("decodes project file with scripts and options", () => {
    const result = decode({
      $schema: "https://tabs.tools/schema/tabs.json",
      iconPath: "assets/icon.png",
      defaultThreadEnvMode: "worktree",
      scripts: [
        {
          name: "Setup",
          command: "bun install",
          icon: "configure",
          runOnWorktreeCreate: true,
        },
        {
          name: "Dev",
          command: "bun run dev",
          icon: "play",
          previewUrl: "http://localhost:3000",
          autoOpenPreview: true,
        },
      ],
    });
    expect(result.scripts?.length).toBe(2);
    expect(result.scripts?.[0]?.name).toBe("Setup");
    expect(result.scripts?.[0]?.runOnWorktreeCreate).toBe(true);
    expect(result.scripts?.[1]?.previewUrl).toBe("http://localhost:3000");
    expect(result.defaultThreadEnvMode).toBe("worktree");
  });
});
