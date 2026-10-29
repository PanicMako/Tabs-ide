import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { resolveElectronPath } from "../apps/desktop/scripts/electron-launcher.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(
  process.env.EVIDENCE_DIR ?? join(root, ".logs/t3-parity-release-audit-2026-10-29/native-ide"),
);
mkdirSync(evidence, { recursive: true });
for (const name of ["failure-status.json", "failure.png"])
  rmSync(join(evidence, name), { force: true });
const stage = (name) => console.log(`[acceptance] ${name}`);
const home = mkdtempSync(join(tmpdir(), "tabs-t3-native-"));
const workspace = join(home, "project");
mkdirSync(workspace);
execFileSync("git", ["init", "-q", workspace]);
execFileSync("git", [
  "-C",
  workspace,
  "-c",
  "user.name=Tabs Acceptance",
  "-c",
  "user.email=acceptance@example.invalid",
  "commit",
  "--allow-empty",
  "-qm",
  "Disposable acceptance workspace",
]);
const port = await new Promise((resolvePort) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolvePort(port));
  });
});
const child = spawn(
  resolveElectronPath(),
  [join(root, "apps/desktop/dist-electron/main.js"), `--remote-debugging-port=${port}`],
  {
    cwd: join(root, "apps/desktop"),
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      TABS_HOME: home,
      TABS_DESKTOP_USER_DATA_DIR: join(home, "electron-profile"),
      VITE_DEV_SERVER_URL: "",
    },
  },
);
child.on("exit", (code, signal) => stage(`Electron exited code=${code} signal=${signal}`));
const childExit = new Promise((resolveExit) => child.once("exit", resolveExit));
let browser;
let page;
let acceptanceResult;
let lastCdpError;
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
const poll = async (fn, description, timeout = 120_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await pause(200);
  }
  throw new Error(`Timed out: ${description}${lastCdpError ? ` (${lastCdpError})` : ""}`);
};
try {
  await poll(
    async () => {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        return true;
      } catch (error) {
        lastCdpError = String(error).slice(0, 500);
        return false;
      }
    },
    "Electron debugging endpoint",
    30_000,
  );
  browser.on("disconnected", () => stage("CDP disconnected"));
  stage("Electron connected");
  page = await poll(
    async () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => !candidate.url().startsWith("devtools:")),
    "renderer page",
    30_000,
  );
  page.on("close", () => stage("renderer closed"));
  page.on("crash", () => stage("renderer crashed"));
  await page.waitForFunction(() => Boolean(window.__tabsNativeApi), { timeout: 30_000 });
  const skip = page.getByRole("button", { name: /Skip setup/ });
  if (await skip.count()) await skip.first().click();
  writeFileSync(join(workspace, "acceptance.txt"), "Tabs native IDE acceptance\n");
  const state = await page.evaluate(() => window.desktopBridge.getCodeHostState());
  if (!state.available) throw new Error(`Native IDE unavailable: ${state.reason}`);
  await page.evaluate(
    async ({ workspace }) => {
      const bridge = window.desktopBridge;
      await bridge.ensureCodeSession({ projectId: "native-acceptance", workspaceRoot: workspace });
      await bridge.setCodeBounds({
        projectId: "native-acceptance",
        x: 220,
        y: 80,
        width: 900,
        height: 650,
        visible: true,
      });
      await bridge.activateCodeSession({ projectId: "native-acceptance" });
    },
    { workspace },
  );
  const editor = await poll(
    async () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().includes("workbench-dev.html")),
    "native workbench target",
    60_000,
  );
  await editor.locator(".monaco-workbench").waitFor({ timeout: 60_000 });
  await page.evaluate(() =>
    window.desktopBridge.openCodeFile({
      projectId: "native-acceptance",
      relativePath: "acceptance.txt",
      navigationNonce: Date.now(),
    }),
  );
  await editor.getByRole("tab", { name: /acceptance.txt/ }).waitFor({ timeout: 30_000 });
  await editor
    .getByText("Tabs native IDE acceptance", { exact: false })
    .first()
    .waitFor({ timeout: 30_000 });
  await pause(2500);
  const gitExtensionActivationErrorVisible = await editor
    .locator("body")
    .evaluate((body) => body.innerText.includes("Activating extension 'vscode.git' failed"));
  if (gitExtensionActivationErrorVisible) {
    throw new Error("The native workbench displayed a vscode.git activation error.");
  }
  await editor.screenshot({ path: join(evidence, "native-editor.png") });
  acceptanceResult = {
    verifiedAt: new Date().toISOString(),
    available: state.available,
    mode: state.mode,
    version: state.version,
    workbenchLoaded: true,
    localFileOpened: true,
    gitExtensionActivationErrorVisible,
    screenshot: "native-editor.png",
  };
  writeFileSync(join(evidence, "result.json"), JSON.stringify(acceptanceResult, null, 2));
  console.log(JSON.stringify(acceptanceResult));
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, "failure.png") }).catch(() => {});
  const progress = page
    ? await page.evaluate(() => window.__tabsParityProgress ?? null).catch(() => null)
    : null;
  if (progress) {
    writeFileSync(join(evidence, "failure-status.json"), JSON.stringify(progress, null, 2));
    console.error(JSON.stringify(progress));
  }
  // Keep diagnostics bounded; never dump settings, credentials, environment or backend logs.
  console.error(String(error).slice(0, 1000));
  process.exitCode = 1;
} finally {
  // Prefer the normal quit lifecycle so desktop cleanup and settings flushing
  // run before the isolated profile is removed. This harness profile is
  // disposable, so disable the quit confirmation first.
  if (page && !page.isClosed()) {
    await page.evaluate(() => window.desktopBridge.setConfirmBeforeQuit(false)).catch(() => {});
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Q" : "Alt+F4").catch(() => {});
  }
  let exitMode = await Promise.race([
    childExit.then(() => "exited"),
    pause(10_000).then(() => null),
  ]);
  if (!exitMode && page && !page.isClosed()) {
    await page.close({ runBeforeUnload: true }).catch(() => {});
    exitMode = await Promise.race([
      childExit.then(() => "closed-window"),
      pause(10_000).then(() => null),
    ]);
  }
  if (!exitMode) {
    stage("requesting Electron quit through SIGTERM handler");
    child.kill("SIGTERM");
    exitMode = await Promise.race([
      childExit.then(() => "sigterm"),
      pause(20_000).then(() => null),
    ]);
  }
  const exitedNormally = exitMode !== null;
  if (!exitedNormally) stage("normal quit timed out; terminating isolated Electron process group");
  try {
    if (!exitedNormally) process.kill(-child.pid, "SIGTERM");
  } catch {}
  if (!exitedNormally) await pause(2000);
  try {
    if (!exitedNormally) process.kill(-child.pid, "SIGKILL");
  } catch {}
  if (acceptanceResult) {
    acceptanceResult.shutdown = exitMode === "exited" ? "normal" : (exitMode ?? "forced");
    writeFileSync(join(evidence, "result.json"), JSON.stringify(acceptanceResult, null, 2));
  }
  await browser?.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
