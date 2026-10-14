import { describe, expect, it } from "vitest";
import {
  parseWorkspaceFileContext,
  workspaceFileMention,
  absoluteWorkspacePath,
} from "./workspaceFileContext";
import { splitPromptIntoComposerSegments } from "../composer-editor-mentions";
const context = {
  path: "src/My File.ts",
  cwd: "/project",
  kind: "file" as const,
  environmentId: null,
};
describe("workspace file context", () => {
  it("produces real composer mentions, including spaces and escaped quotes", () => {
    for (const path of ["src/code.ts", "src/My File.ts", 'src/My "File".ts']) {
      const token = workspaceFileMention({ ...context, path }, "/project/");
      expect(splitPromptIntoComposerSegments(token)[0]).toEqual(
        expect.objectContaining({ type: "mention", path }),
      );
    }
    expect(workspaceFileMention({ ...context, path: "src", kind: "directory" }, "/project")).toBe(
      '@"src/" ',
    );
  });
  it("uses absolute paths for another workspace and preserves Windows paths", () => {
    expect(workspaceFileMention({ ...context, path: "src/code.ts" }, "/other")).toBe(
      '@"/project/src/code.ts" ',
    );
    expect(absoluteWorkspacePath("C:\\project\\", "src/code.ts")).toBe("C:\\project\\src\\code.ts");
  });
  it("validates internal drags without accepting malformed or escaping paths", () => {
    expect(parseWorkspaceFileContext(JSON.stringify(context))).toEqual(context);
    for (const data of [
      null,
      { ...context, path: "../outside" },
      { ...context, path: "/absolute" },
      { ...context, path: "C:\\outside" },
      { ...context, path: "bad\npath" },
      { ...context, kind: "other" },
      { ...context, environmentId: 123 },
    ]) {
      expect(parseWorkspaceFileContext(JSON.stringify(data))).toBeNull();
    }
    expect(parseWorkspaceFileContext("not JSON")).toBeNull();
  });
});
