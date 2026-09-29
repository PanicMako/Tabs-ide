import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const desktopDir = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "tabs-extension-smoke-run-"));
const entry = join(temporary, "entry.ts");
const bundle = join(temporary, "extensionHostBundle.cjs");
const preload = join(temporary, "extensionPreload.js");
const scriptCjs = fileURLToPath(new URL("./extension-smoke-test.cjs", import.meta.url));

try {
  // Create an explicit entrypoint that exports required desktop and packaging modules
  writeFileSync(
    entry,
    [
      `export { ExtensionViewManager, extensionSessionPartition, extensionDataIdentity } from "${desktopDir}/src/extensionViewManager";`,
      `export { NativeViewStackCoordinator } from "${desktopDir}/src/nativeViewStackCoordinator";`,
      `export { packTabsext } from "${root}/packages/extension-package/src/index";`,
    ].join("\n"),
  );

  // Precompile extension preload into temporary directory
  const buildPreload = spawnSync(
    "bun",
    [
      "build",
      join(desktopDir, "src/extensionPreload.ts"),
      "--target=node",
      "--format=cjs",
      "--external",
      "electron",
      `--outfile=${preload}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (buildPreload.error) throw buildPreload.error;
  if (buildPreload.status !== 0) {
    throw new Error("Could not compile extensionPreload.js for the smoke test.");
  }

  // Bundle the extension host runner dependencies, defining __dirname as the temporary directory
  // so Path.join(__dirname, "extensionPreload.js") resolves directly to the isolated preload file.
  const buildHost = spawnSync(
    "bun",
    [
      "build",
      entry,
      "--target=node",
      "--format=cjs",
      "--external",
      "electron",
      "--external",
      "quickjs-emscripten",
      "--define",
      `__dirname="${temporary}"`,
      `--outfile=${bundle}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (buildHost.error) throw buildHost.error;
  if (buildHost.status !== 0) {
    throw new Error("Could not build the extension smoke test host bundle.");
  }

  // Ensure isolated environment and launch real Electron binary
  const env = {
    ...process.env,
    TABS_EXTENSION_SMOKE_DIR: temporary,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronBin = require("electron");
  console.log("Launching Electron extension smoke test with:", electronBin);

  const test = spawnSync(electronBin, [scriptCjs, bundle, temporary], {
    cwd: root,
    env,
    stdio: "inherit",
    timeout: 90000,
  });

  if (test.error) throw test.error;
  process.exitCode = test.status ?? 1;
} finally {
  try {
    rmSync(temporary, { recursive: true, force: true });
  } catch {}
}
