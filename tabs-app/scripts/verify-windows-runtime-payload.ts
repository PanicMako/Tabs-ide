import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { verifyWindowsRuntimePayload } from "./lib/windows-runtime-payload.ts";

const runtimeRoot = process.argv[2];
if (!runtimeRoot)
  throw new Error("Usage: verify-windows-runtime-payload.ts <packaged-runtime-directory>");
verifyWindowsRuntimePayload(resolve(runtimeRoot));
const electronExecutable = process.argv[3];
if (electronExecutable) {
  const environment: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete environment.VSCODE_DEV;
  const result = spawnSync(
    resolve(electronExecutable),
    [join(resolve(runtimeRoot), "out/server-main.js"), "--help"],
    {
      env: environment,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.error || result.status !== 0 || !result.stdout.includes("Usage:")) {
    throw new Error(
      `Packaged Windows editor CLI failed: ${result.error?.message ?? result.stderr}`,
    );
  }
}
console.info("Windows editor payload passed production packaging checks.");
