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
const registryFixture = process.argv[2] === "--registry-fixture" ? process.argv[3] : undefined;
if (registryFixture && process.env.NODE_ENV !== "test") {
  throw new Error("Registry Electron acceptance is restricted to NODE_ENV=test.");
}

try {
  const documentation = spawnSync(
    "bun",
    [
      "-e",
      `import { extensionDocs } from ${JSON.stringify(join(root, "apps/marketing/src/lib/extension-docs.ts"))}; process.stdout.write(JSON.stringify(extensionDocs));`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (documentation.error) throw documentation.error;
  if (documentation.status !== 0) throw new Error("Could not load SDK documentation examples.");
  const pages = JSON.parse(documentation.stdout);
  const snippets = pages.flatMap((page) =>
    [...page.body.matchAll(/```ts\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .filter((source) => source.includes("window.tabsExtension.")),
  );
  writeFileSync(join(temporary, "documentation-examples.json"), JSON.stringify(snippets));
  // Create an explicit entrypoint that exports required desktop and packaging modules
  writeFileSync(
    entry,
    [
      `export { ExtensionViewManager, extensionSessionPartition, extensionDataIdentity } from "${desktopDir}/src/extensionViewManager";`,
      `export { NativeViewStackCoordinator } from "${desktopDir}/src/nativeViewStackCoordinator";`,
      `export { packTabsext } from "${root}/packages/extension-package/src/index";`,
      `export { ExchangeInstallService } from "${desktopDir}/src/exchangeInstall";`,
      `export { discoverExchangeVersions } from "${desktopDir}/src/exchangeCatalog";`,
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

  const test = spawnSync(
    electronBin,
    [
      registryFixture
        ? fileURLToPath(new URL("./extension-registry-smoke.cjs", import.meta.url))
        : scriptCjs,
      bundle,
      temporary,
      ...(registryFixture ? [registryFixture] : []),
    ],
    {
      cwd: root,
      env,
      stdio: "inherit",
      timeout: 90000,
    },
  );

  if (test.error) throw test.error;
  process.exitCode = test.status ?? 1;
} finally {
  try {
    rmSync(temporary, { recursive: true, force: true });
  } catch {}
}
