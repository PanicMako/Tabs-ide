import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "tabs-native-workflow-run-"));
const bundle = join(temporary, "host.cjs");
try {
  const build = spawnSync(
    "bun",
    [
      "build",
      "apps/desktop/src/browserHostManager.ts",
      "--target=node",
      "--format=cjs",
      "--external",
      "electron",
      "--external",
      "@napi-rs/keyring",
      `--outfile=${bundle}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error("Could not build the browser workflow test bundle.");
  const env = { ...process.env, TABS_BROWSER_SMOKE_DIR: join(temporary, "profile") };
  delete env.ELECTRON_RUN_AS_NODE;
  const test = spawnSync(
    require("electron"),
    [fileURLToPath(new URL("./browser-workflows-smoke.cjs", import.meta.url)), bundle],
    { cwd: root, env, stdio: "inherit", timeout: 70000 },
  );
  if (test.error) throw test.error;
  process.exitCode = test.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
