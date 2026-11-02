import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import {
  cleanStorage,
  inspectStorage,
  inspectWorktrees,
  parseWorktrees,
} from "./workspaceMaintenance";

const directories: string[] = [];
const fixture = async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "tabs-maintenance-test-")));
  directories.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
const old = async (file: string) => {
  const date = new Date(Date.now() - 10 * 86_400_000);
  await fs.utimes(file, date, date);
};

describe("application storage safety", () => {
  it("reports real bytes, removes only aged rotated logs, and retains current logs and browser exports", async () => {
    const root = await fixture();
    const logs = path.join(root, "logs"),
      browser = path.join(root, "browser");
    await fs.mkdir(logs);
    await fs.mkdir(browser);
    await fs.writeFile(path.join(logs, "server.log.1"), "old log");
    await old(path.join(logs, "server.log.1"));
    await fs.writeFile(path.join(logs, "server.log"), "current");
    await old(path.join(logs, "server.log"));
    await fs.writeFile(path.join(logs, "server.log.2"), "recent");
    await fs.writeFile(path.join(browser, "screenshot.png"), "export");
    await old(path.join(browser, "screenshot.png"));
    const roots = { logs, "browser-artifacts": browser };
    const { inventory } = await inspectStorage(roots);
    expect(inventory.totalBytes).toBe(26);
    expect(inventory.reclaimableBytes).toBe(7);
    expect(inventory.candidates.map((c) => c.name)).toEqual(["server.log.1"]);
    const result = await cleanStorage(roots, [inventory.candidates[0]!.id]);
    expect(result).toEqual({ deletedBytes: 7, deletedCount: 1, errors: [] });
    expect(await fs.readFile(path.join(logs, "server.log"), "utf8")).toBe("current");
    expect(await fs.readFile(path.join(browser, "screenshot.png"), "utf8")).toBe("export");
  });
  it("rejects stale identities, duplicate tokens and arbitrary paths", async () => {
    const root = await fixture();
    const file = path.join(root, "events.ndjson.1");
    await fs.writeFile(file, "old");
    await old(file);
    const roots = { logs: root, "browser-artifacts": path.join(root, "missing") };
    const { inventory } = await inspectStorage(roots);
    const id = inventory.candidates[0]!.id;
    await fs.writeFile(file, "new contents");
    const result = await cleanStorage(roots, [id, id, "../../project"]);
    expect(result.deletedCount).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(await fs.readFile(file, "utf8")).toBe("new contents");
  });
  it("does not traverse symlinks or remove hardlinks", async () => {
    const root = await fixture();
    const outside = await fixture();
    const external = path.join(outside, "secret.log.1");
    await fs.writeFile(external, "secret");
    await old(external);
    await fs.symlink(outside, path.join(root, "linked"));
    await fs.link(external, path.join(root, "hard.log.1"));
    const { inventory } = await inspectStorage({
      logs: root,
      "browser-artifacts": path.join(root, "missing"),
    });
    expect(inventory.candidates).toEqual([]);
    const linkedRoot = await inspectStorage({
      logs: path.join(root, "linked"),
      "browser-artifacts": path.join(root, "missing"),
    });
    expect(linkedRoot.inventory.warnings).toHaveLength(1);
    expect(await fs.readFile(external, "utf8")).toBe("secret");
  });
});

describe("Git worktree inspection", () => {
  it("parses null delimited paths including spaces, newlines, detached heads and locks", () => {
    const list = parseWorktrees(
      "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /repo/task\nname\0HEAD def\0detached\0locked busy\0\0",
    );
    expect(list[0]).toMatchObject({ main: true, branch: "main" });
    expect(list[1]).toMatchObject({
      path: "/repo/task\nname",
      main: false,
      branch: null,
      locked: true,
    });
  });
  it("detects dirty and ignored files even with hidden untracked configuration, and protects nested task roots", async () => {
    const root = await fixture(),
      repo = path.join(root, "repo"),
      tree = path.join(root, "task");
    await fs.mkdir(repo);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    git("init", "-b", "main");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    );
    git("worktree", "add", "-b", "task", tree);
    git("config", "status.showUntrackedFiles", "no");
    await fs.writeFile(path.join(tree, "untracked.txt"), "retain");
    await fs.writeFile(path.join(tree, ".gitignore"), "secret\n");
    await fs.writeFile(path.join(tree, "secret"), "retain");
    const inventory = await inspectWorktrees(repo, [path.join(tree, "nested")], [tree]);
    expect(inventory.find((t) => t.path === tree)).toMatchObject({
      dirty: true,
      ignored: true,
      protected: true,
      threadCount: 1,
      main: false,
    });
    expect(inventory.find((t) => t.path === repo)?.main).toBe(true);
  });
});
