import { it, expect } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import * as Fs from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import { parseDiffFileRevisions } from "./bitbucketDiffRevisions.ts";
it("reads actual Git blob revisions for unusual filenames with either quotePath setting", async () => {
  const root = await Fs.mkdtemp(Path.join(Os.tmpdir(), "tabs-native-patch-audit-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "-q");
    const names = [
      "with space.txt",
      "tab\tname.txt",
      "line\nname.txt",
      "back\\slash.txt",
      "café-🚀.txt",
      'quote"name.txt',
    ];
    for (const name of names) await Fs.writeFile(Path.join(root, name), "before\n");
    git("add", "--all");
    git(
      "-c",
      "user.name=Audit",
      "-c",
      "user.email=audit@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    for (const name of names) await Fs.writeFile(Path.join(root, name), "after\n");
    const expected = names.map((name) => [name, git("hash-object", "--", name).trim()]);
    for (const quotePath of ["true", "false"]) {
      const revisions = parseDiffFileRevisions(
        git("-c", `core.quotePath=${quotePath}`, "diff", "--full-index"),
      );
      expect([...revisions].sort()).toEqual(expected.sort());
    }
  } finally {
    await Fs.rm(root, { recursive: true, force: true });
  }
});
