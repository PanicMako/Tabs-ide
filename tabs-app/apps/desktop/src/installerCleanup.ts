import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export function installedMacApplication(
  platform: string,
  packaged: boolean,
  executable: string,
  home: string,
): boolean {
  if (platform !== "darwin" || !packaged) return false;
  return ["/Applications", path.join(home, "Applications")].some(
    (directory) => executable === path.join(directory, "Tabs.app/Contents/MacOS/Tabs"),
  );
}

export function installerFilename(version: string, arch: string): string | null {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(version) || !["arm64", "x64"].includes(arch))
    return null;
  return `Tabs-${version}-${arch}.dmg`;
}

export async function findDownloadedInstaller(downloads: string, version: string, arch: string) {
  const name = installerFilename(version, arch);
  if (!name) return null;
  const directory = await realpath(downloads).catch(() => null);
  if (!directory) return null;
  const file = path.join(directory, name);
  const stat = await lstat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  return { name, file, size: stat.size, mtime: stat.mtimeMs, inode: stat.ino };
}

// Both endpoints are fixed by the main process. Renderer input never becomes a path or URL.
export async function trashVerifiedInstaller(input: {
  downloads: string;
  version: string;
  arch: string;
  fetchRelease: (version: string) => Promise<unknown>;
  trash: (file: string) => Promise<void>;
}): Promise<void> {
  const candidate = await findDownloadedInstaller(input.downloads, input.version, input.arch);
  if (!candidate) throw new Error("The downloaded installer is no longer available.");
  const release = (await input.fetchRelease(input.version)) as {
    tag_name?: string;
    draft?: boolean;
    published_at?: string;
    assets?: Array<{ name: string; size: number; digest?: string }>;
  } | null;
  const asset = release?.assets?.find(
    (entry) => entry.name === candidate.name && entry.size === candidate.size,
  );
  if (
    release?.tag_name !== `v${input.version}` ||
    release.draft !== false ||
    !release.published_at ||
    !asset?.digest ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
  ) {
    throw new Error(
      "The published installer could not be verified. Keep it or remove it manually in Finder.",
    );
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(candidate.file)) hash.update(chunk);
  const current = await lstat(candidate.file);
  if (
    !current.isFile() ||
    current.ino !== candidate.inode ||
    current.size !== candidate.size ||
    current.mtimeMs !== candidate.mtime ||
    `sha256:${hash.digest("hex")}` !== asset.digest
  ) {
    throw new Error("The installer changed or does not match the published download. It was kept.");
  }
  await input.trash(candidate.file);
}
