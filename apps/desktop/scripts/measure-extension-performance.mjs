import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { validateTabsExtensionManifest } from "@tabs/shared/extensions";
import { runExtensionLogicSpike } from "../src/extensionLogicSpike.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);
const root = Path.resolve(__dirname, "../../..");

async function collectEnvironment() {
  const cpus = OS.cpus();
  return {
    os: `${OS.type()} ${OS.release()} (${OS.arch()})`,
    platform: OS.platform(),
    cpu: cpus[0]?.model ?? "Unknown CPU",
    cpuCores: cpus.length,
    totalMemoryMb: Math.round(OS.totalmem() / (1024 * 1024)),
    nodeVersion: process.version,
    pid: process.pid,
  };
}

async function measureSample(name, manifestPath, logicPath = null) {
  const manifestRaw = await FS.readFile(manifestPath, "utf8");
  const manifestJson = JSON.parse(manifestRaw);

  // Measure manifest validation
  const startManifest = performance.now();
  const parsed = validateTabsExtensionManifest(manifestJson, "1.3.17");
  if (!parsed.ok) throw new Error(parsed.errors.join(", "));
  const manifest = parsed.manifest;
  const manifestTimeMs = performance.now() - startManifest;

  // Measure memory before
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();

  let logicRuns = [];
  let logicTotalTimeMs = 0;

  if (logicPath) {
    const logicSource = await FS.readFile(logicPath, "utf8");
    // Warm up run
    await runExtensionLogicSpike(logicSource, {
      commandId: "analyze-text",
      input: { text: "Hello Tabs" },
    });

    // 5 measured runs
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const result = await runExtensionLogicSpike(logicSource, {
        commandId: "analyze-text",
        input: { text: "The quick brown fox jumps over the lazy dog. ".repeat(10) },
      });
      const duration = performance.now() - start;
      logicRuns.push({ run: i + 1, durationMs: duration, result });
    }
    logicTotalTimeMs = logicRuns.reduce((acc, r) => acc + r.durationMs, 0) / logicRuns.length;
  }

  const memAfter = process.memoryUsage();

  return {
    sampleName: name,
    type: logicPath ? "logic-enabled" : "ui-only",
    publisher: manifest.publisher,
    extensionName: manifest.name,
    version: manifest.version,
    capabilities: manifest.capabilities || [],
    manifestValidationTimeMs: Number(manifestTimeMs.toFixed(3)),
    averageLogicExecutionTimeMs: logicPath ? Number(logicTotalTimeMs.toFixed(3)) : null,
    logicRuns: logicRuns.map((r) => ({ run: r.run, durationMs: Number(r.durationMs.toFixed(3)) })),
    memoryDelta: {
      heapUsedDeltaKb: Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024),
      heapTotalDeltaKb: Math.round((memAfter.heapTotal - memBefore.heapTotal) / 1024),
      rssDeltaKb: Math.round((memAfter.rss - memBefore.rss) / 1024),
      externalDeltaKb: Math.round((memAfter.external - memBefore.external) / 1024),
    },
    baselineMemory: {
      heapUsedMb: Number((memAfter.heapUsed / (1024 * 1024)).toFixed(2)),
      rssMb: Number((memAfter.rss / (1024 * 1024)).toFixed(2)),
    },
  };
}

async function main() {
  const env = await collectEnvironment();
  console.log("=== Tabs Extension Performance Benchmark ===");
  console.log(`Environment: ${env.os}, ${env.cpu} (${env.cpuCores} cores)`);
  console.log(`Node: ${env.nodeVersion}, Memory: ${env.totalMemoryMb} MB total\n`);

  const uiSamplePath = Path.join(root, "examples/hello-extension/tabs-extension.json");
  const logicSamplePath = Path.join(
    root,
    "examples/project-companion-extension/tabs-extension.json",
  );
  const logicScriptPath = Path.join(root, "examples/project-companion-extension/dist/logic.js");

  const uiResult = await measureSample("hello-extension (UI-only)", uiSamplePath);
  const logicResult = await measureSample(
    "project-companion-extension (Logic-enabled)",
    logicSamplePath,
    logicScriptPath,
  );

  const report = {
    timestamp: new Date().toISOString(),
    measurementMethod:
      "Node.js headless benchmark with QuickJS-Emscripten WebWorker isolated runtime probe & V8 memoryUsage delta sampling",
    verifiedInRealElectron: false,
    environment: env,
    samples: [uiResult, logicResult],
  };

  console.log("--- Results Summary ---");
  console.table([
    {
      Sample: uiResult.sampleName,
      Type: uiResult.type,
      "Manifest Parse (ms)": uiResult.manifestValidationTimeMs,
      "Avg Logic Exec (ms)": "N/A",
      "Heap Delta (KB)": uiResult.memoryDelta.heapUsedDeltaKb,
      "Heap Total (MB)": uiResult.baselineMemory.heapUsedMb,
    },
    {
      Sample: logicResult.sampleName,
      Type: logicResult.type,
      "Manifest Parse (ms)": logicResult.manifestValidationTimeMs,
      "Avg Logic Exec (ms)": logicResult.averageLogicExecutionTimeMs,
      "Heap Delta (KB)": logicResult.memoryDelta.heapUsedDeltaKb,
      "Heap Total (MB)": logicResult.baselineMemory.heapUsedMb,
    },
  ]);

  const outputPath = Path.join(__dirname, "extension-performance-report.json");
  await FS.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nReport written to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
