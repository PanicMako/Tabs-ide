import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MANIFEST_NAME = "tabs-mac-preview-update.json";
const SIGNATURE_NAME = `${MANIFEST_NAME}.sig`;

interface PreviewUpdateAsset {
  readonly name: string;
  readonly sha512: string;
  readonly size: number;
}

interface PreviewUpdateManifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly releaseDate: string;
  readonly repository: string;
  readonly releaseNotes: string;
  readonly assets: {
    readonly arm64: PreviewUpdateAsset;
    readonly x64: PreviewUpdateAsset;
  };
}

function requireArgument(index: number, name: string): string {
  const value = process.argv[index]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function createAsset(assetDirectory: string, version: string, arch: "arm64" | "x64") {
  const path = resolve(assetDirectory, `Tabs-${version}-${arch}.zip`);
  const contents = readFileSync(path);
  return {
    name: basename(path),
    sha512: createHash("sha512").update(contents).digest("base64"),
    size: statSync(path).size,
  } satisfies PreviewUpdateAsset;
}

function main(): void {
  const assetDirectory = resolve(requireArgument(2, "asset directory"));
  const version = requireArgument(3, "version");
  const repository = requireArgument(4, "repository");
  const releaseNotesPath = resolve(requireArgument(5, "release notes path"));
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }

  const privateKey = process.env.TABS_MAC_UPDATE_PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error("TABS_MAC_UPDATE_PRIVATE_KEY is required to sign the update manifest.");
  }

  const manifest: PreviewUpdateManifest = {
    schemaVersion: 1,
    version,
    releaseDate: new Date().toISOString(),
    repository,
    releaseNotes: readFileSync(releaseNotesPath, "utf8").trim(),
    assets: {
      arm64: createAsset(assetDirectory, version, "arm64"),
      x64: createAsset(assetDirectory, version, "x64"),
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const signature = sign(null, manifestBytes, createPrivateKey(privateKey)).toString("base64");

  writeFileSync(resolve(assetDirectory, MANIFEST_NAME), manifestBytes);
  writeFileSync(resolve(assetDirectory, SIGNATURE_NAME), `${signature}\n`, "utf8");
  console.info(`Created signed macOS preview update manifest for ${version}.`);
}

main();
