import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "PanicMako/Tabs-ide";
const DAY = 86_400_000;
const CACHE_NAME = /^[a-f0-9]{16}(?:\.tar\.zst|-(?:meta|manifest)\.json(?:\.tmp)?)$/;
const INSTALLER_NAME =
  /^Tabs-(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)-(?:arm64|x64|universal|x86_64)\.(?:dmg|zip|exe|AppImage)$/;
const DIRECTORIES = [
  [".turbo/cache", "cache"],
  ["tabs-app/.turbo/cache", "cache"],
  ["tabs-main/.turbo/cache", "cache"],
  ["tabs-app/release", "installer"],
  ["tabs-main/release", "installer"],
] as const;

type Release = {
  tag_name: string;
  draft: boolean;
  published_at: string | null;
  assets: Array<{ name: string; size: number; digest?: string | null }>;
};
type Candidate = {
  file: string;
  size: number;
  mtime: number;
  inode: number;
  kind: "cache" | "installer";
  digest?: string;
};

export function installerVersion(name: string): string | null {
  return INSTALLER_NAME.exec(name)?.[1] ?? null;
}

export function publishedDigest(
  name: string,
  size: number,
  release: Release | null,
  latestTag: string | null,
): string | null {
  const version = installerVersion(name);
  if (!version || !release || !latestTag || release.tag_name === latestTag) return null;
  if (release.draft || !release.published_at || release.tag_name !== `v${version}`) return null;
  const asset = release.assets.find((entry) => entry.name === name && entry.size === size);
  return asset?.digest && /^sha256:[a-f0-9]{64}$/.test(asset.digest) ? asset.digest : null;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
function github(endpoint: string): Release | null {
  try {
    return JSON.parse(
      execFileSync("gh", ["api", `repos/${REPOSITORY}/${endpoint}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15_000,
      }),
    ) as Release;
  } catch {
    return null;
  }
}

export async function scanDirectory(
  root: string,
  relative: string,
  kind: Candidate["kind"],
  cutoff: number,
  verifyInstaller: (name: string, size: number) => string | null,
  isIgnored: (relative: string) => boolean,
): Promise<Candidate[]> {
  const directory = path.join(root, relative);
  // Refuse symlinked directories, including symlinked parents outside the worktree.
  if ((await realpath(directory).catch(() => null)) !== directory) return [];
  const result: Candidate[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (kind === "cache" ? !CACHE_NAME.test(entry.name) : !installerVersion(entry.name)) continue;
    const file = path.join(directory, entry.name);
    const stat = await lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.mtimeMs > cutoff || !isIgnored(path.relative(root, file))) continue;
    const digest = kind === "installer" ? verifyInstaller(entry.name, stat.size) : null;
    if (kind === "installer" && !digest) continue;
    result.push({
      file,
      size: stat.size,
      mtime: stat.mtimeMs,
      inode: stat.ino,
      kind,
      ...(digest ? { digest } : {}),
    });
  }
  return result;
}

export async function removeCandidate(candidate: Candidate): Promise<boolean> {
  const unchanged = async () => {
    const stat = await lstat(candidate.file).catch(() => null);
    return (
      stat?.isFile() &&
      stat.size === candidate.size &&
      stat.mtimeMs === candidate.mtime &&
      stat.ino === candidate.inode
    );
  };
  if (!(await unchanged())) return false;
  if (candidate.kind === "installer") {
    if (!candidate.digest) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(candidate.file)) hash.update(chunk);
    if (`sha256:${hash.digest("hex")}` !== candidate.digest) return false;
  }
  if (!(await unchanged())) return false;
  await unlink(candidate.file);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !/^--days=\d+$/.test(arg))) {
    throw new Error("Usage: bun scripts/storage-maintenance.ts [--apply] [--days=7]");
  }
  const days = Number(args.find((arg) => arg.startsWith("--days="))?.slice(7) ?? 7);
  if (!Number.isSafeInteger(days) || days < 1) throw new Error("--days must be a positive integer");
  const apply = args.includes("--apply");
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const roots = git(cwd, ["worktree", "list", "--porcelain", "-z"])
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice(9));
  const latest = github("releases/latest");
  const releases = new Map<string, Release | null>();
  console.log(
    `${apply ? "APPLY" : "PREVIEW"}: ignored cache files and verified published installers older than ${days} days.`,
  );
  console.log(
    "Preserves the latest stable installer, unpublished artifacts, source, dependencies, worktrees and all app/user profiles.",
  );
  if (!latest) console.log("GitHub verification unavailable; all installers will be preserved.");
  let planned = 0,
    removed = 0,
    count = 0;
  for (const worktree of roots) {
    const root = await realpath(worktree).catch(() => null);
    if (!root) continue;
    for (const [relative, kind] of DIRECTORIES) {
      const candidates = await scanDirectory(
        root,
        relative,
        kind,
        Date.now() - days * DAY,
        (name, size) => {
          const version = installerVersion(name)!;
          if (!releases.has(version))
            releases.set(version, latest ? github(`releases/tags/v${version}`) : null);
          return publishedDigest(
            name,
            size,
            releases.get(version) ?? null,
            latest?.tag_name ?? null,
          );
        },
        (file) => {
          try {
            git(root, ["check-ignore", "--quiet", "--", file]);
            return true;
          } catch {
            return false;
          }
        },
      );
      for (const candidate of candidates) {
        planned += candidate.size;
        if (apply && !(await removeCandidate(candidate))) {
          console.log(`SKIP (changed or digest mismatch): ${candidate.file}`);
          continue;
        }
        if (apply) removed += candidate.size;
        count++;
        console.log(
          `${apply ? "REMOVED" : "CANDIDATE"} ${(candidate.size / 1e9).toFixed(2)} GB ${candidate.file}`,
        );
      }
    }
  }
  const disk = await statfs(cwd);
  console.log(
    `${count} files; ${((apply ? removed : planned) / 1e9).toFixed(2)} GB ${apply ? "removed" : "eligible (installer hashes verified before deletion)"}.`,
  );
  console.log(
    `Available now: ${((disk.bavail * disk.bsize) / 2 ** 30).toFixed(1)} GiB. APFS sharing can make reclaimed space differ from file sizes.`,
  );
  if (!apply) console.log("Preview only. Run bun run storage:clean to apply these checks.");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
