import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

export type DesktopUpdatePlatform = "linux" | "win";

interface UpdateFileEntry {
  readonly url: string;
  readonly sha512: string;
  readonly size: number;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readScalar(manifest: string, key: string): string | null {
  const match = manifest.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return match?.[1] ? unquote(match[1]) : null;
}

export function parseUpdateFileEntries(manifest: string): readonly UpdateFileEntry[] {
  const entries: UpdateFileEntry[] = [];
  const lines = manifest.replace(/\r\n?/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const urlMatch = lines[index]?.match(/^\s*-\s+url:\s*(.+?)\s*$/);
    if (!urlMatch?.[1]) continue;

    let sha512: string | null = null;
    let size: number | null = null;
    for (let detailIndex = index + 1; detailIndex < lines.length; detailIndex += 1) {
      const detail = lines[detailIndex] ?? "";
      if (/^\s*-\s+url:/.test(detail) || (/^\S/.test(detail) && detail.trim())) break;
      const shaMatch = detail.match(/^\s+sha512:\s*(.+?)\s*$/);
      if (shaMatch?.[1]) sha512 = unquote(shaMatch[1]);
      const sizeMatch = detail.match(/^\s+size:\s*(\d+)\s*$/);
      if (sizeMatch?.[1]) size = Number(sizeMatch[1]);
    }
    if (!sha512 || size === null) {
      throw new Error(`Update metadata entry ${unquote(urlMatch[1])} is missing sha512 or size.`);
    }
    entries.push({ url: unquote(urlMatch[1]), sha512, size });
  }

  return entries;
}

function sha512File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("base64")));
  });
}

function readHeader(path: string, length: number): Buffer {
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(length);
    const bytesRead = readSync(file, header, 0, length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    closeSync(file);
  }
}

export async function verifyDesktopUpdateArtifact(
  assetDirectory: string,
  platform: DesktopUpdatePlatform,
  expectedVersion: string,
): Promise<{ readonly artifactPath: string; readonly manifestPath: string }> {
  const manifestName = platform === "linux" ? "latest-linux.yml" : "latest.yml";
  const manifestPath = resolve(assetDirectory, manifestName);
  const manifest = readFileSync(manifestPath, "utf8");
  const version = readScalar(manifest, "version");
  if (version !== expectedVersion) {
    throw new Error(
      `${manifestName} has version ${version ?? "<missing>"}; expected ${expectedVersion}.`,
    );
  }

  const expectedExtension = platform === "linux" ? ".AppImage" : ".exe";
  const entries = parseUpdateFileEntries(manifest);
  const entry = entries.find(({ url }) => url.endsWith(expectedExtension));
  if (!entry)
    throw new Error(`${manifestName} does not reference a ${expectedExtension} update artifact.`);

  const pathEntry = readScalar(manifest, "path");
  if (pathEntry && basename(pathEntry) !== basename(entry.url)) {
    throw new Error(`${manifestName} path does not match its ${expectedExtension} file entry.`);
  }

  const artifactPath = resolve(assetDirectory, basename(entry.url));
  const stat = statSync(artifactPath);
  if (!stat.isFile()) throw new Error(`${entry.url} is not a regular file.`);
  if (stat.size !== entry.size) {
    throw new Error(`${entry.url} has size ${stat.size}; update metadata declares ${entry.size}.`);
  }

  const sha512 = await sha512File(artifactPath);
  if (sha512 !== entry.sha512)
    throw new Error(`${entry.url} does not match its update metadata sha512.`);

  const header = readHeader(artifactPath, 4);
  if (platform === "linux") {
    if (header[0] !== 0x7f || header.subarray(1, 4).toString("ascii") !== "ELF") {
      throw new Error(`${entry.url} is not an ELF AppImage.`);
    }
    if ((stat.mode & 0o111) === 0) throw new Error(`${entry.url} is not executable.`);
  } else {
    if (header.subarray(0, 2).toString("ascii") !== "MZ") {
      throw new Error(`${entry.url} is not a Windows PE executable.`);
    }
    statSync(`${artifactPath}.blockmap`);
  }

  return { artifactPath, manifestPath };
}
