import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { resolveElectronPath } from "../apps/desktop/scripts/electron-launcher.mjs";

if (process.env.TABS_T3_PARITY_HISTORY_BENCHMARK !== "1") {
  throw new Error("Set TABS_T3_PARITY_HISTORY_BENCHMARK=1 to run the isolated history benchmark.");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = resolve(
  process.env.HISTORY_BENCHMARK_EVIDENCE ??
    join(
      root,
      "docs/architecture/t3-parity-release-audit-2026-10-29/history-render-benchmark.json",
    ),
);
mkdirSync(dirname(evidencePath), { recursive: true });
rmSync(evidencePath, { force: true });

const THREAD_COUNT = Number(process.env.HISTORY_BENCHMARK_THREADS ?? 10_000);
if (!Number.isSafeInteger(THREAD_COUNT) || THREAD_COUNT < 100) {
  throw new Error("HISTORY_BENCHMARK_THREADS must be an integer >= 100.");
}
const PAGE_SIZE = 25;
const projectId = `history-benchmark-project-${crypto.randomUUID()}`;
const stage = (message) => console.log(`[history-benchmark] ${message}`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const waitFor = async (fn, description, timeoutMs = 120_000) => {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    `Timed out: ${description}${lastError ? ` (${String(lastError).slice(0, 240)})` : ""}`,
  );
};
const freePort = async () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });

const home = mkdtempSync(join(tmpdir(), "tabs-t3-history-benchmark-"));
const cleanupHome = () => {
  if (process.env.KEEP_HISTORY_BENCHMARK_HOME === "1") {
    stage(`isolated state retained for diagnostics at ${home}`);
    return;
  }
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {}
};
process.once("exit", () => {
  cleanupHome();
});
const workspace = join(home, "project-workspace");
mkdirSync(workspace);
execFileSync("git", ["init", "-q", workspace]);
execFileSync("git", [
  "-C",
  workspace,
  "-c",
  "user.name=Tabs History Benchmark",
  "-c",
  "user.email=history-benchmark@example.invalid",
  "commit",
  "--allow-empty",
  "-qm",
  "Disposable history benchmark workspace",
]);

const launchApp = async (label, appHome, mode) => {
  const port = await freePort();
  const child = spawn(
    resolveElectronPath(),
    [join(root, "apps/desktop/dist-electron/main.js"), `--remote-debugging-port=${port}`],
    {
      cwd: join(root, "apps/desktop"),
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        TABS_HOME: appHome,
        TABS_DESKTOP_USER_DATA_DIR: join(appHome, "electron-profile"),
        VITE_DEV_SERVER_URL: "",
      },
    },
  );
  child.on("exit", (code, signal) =>
    stage(`${label}: Electron exited code=${code} signal=${signal}`),
  );
  const childExit = new Promise((resolveExit) => child.once("exit", resolveExit));
  let browser;
  let page;
  let lastCdpError;
  try {
    await waitFor(
      async () => {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
          return true;
        } catch (error) {
          lastCdpError = String(error).slice(0, 500);
          return false;
        }
      },
      `${label}: Electron CDP`,
      30_000,
    );
    page = await waitFor(
      () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((candidate) => !candidate.url().startsWith("devtools:")),
      `${label}: app page`,
      30_000,
    );
    page.on("pageerror", (error) =>
      stage(`${label}: renderer error ${error.name}: ${error.message.slice(0, 300)}`),
    );
    await page
      .waitForFunction(() => Boolean(window.__tabsNativeApi), { timeout: 30_000 })
      .catch(async (error) => {
        const state = await page
          .evaluate(() => ({
            url: window.location.href,
            body: document.body?.innerText?.slice(0, 500) ?? "",
          }))
          .catch(() => null);
        stage(`${label}: native API did not load ${JSON.stringify(state)}`);
        throw error;
      });
    stage(`${label}: app API ready at ${page.url()}`);
    const skip = page.getByRole("button", { name: /Skip setup/ });
    if (await skip.count()) await skip.first().click();
    if (mode) {
      await page.addInitScript({ content: browserInstrumentation(mode) });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      await page
        .waitForFunction(() => Boolean(window.__tabsNativeApi), { timeout: 30_000 })
        .catch(async (error) => {
          const state = await page
            .evaluate(() => ({
              url: window.location.href,
              body: document.body?.innerText?.slice(0, 500) ?? "",
            }))
            .catch(() => null);
          stage(`${label}: native API did not reload ${JSON.stringify(state)}`);
          throw error;
        });
      stage(`${label}: instrumented app reloaded`);
    }
    return { child, childExit, browser, page, port, appHome };
  } catch (error) {
    await stopApp({ child, childExit, browser, page });
    throw new Error(`${String(error)}${lastCdpError ? `; latest CDP error: ${lastCdpError}` : ""}`);
  }
};

function browserInstrumentation(mode) {
  return `(() => {
    const mode = ${JSON.stringify(mode)};
    const benchmark = window.__tabsHistoryBenchmark = {
      mode,
      subscribePayload: null,
      snapshot: null,
      snapshotFrameText: null,
      snapshotReceivedAt: null,
      historyRequests: [],
    };
    const NativeWebSocket = window.WebSocket;
    const originalSend = NativeWebSocket.prototype.send;
    NativeWebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        try {
          const message = JSON.parse(data);
          if (message._tag === "Request" && message.tag === "orchestration.subscribeShell") {
            const originalPayload = { ...message.payload };
            if (mode === "full-optout") delete message.payload.omitOlderSettled;
            if (mode === "omit-older-settled") message.payload.omitOlderSettled = true;
            benchmark.subscribePayload = { originalPayload, sentPayload: { ...message.payload } };
            data = JSON.stringify(message);
          } else if (message._tag === "Request" && message.tag === "orchestration.getOlderSettledThreads") {
            benchmark.historyRequests.push({ payload: message.payload, sentAt: performance.now() });
          }
        } catch {}
      }
      return originalSend.call(this, data);
    };
    const originalAddEventListener = NativeWebSocket.prototype.addEventListener;
    const observedSockets = new WeakSet();
    NativeWebSocket.prototype.addEventListener = function (type, listener, options) {
      if (type === "message" && !observedSockets.has(this)) {
        observedSockets.add(this);
        originalAddEventListener.call(this, "message", (event) => {
          if (typeof event.data !== "string") return;
          try {
            const frame = JSON.parse(event.data);
            if (frame._tag !== "Chunk" || !Array.isArray(frame.values)) return;
            const streamSnapshot = frame.values.find((item) => item?.kind === "snapshot");
            if (!streamSnapshot || benchmark.snapshot) return;
            benchmark.snapshot = streamSnapshot.snapshot ?? streamSnapshot;
            benchmark.snapshotFrameText = event.data;
            benchmark.snapshotReceivedAt = performance.now();
          } catch {}
        });
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
  })();`;
}

async function stopApp(app) {
  if (!app?.child) return "no-app";
  const { child, childExit, browser, page } = app;
  if (page && !page.isClosed()) {
    await page.evaluate(() => window.desktopBridge?.setConfirmBeforeQuit?.(false)).catch(() => {});
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Q" : "Alt+F4").catch(() => {});
  }
  let mode = await Promise.race([childExit.then(() => "normal"), sleep(8_000).then(() => null)]);
  if (!mode && page && !page.isClosed()) {
    await page.close({ runBeforeUnload: true }).catch(() => {});
    mode = await Promise.race([
      childExit.then(() => "window-closed"),
      sleep(8_000).then(() => null),
    ]);
  }
  if (!mode) {
    child.kill("SIGTERM");
    mode = await Promise.race([childExit.then(() => "sigterm"), sleep(15_000).then(() => null)]);
  }
  if (!mode) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    await sleep(1_000);
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
    mode = "forced";
  }
  await browser?.close().catch(() => {});
  return mode;
}

const initialApp = await launchApp("seed", home, null);
let seededIds;
try {
  seededIds = await initialApp.page.evaluate(
    async ({ workspace, projectId }) => {
      const api = window.__tabsNativeApi;
      const config = await api.server.getConfig();
      const threadId = "history-benchmark-thread-00000";
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: crypto.randomUUID(),
        projectId,
        title: "History benchmark project",
        workspaceRoot: workspace,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.create",
        commandId: crypto.randomUUID(),
        projectId,
        threadId,
        title: "History benchmark thread 00000",
        modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await api.orchestration.getThreadProjection({ threadId });
          return { threadId, environmentId: config.environment.environmentId };
        } catch {
          await new Promise((resolvePause) => setTimeout(resolvePause, 50));
        }
      }
      throw new Error("Seed project thread was not available from the production API.");
    },
    { workspace, projectId },
  );
  stage(`seed project/thread created (${seededIds.environmentId})`);
} finally {
  const shutdown = await stopApp(initialApp);
  stage(`seed Electron shutdown: ${shutdown}`);
}

const databaseCandidates = [
  join(home, "dev/statev2.sqlite"),
  join(home, "userdata/statev2.sqlite"),
  join(home, "statev2.sqlite"),
];
const databasePath = databaseCandidates.find(existsSync);
if (!databasePath) {
  throw new Error(`Could not find isolated statev2.sqlite under ${home}`);
}
stage(`projection database found at ${databasePath.slice(home.length + 1)}`);

const db = new DatabaseSync(databasePath);
try {
  const seedRow = db
    .prepare(
      `SELECT thread_id, project_id, title, default_provider, provider_instance_id,
              runtime_mode, interaction_mode, active_provider_thread_id,
              created_at, updated_at, archived_at, deleted_at, payload_json
       FROM orchestration_v2_projection_threads WHERE thread_id = ?`,
    )
    .get(seededIds.threadId);
  if (!seedRow) throw new Error("Seed thread projection row is missing.");
  const basePayload = JSON.parse(seedRow.payload_json);
  const insert = db.prepare(
    `INSERT INTO orchestration_v2_projection_threads (
       thread_id, project_id, title, default_provider, provider_instance_id,
       runtime_mode, interaction_mode, active_provider_thread_id,
       created_at, updated_at, archived_at, deleted_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateSeed = db.prepare(
    `UPDATE orchestration_v2_projection_threads
     SET title = ?, created_at = ?, updated_at = ?, archived_at = NULL, deleted_at = NULL,
         payload_json = ?
     WHERE thread_id = ?`,
  );
  const baseTime = Date.parse("2024-01-01T00:00:00.000Z");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < THREAD_COUNT; index++) {
      const threadId = `history-benchmark-thread-${String(index).padStart(5, "0")}`;
      const timestamp = new Date(baseTime + index * 1_000).toISOString();
      const title = `History benchmark thread ${String(index).padStart(5, "0")}`;
      const payload = {
        ...basePayload,
        id: threadId,
        projectId,
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
        deletedAt: null,
        settledOverride: "settled",
        settledAt: timestamp,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
      };
      if (index === 0) {
        updateSeed.run(title, timestamp, timestamp, JSON.stringify(payload), threadId);
        continue;
      }
      insert.run(
        threadId,
        projectId,
        title,
        seedRow.default_provider,
        seedRow.provider_instance_id,
        seedRow.runtime_mode,
        seedRow.interaction_mode,
        seedRow.active_provider_thread_id,
        timestamp,
        timestamp,
        null,
        null,
        JSON.stringify(payload),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const seeded = db
    .prepare(
      "SELECT COUNT(*) AS count FROM orchestration_v2_projection_threads WHERE project_id = ?",
    )
    .get(projectId).count;
  if (seeded !== THREAD_COUNT) throw new Error(`Seeded ${seeded} rows; expected ${THREAD_COUNT}.`);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
} finally {
  db.close();
}

const dbBytes = readFileSync(databasePath);
const dbSha256 = createHash("sha256").update(dbBytes).digest("hex");
const variants = {};
for (const mode of ["full-optout", "omit-older-settled"]) {
  const variantHome = join(home, mode);
  mkdirSync(variantHome, { recursive: true });
  const relativeStateDirectory = dirname(databasePath).slice(home.length + 1);
  const variantStateDirectory = join(variantHome, relativeStateDirectory);
  cpSync(dirname(databasePath), variantStateDirectory, { recursive: true });
}

async function runVariant(mode) {
  stage(`starting ${mode}`);
  const app = await launchApp(mode, join(home, mode), mode);
  let result;
  try {
    const page = app.page;
    stage(`${mode}: waiting for shell snapshot`);
    await page.waitForFunction(() => Boolean(window.__tabsHistoryBenchmark?.snapshot), {
      timeout: 180_000,
    });
    stage(`${mode}: shell snapshot observed`);
    const welcomeProject = page.getByRole("button", { name: /History benchmark project/ }).first();
    if (await welcomeProject.count()) {
      await welcomeProject.click();
      stage(`${mode}: opened benchmark project from welcome screen`);
    }
    const projectUi = await page
      .evaluate(() => ({
        url: location.href,
        text: document.body?.innerText?.slice(0, 900) ?? "",
      }))
      .catch((error) => ({ error: String(error).slice(0, 300) }));
    stage(`${mode}: project UI ${JSON.stringify(projectUi)}`);
    const settledViewStartedAt = await page.evaluate(() => performance.now());
    const settledTab = page.getByRole("tab", { name: /Settled/ });
    await settledTab.evaluate((element) => element.click(), undefined, { timeout: 30_000 });
    stage(`${mode}: opened production Settled thread view`);
    const rowSelector = 'button[aria-label$=", settled, History benchmark project"]';
    const firstFrame = await page.evaluate(async () => {
      const benchmark = window.__tabsHistoryBenchmark;
      const frameText = benchmark.snapshotFrameText;
      const snapshot = benchmark.snapshot;
      const textBytes = new TextEncoder().encode(frameText).byteLength;
      const threads = snapshot.threads ?? [];
      const sortedSettled = threads
        .filter((thread) => thread.settledAt)
        .map((thread) => thread.settledAt)
        .sort((left, right) => Date.parse(right) - Date.parse(left));
      const before = snapshot.olderSettled?.before ?? sortedSettled[24] ?? null;
      return {
        snapshotReceivedAt: benchmark.snapshotReceivedAt,
        shellThreadCount: threads.length + (snapshot.archivedThreads?.length ?? 0),
        activeShellThreadCount: threads.length,
        archivedShellThreadCount: snapshot.archivedThreads?.length ?? 0,
        olderSettled: snapshot.olderSettled ?? null,
        before,
        snapshotFrameText: frameText,
        snapshotJsonParseMs: (() => {
          const start = performance.now();
          JSON.parse(frameText);
          return performance.now() - start;
        })(),
        snapshotFrameBytesUtf8: textBytes,
        subscribePayload: benchmark.subscribePayload,
      };
    });
    if (!firstFrame.before) throw new Error(`${mode}: no settled frontier in snapshot.`);
    const raw = Buffer.from(firstFrame.snapshotFrameText, "utf8");
    const gzipBytes = gzipSync(raw).byteLength;
    delete firstFrame.snapshotFrameText;

    const initialRows = await waitFor(
      async () => {
        const rows = await page.locator(rowSelector).count();
        const expected = mode === "full-optout" ? THREAD_COUNT : PAGE_SIZE;
        return rows >= expected ? rows : false;
      },
      `${mode}: initial production Settled thread rows`,
      120_000,
    );
    await page.evaluate(
      () =>
        new Promise((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
        ),
    );
    const initialUi = await page.evaluate(
      ({ initialRows, settledViewStartedAt }) => ({
        initialRenderedThreadRows: initialRows,
        snapshotToInitialRowsMs:
          performance.now() - window.__tabsHistoryBenchmark.snapshotReceivedAt,
        settledViewToRowsMs: performance.now() - settledViewStartedAt,
      }),
      { initialRows, settledViewStartedAt },
    );
    const countResult = await page.evaluate(
      async ({ before, projectId }) =>
        window.__tabsNativeApi.orchestration.getOlderSettledThreads({
          before: { settledAt: before },
          projectIds: [projectId],
          limit: 0,
        }),
      { before: firstFrame.before, projectId },
    );
    const olderCount =
      countResult.counts.find((entry) => entry.projectId === projectId)?.count ?? 0;
    if (olderCount !== THREAD_COUNT - PAGE_SIZE) {
      throw new Error(
        `${mode}: expected ${THREAD_COUNT - PAGE_SIZE} older rows, got ${olderCount}.`,
      );
    }

    let expandedRows;
    let firstPageRenderMs = null;
    let firstPage;
    let observedOlderSettledRequestCount;
    let searchRequestCount = 0;
    if (mode === "full-optout") {
      expandedRows = initialRows;
    } else {
      const olderButton = page.getByRole("button", { name: /^Load older tasks \(/ }).first();
      await olderButton.waitFor({ timeout: 30_000 });
      const startedAt = await page.evaluate(() => performance.now());
      await olderButton.click();
      await page.waitForFunction(
        (expected) =>
          document.querySelectorAll('button[aria-label$=", settled, History benchmark project"]')
            .length === expected &&
          !Array.from(document.querySelectorAll("button")).some((button) =>
            button.textContent?.includes("Loading older tasks"),
          ),
        PAGE_SIZE * 2,
        { timeout: 60_000, polling: 50 },
      );
      expandedRows = await page.locator(rowSelector).count();
      await page.evaluate(
        () =>
          new Promise((resolveFrame) =>
            requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
          ),
      );
      firstPageRenderMs = await page.evaluate(
        (startedAt) => performance.now() - startedAt,
        startedAt,
      );
      const olderPage = await page.evaluate(
        async ({ before, projectId }) =>
          window.__tabsNativeApi.orchestration.getOlderSettledThreads({
            before: { settledAt: before },
            projectIds: [projectId],
            limit: 25,
          }),
        { before: firstFrame.before, projectId },
      );
      firstPage = {
        pageRows: olderPage.threads.length,
        reportedCounts: olderPage.counts,
        snapshotSequence: olderPage.snapshotSequence,
      };
      if (firstPage.pageRows !== PAGE_SIZE) {
        throw new Error(
          `First older page returned ${firstPage.pageRows} rows; expected ${PAGE_SIZE}.`,
        );
      }
    }

    const rowMetric = {
      initialRenderedThreadRows: initialUi.initialRenderedThreadRows,
      afterPageRenderedThreadRows: mode === "omit-older-settled" ? expandedRows : null,
      snapshotToInitialRowsMs: Number(initialUi.snapshotToInitialRowsMs.toFixed(1)),
      settledViewToRowsMs: Number(initialUi.settledViewToRowsMs.toFixed(1)),
      firstOlderPageToRowsMs:
        firstPageRenderMs === null ? null : Number(firstPageRenderMs.toFixed(1)),
    };
    let searchVerification = null;
    let directLinkVerification = null;
    if (mode === "omit-older-settled") {
      const targetThreadId = "history-benchmark-thread-00000";
      const targetTitle = "History benchmark thread 00000";
      const requestCountBeforeSearch = await page.evaluate(
        () => window.__tabsHistoryBenchmark.historyRequests.length,
      );
      const search = page.getByRole("textbox", { name: "Search tasks" });
      await search.fill(targetTitle);
      await page.getByText(targetTitle, { exact: true }).last().waitFor({ timeout: 180_000 });
      const liveSearch = await page
        .locator("[aria-live='polite']")
        .filter({ hasText: /matching task/ })
        .last()
        .textContent()
        .catch(() => null);
      const searchResultCount = await page.getByText(targetTitle, { exact: true }).count();
      const matchingThreadRows = await page.locator(rowSelector).count();
      const requestsAfterSearch = await page.evaluate(
        () => window.__tabsHistoryBenchmark.historyRequests.length,
      );
      searchVerification = {
        targetThreadId,
        targetFound: searchResultCount > 0,
        renderedMatchingRows: matchingThreadRows,
        liveResultAnnouncement: liveSearch,
        olderSettledRequestsDuringSearch: requestsAfterSearch - requestCountBeforeSearch,
      };
      if (
        !searchVerification.targetFound ||
        searchVerification.olderSettledRequestsDuringSearch < 2
      ) {
        throw new Error(
          `Older thread search failed to find ${targetThreadId} through paged history.`,
        );
      }
      observedOlderSettledRequestCount = requestsAfterSearch;
      searchRequestCount = searchVerification.olderSettledRequestsDuringSearch;
      const resultRow = page.getByText(targetTitle, { exact: true }).last();
      await resultRow.click({ position: { x: 8, y: 8 }, timeout: 30_000 });
      await waitFor(
        () => page.url().includes(targetThreadId),
        "oldest thread navigation from search result",
        60_000,
      );
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForFunction(() => Boolean(window.__tabsNativeApi), { timeout: 30_000 });
      const directProjection = await waitFor(
        async () =>
          page.evaluate(async (threadId) => {
            try {
              const result = await window.__tabsNativeApi.orchestration.getThreadProjection({
                threadId,
              });
              return result.thread.id === threadId
                ? { id: result.thread.id, title: result.thread.title }
                : null;
            } catch {
              return null;
            }
          }, targetThreadId),
        "direct route thread projection hydration",
        60_000,
      );
      directLinkVerification = {
        routeRetainedAfterReload: page.url().includes(targetThreadId),
        projectionLoaded: directProjection.id === targetThreadId,
        projectionTitle: directProjection.title,
      };
      if (
        !directLinkVerification.routeRetainedAfterReload ||
        !directLinkVerification.projectionLoaded
      ) {
        throw new Error("Older thread direct link did not hydrate after reloading the route.");
      }
    }

    observedOlderSettledRequestCount ??= await page.evaluate(
      () => window.__tabsHistoryBenchmark.historyRequests.length,
    );
    const expectedSnapshotRows = mode === "full-optout" ? THREAD_COUNT : PAGE_SIZE;
    if (firstFrame.shellThreadCount !== expectedSnapshotRows) {
      throw new Error(
        `${mode}: snapshot carried ${firstFrame.shellThreadCount} threads, expected ${expectedSnapshotRows}.`,
      );
    }
    result = {
      mode,
      subscribePayload: firstFrame.subscribePayload,
      snapshot: {
        activeShellThreadCount: firstFrame.activeShellThreadCount,
        archivedShellThreadCount: firstFrame.archivedShellThreadCount,
        olderSettled: firstFrame.olderSettled,
        olderSettledCountQuery: {
          count: olderCount,
          snapshotSequence: countResult.snapshotSequence,
          rows: countResult.counts,
        },
        websocketFrame: {
          utf8Bytes: firstFrame.snapshotFrameBytesUtf8,
          gzipBytes: gzipBytes,
          gzipRatio: Number((gzipBytes / firstFrame.snapshotFrameBytesUtf8).toFixed(4)),
          observerJsonParseMs: Number(firstFrame.snapshotJsonParseMs.toFixed(3)),
        },
      },
      actualUi: rowMetric,
      firstOlderPage: firstPage ?? null,
      search: searchVerification,
      directLink: directLinkVerification,
      observedOlderSettledRequestCount,
      olderSettledRequestsDuringSearch: searchRequestCount,
    };
    stage(`${mode} complete: ${expandedRows} actual thread rows rendered`);
  } finally {
    const shutdown = await stopApp(app);
    stage(`${mode} Electron shutdown: ${shutdown}`);
  }
  return result;
}

try {
  variants.fullOptout = await runVariant("full-optout");
  variants.omitOlderSettled = await runVariant("omit-older-settled");
  const evidence = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    benchmark:
      "production Electron renderer, compiled current candidate, isolated disposable TABS_HOME",
    dataset: {
      projectCount: 1,
      settledThreadCount: THREAD_COUNT,
      settledTimestampsUnique: true,
      pageSize: PAGE_SIZE,
      oldestThreadId: "history-benchmark-thread-00000",
      newestThreadId: `history-benchmark-thread-${String(THREAD_COUNT - 1).padStart(5, "0")}`,
      stateDatabaseSha256: dbSha256,
      variantDatabasesIdentical: true,
      seedMethod:
        "Created one real project and thread through the production API, then cloned its validated projection row into the isolated SQLite projection table with unique settled metadata.",
    },
    methodology: {
      fullOptout:
        "The app's outgoing subscribeShell request was intercepted at the WebSocket boundary and omitOlderSettled removed before the production server received it.",
      omitOlderSettled:
        "The app sent the production capability-gated omitOlderSettled option, rendered the initial shell and one 25-thread history page, then exercised the real workspace search and an old-thread route reload.",
      actualUiRows:
        "Counts are production WorkspaceShell settled-thread row buttons selected by their accessible row labels after opening the real project and Settled tab. No synthetic test DOM was used.",
      observerJsonParseMs:
        "A separately measured JSON.parse of the captured snapshot frame in the renderer; this is an observer decode sample, not a claim about the production decoder duration.",
      shellToInitialRowsMs:
        "Elapsed renderer performance.now time from observing the WebSocket snapshot frame to the first actual production Settled row buttons, after opening the project and Settled tab; polling cadence is 100 ms.",
      settledViewToRowsMs:
        "Elapsed renderer time from activating the production Settled tab to the actual baseline DOM row count, followed by two animation frames.",
      firstOlderPageToRowsMs:
        "For omission, elapsed renderer time from clicking Load older tasks to 50 actual production settled-thread row buttons, followed by two animation frames.",
      frameCompression:
        "gzipBytes is offline gzipSync size of the captured UTF-8 JSON envelope. It is not a measured permessage-deflate or on-wire TCP size.",
      search:
        "Typed the oldest title into the actual WorkspaceShell Search tasks input; verified the matching task appears after older pages load.",
      directLink:
        "Selected that search result, reloaded its environment/thread route, and fetched its production thread projection again.",
    },
    variants,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const failure = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    status: "failed",
    error: String(error).slice(0, 1200),
    partialVariants: variants,
  };
  writeFileSync(evidencePath, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  cleanupHome();
}
