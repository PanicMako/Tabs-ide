import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type DesktopUpdatePlatform,
  verifyDesktopUpdateArtifact,
} from "./lib/desktop-update-artifact.ts";

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index]?.trim();
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

async function main(): Promise<void> {
  const assetDirectory = resolve(requiredArgument(2, "asset directory"));
  const platform = requiredArgument(3, "platform");
  if (platform !== "linux" && platform !== "win") {
    throw new Error(`Unsupported platform ${platform}; expected linux or win.`);
  }
  const version = requiredArgument(4, "version");
  const result = await verifyDesktopUpdateArtifact(
    assetDirectory,
    platform as DesktopUpdatePlatform,
    version,
  );
  console.info(`Verified ${platform} update artifact: ${result.artifactPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
