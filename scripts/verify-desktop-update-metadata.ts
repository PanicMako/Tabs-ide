import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function readBlockScalar(manifestText: string, key: string): string | null {
  const lines = manifestText.replace(/\r\n?/g, "\n").split("\n");
  const headerIndex = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*[>|][+-]?\\d*\\s*$`).test(line),
  );
  if (headerIndex < 0) return null;

  const body: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim() && !/^\s/.test(line)) break;
    body.push(line);
  }
  const indentation = body
    .filter((line) => line.trim())
    .reduce((minimum, line) => Math.min(minimum, line.match(/^\s*/)?.[0].length ?? 0), Infinity);
  if (!Number.isFinite(indentation) || indentation === 0) return null;
  return normalizeText(body.map((line) => line.slice(indentation)).join("\n"));
}

export function readReleaseNotes(manifestText: string): string | null {
  const quotedMatch = manifestText.match(/^releaseNotes:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
  if (quotedMatch && quotedMatch[1] !== undefined) {
    try {
      return normalizeText(JSON.parse(`"${quotedMatch[1]}"`) as string);
    } catch {
      return normalizeText(quotedMatch[1].replace(/\\r\\n|\\r|\\n/g, "\n").replace(/\\"/g, '"'));
    }
  }

  return readBlockScalar(manifestText, "releaseNotes");
}

export function verifyDesktopUpdateMetadata(
  manifestText: string,
  expectedVersion: string,
  expectedReleaseNotes: string,
  label: string,
): void {
  const version = manifestText.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
  if (version !== expectedVersion) {
    throw new Error(`${label} has version ${version ?? "<missing>"}; expected ${expectedVersion}.`);
  }
  const releaseNotes = readReleaseNotes(manifestText);
  if (releaseNotes !== normalizeText(expectedReleaseNotes)) {
    throw new Error(`${label} does not contain the exact release notes for ${expectedVersion}.`);
  }
}

function requireArgument(index: number, name: string): string {
  const value = process.argv[index]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function main(): void {
  const assetDirectory = resolve(requireArgument(2, "asset directory"));
  const version = requireArgument(3, "version");
  const releaseNotesPath = resolve(requireArgument(4, "release notes path"));
  const releaseNotes = readFileSync(releaseNotesPath, "utf8");

  for (const filename of ["latest.yml", "latest-linux.yml"]) {
    verifyDesktopUpdateMetadata(
      readFileSync(resolve(assetDirectory, filename), "utf8"),
      version,
      releaseNotes,
      basename(filename),
    );
  }
  console.info(`Verified desktop update release notes for ${version}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
