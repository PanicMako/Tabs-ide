import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

export interface ResetTabsUserDataOptions {
  readonly baseDir: string;
  readonly stateDir: string;
  readonly additionalStateDirs?: readonly string[];
  readonly electronProfileDirs: readonly string[];
  readonly homeDir?: string;
}

const PRESERVED_STATE_DIRECTORIES = new Set(["code-oss-main", "code-oss-desktop"]);

function isSameOrWithin(candidate: string, parent: string): boolean {
  const relative = Path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${Path.sep}`) && relative !== "..");
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrWithin(left, right) || isSameOrWithin(right, left);
}

function resolveExistingDirectory(path: string, label: string): string {
  const absolute = Path.resolve(path);
  if (!FS.existsSync(absolute)) return resolveForOverlapCheck(absolute);
  let stats: FS.Stats;
  try {
    stats = FS.statSync(absolute);
  } catch (error) {
    throw new Error(`Cannot inspect ${label}: ${error instanceof Error ? error.message : error}`);
  }
  if (!stats.isDirectory()) throw new Error(`Cannot reset Tabs data: ${label} is not a directory.`);
  return FS.realpathSync(absolute);
}

function resolveForOverlapCheck(path: string): string {
  const absolute = Path.resolve(path);
  if (FS.existsSync(absolute)) return FS.realpathSync(absolute);

  const missingParts: string[] = [];
  let existingParent = absolute;
  while (!FS.existsSync(existingParent)) {
    const parent = Path.dirname(existingParent);
    if (parent === existingParent) return absolute;
    missingParts.unshift(Path.basename(existingParent));
    existingParent = parent;
  }
  return Path.resolve(FS.realpathSync(existingParent), ...missingParts);
}

function assertSafeResetTargets(options: ResetTabsUserDataOptions): {
  stateDir: string;
  additionalStateDirs: string[];
  profileDirs: string[];
  reviewTargets: string[];
} {
  const baseDir = resolveForOverlapCheck(options.baseDir);
  const stateDir = resolveExistingDirectory(options.stateDir, "Tabs state directory");
  const additionalStateDirs = (options.additionalStateDirs ?? []).map((path) =>
    resolveExistingDirectory(path, "additional Tabs state directory"),
  );
  const profileDirs = options.electronProfileDirs.map((path) =>
    resolveExistingDirectory(path, "Electron user-data profile"),
  );
  const homeDir = resolveForOverlapCheck(options.homeDir ?? OS.homedir());
  const reviewBase = Path.join(baseDir, "dev");
  const reviewTargets = [
    Path.join(reviewBase, "review_state"),
    Path.join(reviewBase, "review_history"),
    Path.join(reviewBase, "feedback_store.json"),
  ].map(resolveForOverlapCheck);

  if (baseDir === Path.parse(baseDir).root || baseDir === homeDir) {
    throw new Error(`Cannot reset Tabs data: refusing to use base directory ${baseDir}.`);
  }
  if (!isSameOrWithin(stateDir, baseDir) || stateDir === baseDir) {
    throw new Error("Cannot reset Tabs data: state directory must stay inside the Tabs data root.");
  }
  for (const additionalStateDir of additionalStateDirs) {
    if (!isSameOrWithin(additionalStateDir, baseDir) || additionalStateDir === baseDir) {
      throw new Error(
        "Cannot reset Tabs data: additional state directories must stay inside the Tabs data root.",
      );
    }
  }
  if (reviewTargets.some((path) => !isSameOrWithin(path, baseDir))) {
    throw new Error("Cannot reset Tabs data: review state resolves outside the Tabs data root.");
  }

  for (const [label, path] of [
    ["Tabs state directory", stateDir],
    ...additionalStateDirs.map((path, index) => [
      `additional Tabs state directory ${index + 1}`,
      path,
    ]),
    ...profileDirs.map((path, index) => [`Electron user-data profile ${index + 1}`, path]),
  ] as const) {
    if (path === Path.parse(path).root || path === homeDir) {
      throw new Error(`Cannot reset Tabs data: refusing to clear ${label} at ${path}.`);
    }
  }

  const protectedRoots = [
    Path.join(baseDir, "code-oss-runtime"),
    Path.join(baseDir, "worktrees"),
    Path.join(stateDir, "code-oss-main"),
    Path.join(stateDir, "code-oss-desktop"),
  ].map(resolveForOverlapCheck);

  for (const protectedRoot of protectedRoots.slice(0, 2)) {
    if (pathsOverlap(stateDir, protectedRoot)) {
      throw new Error(
        `Cannot reset Tabs data: state directory ${stateDir} overlaps preserved files.`,
      );
    }
  }

  for (let index = 0; index < additionalStateDirs.length; index += 1) {
    const additionalStateDir = additionalStateDirs[index]!;
    if (pathsOverlap(additionalStateDir, stateDir)) {
      if (additionalStateDir === stateDir) continue;
      throw new Error("Cannot reset Tabs data: active state directories overlap.");
    }
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      if (pathsOverlap(additionalStateDir, additionalStateDirs[otherIndex]!)) {
        if (additionalStateDir === additionalStateDirs[otherIndex]) continue;
        throw new Error("Cannot reset Tabs data: additional state directories overlap.");
      }
    }
    for (const protectedRoot of protectedRoots) {
      if (pathsOverlap(additionalStateDir, protectedRoot)) {
        throw new Error(
          `Cannot reset Tabs data: additional state directory ${additionalStateDir} overlaps preserved data.`,
        );
      }
    }
    for (const profileDir of profileDirs) {
      if (pathsOverlap(additionalStateDir, profileDir)) {
        throw new Error(
          "Cannot reset Tabs data: additional state directory overlaps an Electron profile.",
        );
      }
    }
  }

  for (let index = 0; index < profileDirs.length; index += 1) {
    const profileDir = profileDirs[index]!;
    if (pathsOverlap(profileDir, stateDir)) {
      throw new Error(
        `Cannot reset Tabs data: Electron profile ${profileDir} overlaps the Tabs state directory.`,
      );
    }
    for (const protectedRoot of protectedRoots) {
      if (pathsOverlap(profileDir, protectedRoot)) {
        throw new Error(
          `Cannot reset Tabs data: Electron profile ${profileDir} overlaps preserved data.`,
        );
      }
    }
  }

  for (const reviewTarget of reviewTargets) {
    for (const protectedRoot of protectedRoots) {
      if (pathsOverlap(reviewTarget, protectedRoot)) {
        throw new Error("Cannot reset Tabs data: review data overlaps preserved editor data.");
      }
    }
    for (const profileDir of profileDirs) {
      if (pathsOverlap(reviewTarget, profileDir)) {
        throw new Error("Cannot reset Tabs data: review data overlaps an Electron profile.");
      }
    }
  }

  return {
    stateDir,
    additionalStateDirs: [...new Set(additionalStateDirs)].filter((path) => path !== stateDir),
    profileDirs: [...new Set(profileDirs)],
    reviewTargets: [...new Set(reviewTargets)],
  };
}

function clearDirectoryContents(directory: string, preserveStateData = false): void {
  if (!FS.existsSync(directory)) return;
  for (const entry of FS.readdirSync(directory, { withFileTypes: true })) {
    if (preserveStateData && PRESERVED_STATE_DIRECTORIES.has(entry.name)) {
      continue;
    }
    // rmSync removes a symlink itself and does not traverse its target.
    FS.rmSync(Path.join(directory, entry.name), { recursive: true, force: true });
  }
}

/**
 * Clears Tabs-owned state after a graceful app shutdown. Project/worktree files,
 * the downloaded Code OSS runtime, and the embedded editor's state are kept.
 * All reset roots are checked before the first deletion so path collisions fail
 * without partially clearing data.
 */
export function resetTabsUserData(options: ResetTabsUserDataOptions): void {
  const targets = assertSafeResetTargets(options);
  clearDirectoryContents(targets.stateDir, true);
  for (const stateDir of targets.additionalStateDirs) clearDirectoryContents(stateDir);
  for (const profileDir of targets.profileDirs) clearDirectoryContents(profileDir);
  for (const reviewTarget of targets.reviewTargets) {
    FS.rmSync(reviewTarget, { recursive: true, force: true });
  }
}
