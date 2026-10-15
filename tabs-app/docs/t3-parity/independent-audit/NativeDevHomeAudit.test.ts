import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import * as Os from "node:os";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveGitWorktreePath, resolveWorktreeT3Home } from "./devHome.ts";
it("detects actual Git-created worktree from nested cwd and isolates its data home", async () => {
  const root = await Fs.mkdtemp(Path.join(Os.tmpdir(), "tabs-native-devhome-"));
  const repo = Path.join(root, "repo"),
    worktree = Path.join(root, "linked");
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      stdio: "pipe",
    });
  try {
    await Fs.mkdir(repo);
    git(["init"]);
    git([
      "-c",
      "user.name=Audit",
      "-c",
      "user.email=audit@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ]);
    git(["worktree", "add", "--detach", worktree, "HEAD"]);
    const nested = Path.join(worktree, "deep", "folder");
    await Fs.mkdir(nested, { recursive: true });
    expect(
      await Effect.runPromise(
        resolveGitWorktreePath(nested).pipe(Effect.provide(NodeServices.layer)),
      ),
    ).toBe(worktree);
    expect(
      await Effect.runPromise(
        resolveWorktreeT3Home(nested).pipe(Effect.provide(NodeServices.layer)),
      ),
    ).toBe(Path.join(worktree, ".t3"));
    expect(
      await Effect.runPromise(
        resolveGitWorktreePath(repo).pipe(Effect.provide(NodeServices.layer)),
      ),
    ).toBeUndefined();
  } finally {
    await Fs.rm(root, { recursive: true, force: true });
  }
});
