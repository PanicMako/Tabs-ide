import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  makeFileOvermindPlanStore,
  makeOvermindWorkspaceHost,
  type OvermindWorktreeCreator,
} from "./OvermindWorkspace.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "overmind-ws-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  const creator: OvermindWorktreeCreator = {
    createWorktree: ({ cwd, refName, newRefName }) =>
      Effect.try(() => {
        const path = join(root, newRefName.replaceAll("/", "_"));
        git(cwd, "worktree", "add", "-q", "-b", newRefName, path, refName);
        return { worktree: { path, refName: newRefName } };
      }),
    removeWorktree: ({ cwd, path }) =>
      Effect.try(() => void git(cwd, "worktree", "remove", "--force", path)),
  };
  return { root, repo, host: makeOvermindWorkspaceHost({ leadCwd: repo, git: creator }) };
}

describe("OvermindWorkspaceHost with real git", () => {
  it.effect("isolates a task, commits leftovers, merges back and cleans up", () =>
    Effect.gen(function* () {
      const { root, repo, host } = makeRepo();
      try {
        const ws = yield* host.provision({ planId: "p", taskId: "t", attempt: 1 });
        assert.isNotNull(ws);
        writeFileSync(join(ws!.path, "new.txt"), "from task\n");
        assert.isFalse(existsSync(join(repo, "new.txt"))); // isolated until merged
        const merged = yield* host.integrate(ws!, "Add new");
        assert.isTrue(merged.ok);
        assert.equal(readFileSync(join(repo, "new.txt"), "utf8"), "from task\n");
        yield* host.discard(ws!);
        assert.isFalse(existsSync(ws!.path));
        assert.notInclude(git(repo, "branch", "--list"), "overmind/");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("aborts a conflicting merge and leaves the lead checkout clean", () =>
    Effect.gen(function* () {
      const { root, repo, host } = makeRepo();
      try {
        const a = yield* host.provision({ planId: "p", taskId: "a", attempt: 1 });
        const b = yield* host.provision({ planId: "p", taskId: "b", attempt: 1 });
        writeFileSync(join(a!.path, "a.txt"), "from a\n");
        writeFileSync(join(b!.path, "a.txt"), "from b\n");
        assert.isTrue((yield* host.integrate(a!, "A")).ok);
        const conflict = yield* host.integrate(b!, "B");
        assert.isFalse(conflict.ok);
        assert.equal(git(repo, "status", "--porcelain").trim(), "");
        assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "from a\n");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it.effect("reports an uncommitted lead checkout and falls back outside a repository", () =>
    Effect.gen(function* () {
      const { root, repo, host } = makeRepo();
      try {
        assert.isFalse(yield* host.leadIsDirty);
        writeFileSync(join(repo, "dirty.txt"), "x");
        assert.isTrue(yield* host.leadIsDirty);
        const outside = makeOvermindWorkspaceHost({
          leadCwd: root,
          git: { createWorktree: () => Effect.die("unused"), removeWorktree: () => Effect.void },
        });
        assert.isNull(yield* outside.provision({ planId: "p", taskId: "t", attempt: 1 }));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );
});

describe("file plan store", () => {
  it("round-trips a plan and ignores corrupt files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "overmind-store-"));
    try {
      const store = makeFileOvermindPlanStore(join(dir, "nested"));
      assert.isNull(await store.load("ns:thread:plan"));
      const plan = {
        goal: "g",
        isolate: true,
        tasks: [],
        models: [],
        limits: {},
        states: [],
        leadCwd: null,
      };
      await store.save("ns:thread:plan", plan);
      assert.deepEqual(await store.load("ns:thread:plan"), plan);
      writeFileSync(join(dir, "nested", "bad_key.json"), "{nope");
      assert.isNull(await store.load("bad:key"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
