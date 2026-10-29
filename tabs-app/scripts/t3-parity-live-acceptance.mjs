import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { resolveElectronPath } from "../apps/desktop/scripts/electron-launcher.mjs";

if (process.env.TABS_T3_PARITY_LIVE !== "1")
  throw new Error("Set TABS_T3_PARITY_LIVE=1 to run the real provider acceptance check.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(
  process.env.EVIDENCE_DIR ?? join(root, ".logs/t3-parity-release-audit-2026-10-29/live-provider"),
);
mkdirSync(evidence, { recursive: true });
for (const name of ["result.json", "failure-status.json", "failure.png"])
  rmSync(join(evidence, name), { force: true });
const stage = (name) => console.log(`[acceptance] ${name}`);
const home = mkdtempSync(join(tmpdir(), "tabs-t3-live-"));
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
const binaryPath =
  process.env.TABS_PARITY_CODEX_BINARY ??
  execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
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
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
const poll = async (fn, description, timeout = 120_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await pause(200);
  }
  throw new Error(`Timed out: ${description}`);
};
try {
  await poll(
    async () => {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        return true;
      } catch {
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
  await page.evaluate(
    async ({ binaryPath }) => {
      await window.__tabsNativeApi.server.updateSettings({
        providerInstances: {
          codex: {
            driver: "codex",
            displayName: "Codex",
            enabled: true,
            config: { setupMode: "existing", binaryPath },
          },
        },
      });
      await window.__tabsNativeApi.server.refreshProviders({ instanceId: "codex" });
    },
    { binaryPath },
  );
  const environmentId = await poll(
    async () =>
      page.evaluate(async () => {
        const config = await window.__tabsNativeApi.server.getConfig();
        return config.providers.some(
          (provider) => provider.instanceId === "codex" && provider.status === "ready",
        )
          ? config.environment.environmentId
          : null;
      }),
    "existing Codex provider readiness",
    60_000,
  );
  stage("provider ready");
  const ids = await page.evaluate(
    async ({ workspace }) => {
      const api = window.__tabsNativeApi;
      const projectId = `acceptance-project-${crypto.randomUUID()}`;
      const threadId = `acceptance-parent-${crypto.randomUUID()}`;
      const selection = { instanceId: "codex", model: "gpt-6-luna" };
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: crypto.randomUUID(),
        projectId,
        title: "T3 parity acceptance",
        workspaceRoot: workspace,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.create",
        commandId: crypto.randomUUID(),
        projectId,
        threadId,
        title: "Live parent greeting",
        modelSelection: selection,
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      await api.orchestration.dispatchCommand({
        type: "message.dispatch",
        commandId: crypto.randomUUID(),
        threadId,
        messageId: crypto.randomUUID(),
        text: "Reply exactly PARENT_HELLO. If a delegated child reports a greeting, briefly acknowledge it. Do not use tools.",
        attachments: [],
        modelSelection: selection,
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        const projection = await api.orchestration.getThreadProjection({ threadId });
        const run = projection.runs.find(
          (candidate) =>
            candidate.rootNodeId && ["starting", "running", "waiting"].includes(candidate.status),
        );
        if (run) {
          await api.orchestration.dispatchCommand({
            type: "delegated_task.request",
            commandId: crypto.randomUUID(),
            parentThreadId: threadId,
            parentRunId: run.id,
            parentNodeId: run.rootNodeId,
            task: "Reply exactly CHILD_HELLO. Do not use tools.",
            title: "Acceptance child greeting",
            modelSelection: selection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            completionWake: "always",
            createdBy: "user",
            creationSource: "web",
          });
          return { threadId, projectId };
        }
        await new Promise((resolvePause) => setTimeout(resolvePause, 50));
      }
      throw new Error("No active parent run became available for delegation.");
    },
    { workspace },
  );
  stage("parent and child requested");
  const summary = await poll(
    async () =>
      page.evaluate(async ({ threadId }) => {
        const api = window.__tabsNativeApi;
        const parent = await api.orchestration.getThreadProjection({ threadId });
        const agent = parent.subagents.find((candidate) => candidate.childThreadId);
        if (!agent) return null;
        const child = await api.orchestration.getThreadProjection({
          threadId: agent.childThreadId,
        });
        for (const projection of [parent, child]) {
          for (const request of projection.runtimeRequests.filter(
            (candidate) => candidate.status === "pending",
          )) {
            const item = projection.turnItems.find(
              (candidate) =>
                candidate.type === "approval_request" && candidate.requestId === request.id,
            );
            if (request.kind !== "mcp-elicitation" || item?.type !== "approval_request") continue;
            const name = item.appName ?? "";
            const prompt = item.prompt ?? "";
            if (!/t3[-_ ]?code/i.test(name + " " + prompt))
              throw new Error(`Unexpected provider approval from ${name.slice(0, 80)}`);
            window.__tabsParityApproved ??= new Set();
            if (window.__tabsParityApproved.has(request.id)) continue;
            window.__tabsParityApproved.add(request.id);
            await api.orchestration.dispatchCommand({
              type: "runtime-request.respond",
              commandId: crypto.randomUUID(),
              threadId: projection.thread.id,
              requestId: request.id,
              decision: "accept",
            });
          }
        }
        window.__tabsParityProgress = {
          parentRuns: parent.runs.map((run) => ({ id: run.id, status: run.status })),
          childRuns: child.runs.map((run) => ({ id: run.id, status: run.status })),
          childStatus: agent.status,
          completionDelivery: agent.completionDelivery ?? null,
          pendingRequests: [...parent.runtimeRequests, ...child.runtimeRequests]
            .filter((request) => request.status === "pending")
            .map((request) => request.kind),
          providerErrors: [...parent.turnItems, ...child.turnItems]
            .filter((item) => item.type === "provider_error")
            .map((item) => ({
              failureClass: item.failure?.class,
              message: item.failure?.message?.slice(0, 400),
            })),
          parentAssistantMessages: parent.messages.filter((message) => message.role === "assistant")
            .length,
          childAssistantMessages: child.messages.filter((message) => message.role === "assistant")
            .length,
        };
        if (
          [...parent.runs, ...child.runs].some((run) =>
            ["queued", "preparing", "starting", "running", "waiting"].includes(run.status),
          )
        )
          return null;
        if (child.runs.length === 0 || ["pending", "running", "waiting"].includes(agent.status))
          return null;
        if (!["acknowledged", "delivered"].includes(agent.completionDelivery?.state)) return null;
        const greeting = child.messages.some(
          (message) => message.role === "assistant" && message.text.includes("CHILD_HELLO"),
        );
        if (!greeting || agent.status !== "completed")
          throw new Error(
            `Provider child did not complete the greeting (status: ${agent.status}).`,
          );
        if (
          child.thread.runtimeMode !== "approval-required" ||
          child.thread.lineage.parentThreadId !== threadId
        )
          throw new Error("Delegation did not preserve lineage and permissions.");
        return {
          parentThreadId: threadId,
          childThreadId: child.thread.id,
          childStatus: agent.status,
          parentRuns: parent.runs.map((run) => run.status),
          childRuns: child.runs.map((run) => run.status),
          inheritedRuntimeMode: child.thread.runtimeMode,
          completionDelivery: agent.completionDelivery?.state,
          greetingVerified: true,
        };
      }, ids),
    "real parent and child completion",
    180_000,
  );
  stage("parent, child and completion delivery verified");
  await page.evaluate(
    ({ environmentId, threadId }) => {
      window.location.hash = `#/${environmentId}/${threadId}`;
    },
    { environmentId, threadId: ids.threadId },
  );
  const toggle = page.getByRole("button", { name: "Toggle workspace actions" });
  await toggle.waitFor({ timeout: 30_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const agents = page.getByRole("button", { name: /^Sub-agents/ });
  if ((await agents.getAttribute("aria-expanded")) !== "true") await agents.click();
  await page
    .getByRole("region", { name: "Workspace actions" })
    .getByText("Acceptance child greeting", { exact: true })
    .waitFor();
  const result = page
    .getByRole("region", { name: "Workspace actions" })
    .getByText("Result", { exact: true });
  if (await result.count()) await result.first().click();
  await page.screenshot({ path: join(evidence, "live-child-result.png") });
  await page
    .getByRole("region", { name: "Workspace actions" })
    .getByRole("button", { name: /Acceptance child greeting/ })
    .click();
  await page.getByText("CHILD_HELLO", { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.reload();
  await page.getByText("CHILD_HELLO", { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(evidence, "child-direct-link-reload.png") });
  summary.childDirectLinkReloadVerified = true;

  writeFileSync(
    join(evidence, "result.json"),
    JSON.stringify({ verifiedAt: new Date().toISOString(), ...summary }, null, 2),
  );
  console.log(JSON.stringify(summary));
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
  await browser?.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
