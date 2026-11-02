import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ManagedWorktree, StorageInventory, StorageCleanResult } from "@tabs/contracts";

const run = promisify(execFile);
const DAY = 86_400_000;
const git = async (cwd: string, args: string[]) =>
  (
    await run("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    })
  ).stdout;

export type StorageRoots = { logs: string; "browser-artifacts": string };
const candidateId = (file: string, stat: { size: number; mtimeMs: number; ino: number }) =>
  createHash("sha256").update(`${file}\0${stat.ino}\0${stat.size}\0${stat.mtimeMs}`).digest("hex");

/** Only rotated logs and old completed browser exports are disposable. No project traversal. */
export async function inspectStorage(roots: StorageRoots, now = Date.now()) {
  const inventory: {
    totalBytes: number;
    reclaimableBytes: number;
    candidates: StorageInventory["candidates"][number][];
    warnings: string[];
  } = {
    totalBytes: 0,
    reclaimableBytes: 0,
    candidates: [],
    warnings: [],
  };
  const files = new Map<string, string>();
  let visited = 0;
  for (const category of ["logs", "browser-artifacts"] as const) {
    const root = path.resolve(roots[category]);
    try {
      if ((await fs.realpath(root)) !== root || !(await fs.lstat(root)).isDirectory()) {
        inventory.warnings.push(`Skipped linked storage root: ${category}`);
        continue;
      }
      const visit = async (directory: string): Promise<void> => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (++visited > 20_000) throw new Error("Storage scan reached its 20,000 entry limit.");
          const target = path.join(directory, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            await visit(target);
            continue;
          }
          if (!entry.isFile()) continue;
          const stat = await fs.lstat(target);
          if (!stat.isFile() || stat.nlink !== 1) continue;
          inventory.totalBytes += stat.size;
          const eligible = category === "logs" ? /\.(?:log|ndjson)\.\d+$/.test(entry.name) : false;
          // Browser exports may still be referenced by conversations. Inventory them, retain them.
          if (!eligible || stat.mtimeMs > now - 7 * DAY) continue;
          const id = candidateId(target, stat);
          inventory.candidates.push({
            id,
            category,
            name: path.relative(root, target),
            bytes: stat.size,
            modifiedAt: stat.mtimeMs,
          });
          inventory.reclaimableBytes += stat.size;
          files.set(id, target);
        }
      };
      await visit(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        inventory.warnings.push(`${category}: ${String(error)}`);
    }
  }
  return { inventory, files };
}

/** Tokens bind cleanup to exact files. Revalidate identity and every parent just before unlinking. */
export async function cleanStorage(
  roots: StorageRoots,
  ids: readonly string[],
): Promise<StorageCleanResult> {
  if (ids.length > 20_000) throw new Error("Too many cleanup candidates.");
  const { inventory, files } = await inspectStorage(roots);
  const result = { deletedBytes: 0, deletedCount: 0, errors: [] as string[] };
  for (const id of new Set(ids)) {
    const target = files.get(id);
    const candidate = inventory.candidates.find((entry) => entry.id === id);
    if (!target || !candidate) {
      result.errors.push("Candidate changed or is no longer eligible. Refresh storage.");
      continue;
    }
    try {
      const stat = await fs.lstat(target);
      if (
        (await fs.realpath(target)) !== target ||
        !stat.isFile() ||
        stat.nlink !== 1 ||
        candidateId(target, stat) !== id
      )
        throw new Error("File changed during cleanup.");
      await fs.unlink(target);
      result.deletedCount++;
      result.deletedBytes += stat.size;
    } catch (error) {
      result.errors.push(`${candidate.name}: ${String(error)}`);
    }
  }
  return result;
}

export function parseWorktrees(
  output: string,
): Array<Pick<ManagedWorktree, "path" | "head" | "branch" | "main" | "locked" | "prunable">> {
  return output
    .split("\0\0")
    .filter(Boolean)
    .map((record, index) => {
      const fields = record.split("\0");
      const value = (prefix: string) =>
        fields.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? "";
      return {
        path: value("worktree "),
        head: value("HEAD "),
        branch: value("branch refs/heads/") || null,
        main: index === 0,
        locked: fields.some((line) => /^locked(?: |$)/.test(line)),
        prunable: fields.some((line) => /^prunable(?: |$)/.test(line)),
      };
    })
    .filter((entry) => entry.path !== "");
}

export async function inspectWorktrees(
  cwd: string,
  protectedPaths: readonly string[],
  threadPaths: readonly string[],
): Promise<readonly ManagedWorktree[]> {
  const entries = parseWorktrees(await git(cwd, ["worktree", "list", "--porcelain", "-z"]));
  const canonical = async (target: string) => fs.realpath(target).catch(() => path.resolve(target));
  const protectedRoots = await Promise.all(protectedPaths.map(canonical));
  const threads = await Promise.all(threadPaths.map(canonical));
  const inside = (parent: string, child: string) =>
    child === parent || child.startsWith(parent + path.sep);
  return Promise.all(
    entries.map(async (entry) => {
      const root = await canonical(entry.path);
      let dirty = true,
        ignored = true,
        error: string | null = null;
      try {
        if ((await fs.lstat(entry.path)).isSymbolicLink())
          throw new Error("Linked worktree paths cannot be removed.");
        dirty =
          (await git(entry.path, [
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--ignore-submodules=none",
          ])) !== "";
        ignored =
          (await git(entry.path, [
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "-z",
          ])) !== "";
      } catch (cause) {
        error = String(cause);
      }
      return {
        ...entry,
        dirty,
        ignored,
        error,
        protected: protectedRoots.some((p) => inside(root, p)),
        threadCount: threads.filter((p) => inside(root, p)).length,
      };
    }),
  );
}
