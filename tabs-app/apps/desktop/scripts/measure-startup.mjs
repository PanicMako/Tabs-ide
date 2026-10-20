import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { resolveElectronPath } from "./electron-launcher.mjs";

// Separate fresh profiles and caches by default; --warm reuses one disposable profile.
const args = process.argv.slice(2);
const warm = args.includes("--warm");
const count = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 3);
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Use 1-20 samples.");
if (process.platform === "win32") throw new Error("This process-group probe supports macOS/Linux.");
const desktopDir = fileURLToPath(new URL("..", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "tabs-startup-measure-"));
const results = [];

try {
  for (let index = 0; index < count; index++) {
    const profile = join(root, warm ? "warm" : `fresh-${index}`);
    const env = {
      ...process.env,
      TABS_HOME: profile,
      TABS_DESKTOP_USER_DATA_DIR: join(profile, "electron"),
      VITE_DEV_SERVER_URL: "",
      T3CODE_LOG_LEVEL: "Debug",
      NODE_COMPILE_CACHE: join(profile, "compile-cache"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    const started = performance.now();
    const child = spawn(resolveElectronPath(), [join(desktopDir, "scripts/startup-probe.cjs")], {
      cwd: desktopDir,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const marks = {};
    let pending = "";
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("TABS_STARTUP_SAMPLE ")) continue;
        const value = JSON.parse(line.slice("TABS_STARTUP_SAMPLE ".length));
        marks[value.stage] = {
          processMs: Math.round(performance.now() - started),
          entryMs: Math.round(value.ms),
        };
      }
    });
    // Drain logs without recording credentials, URLs or application output.
    child.stderr.resume();
    const terminate = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* The group may already have exited. */
      }
    };
    const timer = setTimeout(terminate, 30_000);
    process.once("SIGINT", terminate);
    process.once("SIGTERM", terminate);
    try {
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          if (code === 0 && marks["workspace-interactive"]) resolve();
          else
            reject(
              new Error(
                `Sample ${index + 1} did not become interactive (${code ?? signal}). Build desktop and server first.`,
              ),
            );
        });
      });
    } finally {
      clearTimeout(timer);
      terminate();
      process.off("SIGINT", terminate);
      process.off("SIGTERM", terminate);
    }
    const result = { sample: index + 1, profile: warm && index > 0 ? "warm" : "fresh", marks };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const times = results
    .map((result) => result.marks["workspace-interactive"].processMs)
    .sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      samples: count,
      minMs: times[0],
      maxMs: times.at(-1),
      medianMs: times[Math.floor(times.length / 2)],
    }),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
