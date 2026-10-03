import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  discoverCursorSkills,
  hasCursorSkillMention,
  rewriteCursorSkillMentions,
} from "./CursorSkills.ts";

const writeSkill = Effect.fn(function* (
  skillsDir: string,
  directoryName: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDir = path.join(skillsDir, directoryName);
  yield* fs.makeDirectory(skillDir, { recursive: true });
  yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
});

describe("CursorSkills mentions", () => {
  it("detects skill mentions and rewrites them to /commands for Cursor", () => {
    const knownSkills = new Set(["review", "fix", "2spec"]);
    expect(hasCursorSkillMention("please run $review")).toBe(true);
    expect(hasCursorSkillMention("no mentions here")).toBe(false);

    expect(rewriteCursorSkillMentions("please $review this", knownSkills)).toBe(
      "please /review this",
    );
    expect(rewriteCursorSkillMentions("echo $HOME then $review", knownSkills)).toBe(
      "echo $HOME then /review",
    );
    expect(rewriteCursorSkillMentions("use $2spec here", knownSkills)).toBe("use /2spec here");
  });
});

it.layer(NodeServices.layer)("CursorSkills discovery", (it) => {
  it.effect("discovers project skills under .cursor/skills", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-cursor-skills-" });
      const workspace = path.join(tempDir, "workspace");

      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "audit-code",
        [
          "---",
          "name: audit-code",
          "description: Audit code quality",
          "disable-model-invocation: true",
          "---",
          "# Content",
        ].join("\n"),
      );

      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "internal-helper",
        [
          "---",
          "name: internal-helper",
          "description: Agent-only helper",
          "user-invocable: false",
          "---",
          "# Internal",
        ].join("\n"),
      );

      const resolvedWorkspace = yield* fs.realPath(workspace);
      const skills = yield* discoverCursorSkills(workspace, { HOME: tempDir });
      expect(skills).toEqual([
        {
          name: "audit-code",
          path: path.join(resolvedWorkspace, ".cursor", "skills", "audit-code", "SKILL.md"),
          scope: "project",
          enabled: true,
          description: "Audit code quality",
          userInvocationOnly: true,
        },
        {
          name: "internal-helper",
          path: path.join(resolvedWorkspace, ".cursor", "skills", "internal-helper", "SKILL.md"),
          scope: "project",
          enabled: true,
          description: "Agent-only helper",
          userInvocable: false,
        },
      ]);
    }),
  );
});
