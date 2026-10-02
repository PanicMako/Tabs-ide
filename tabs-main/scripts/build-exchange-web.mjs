import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { preserveDeveloperReleases } from "./developer-release-archive.mjs";

const repository = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "..");
const exchange = Path.join(repository, "apps/exchange");
const archive = Path.join(exchange, "developer-releases");
const output = Path.join(exchange, "frontend/dist/developers/releases");
preserveDeveloperReleases(output, archive);
execFileSync("bun", ["x", "--no-install", "astro", "build", "--root", "frontend"], {
  cwd: exchange,
  stdio: "inherit",
});
execFileSync("bun", [Path.join(repository, "scripts/build-extension-developer-release.mjs")], {
  cwd: repository,
  stdio: "inherit",
});
preserveDeveloperReleases(output, archive);
preserveDeveloperReleases(archive, output);
