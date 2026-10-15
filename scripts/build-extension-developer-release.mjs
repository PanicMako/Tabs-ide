import * as FS from "node:fs";
import * as Path from "node:path";
import * as OS from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { developerReleaseIdentity } from "./developer-release-identity.mjs";

const repository = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = Path.join(repository, "apps/exchange/frontend/dist/developers/releases");
const temporary = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-developer-release-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(command, args, cwd = repository) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "inherit"],
  });
}
function immutable(file, bytes) {
  try {
    FS.writeFileSync(file, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || !FS.readFileSync(file).equals(Buffer.from(bytes))) throw error;
  }
}
try {
  run("bun", ["run", "--cwd", "packages/extension-cli", "build"]);
  const packages = [];
  for (const name of ["extension-api", "extension-cli"]) {
    const result = JSON.parse(
      run(npm, [
        "pack",
        `--workspace=@tabs/${name}`,
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        temporary,
      ]),
    )[0];
    const bytes = FS.readFileSync(Path.join(temporary, result.filename));
    packages.push({
      name: `@tabs/${name}`,
      version: result.version,
      filename: result.filename,
      sha256: hash(bytes),
      bytes: bytes.length,
    });
  }
  const api = packages.find((entry) => entry.name === "@tabs/extension-api");
  const desktopVersion = JSON.parse(
    FS.readFileSync(Path.join(repository, "apps/desktop/package.json"), "utf8"),
  ).version;
  const release = developerReleaseIdentity(
    api.version,
    packages.map((entry) => entry.sha256),
    desktopVersion,
    JSON.stringify({
      source: FS.readFileSync(fileURLToPath(import.meta.url), "utf8"),
      // Node and Bun can produce different gzip bytes for the same tar input.
      // Immutable URLs must also identify the runtime/compression recipe.
      runtime: process.versions,
    }),
  );
  const manifest = {
    release,
    status: "experimental-staging",
    apiVersion: api.version,
    node: ">=22.12.0",
    desktop: {
      version: desktopVersion,
      channel: "development",
      platforms: ["macOS", "Windows", "Linux"],
      download: null,
      note: "Requires a compatible testing build; this bundle does not include or promise a released desktop installer.",
    },
    packages: packages.map((entry) => ({
      ...entry,
      url: `/developers/releases/${release}/${entry.filename}`,
    })),
  };
  const readme = `# Tabs extension developer bundle ${release}

Experimental staging tooling, not an npm publication or public desktop release.
Requires Node 22.12+ and a compatible Tabs ${desktopVersion} testing build.

Extract this bundle into a folder. In that folder, run:

    npm install -g --prefix ./tabs-toolchain ./${packages[1].filename}
    ./tabs-toolchain/bin/tabsext init my-tool --sdk "$PWD/${packages[0].filename}" --tabs-version ${desktopVersion}
    cd my-tool
    npm install
    npm run build
    ../tabs-toolchain/bin/tabsext validate
    ../tabs-toolchain/bin/tabsext pack

Initialization records the desktop target in .tabsext.json. Override it with --tabs-version when testing a different build. Output is readable by default; use --json for automation.

On Windows, prefix executables are tabs-toolchain\\tabsext.cmd rather than bin/tabsext. Pass an absolute SDK tarball path.

In the desktop testing app, open Settings > Extensions > Discover > Load development folder. Select my-tool/.tabs-extension, enable its tool in Installed, and select it from the project toolbar.

The starter requests no privileged capabilities. Review packages and keep secrets out of staging. Registry review and signed installation still apply to published extensions.

SHA256SUMS detects accidental corruption; checksums alone are not an independently authenticated trust root.
`;
  FS.writeFileSync(Path.join(temporary, "README.md"), readme);
  FS.writeFileSync(Path.join(temporary, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const names = [...packages.map((entry) => entry.filename), "README.md", "release.json"];
  FS.writeFileSync(
    Path.join(temporary, "SHA256SUMS"),
    names
      .map((name) => `${hash(FS.readFileSync(Path.join(temporary, name)))}  ${name}`)
      .join("\n") + "\n",
  );
  names.push("SHA256SUMS");
  for (const name of names) {
    FS.chmodSync(Path.join(temporary, name), 0o644);
    FS.utimesSync(Path.join(temporary, name), 0, 0);
  }
  const tar = execFileSync("tar", ["--format=ustar", "-cf", "-", "-C", temporary, ...names], {
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const bundle = gzipSync(tar, { level: 9 });
  const filename = "tabs-developer-bundle.tar.gz";
  const releaseDirectory = Path.join(destination, release);
  FS.mkdirSync(releaseDirectory, { recursive: true });
  for (const name of names)
    immutable(Path.join(releaseDirectory, name), FS.readFileSync(Path.join(temporary, name)));
  immutable(Path.join(releaseDirectory, filename), bundle);
  const latest = {
    ...manifest,
    bundle: {
      url: `/developers/releases/${release}/${filename}`,
      sha256: hash(bundle),
      bytes: bundle.length,
    },
    checksumsUrl: `/developers/releases/${release}/SHA256SUMS`,
  };
  FS.writeFileSync(
    Path.join(destination, "manifest.json.tmp"),
    `${JSON.stringify(latest, null, 2)}\n`,
  );
  FS.renameSync(
    Path.join(destination, "manifest.json.tmp"),
    Path.join(destination, "manifest.json"),
  );
  console.log(JSON.stringify(latest, null, 2));
} finally {
  FS.rmSync(temporary, { recursive: true, force: true });
}
