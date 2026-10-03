import type { GitStatusFile } from "@tabs/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FileRow } from "./ChangesPanel";

const file: GitStatusFile = {
  path: "src/example.ts",
  staged: false,
  unstaged: true,
  conflicted: false,
  untracked: false,
  insertions: 2,
  deletions: 1,
};

describe("Git change row accessibility", () => {
  it.each([
    [false, "Stage src/example.ts"],
    [true, "Unstage src/example.ts"],
  ] as const)("names every icon action when staged is %s", (staged, stageLabel) => {
    const markup = renderToStaticMarkup(
      <FileRow
        cwd="/workspace"
        f={{ ...file, staged, unstaged: !staged }}
        staged={staged}
        onOpenDiff={vi.fn()}
        onToggleStage={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Preview inline diff for src/example.ts"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Open full diff for src/example.ts"');
    expect(markup).toContain('aria-label="Discard changes to src/example.ts"');
    expect(markup).toContain(`aria-label="${stageLabel}"`);
  });
});
