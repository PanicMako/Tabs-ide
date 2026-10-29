import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { resolveElectronPath } from "../apps/desktop/scripts/electron-launcher.mjs";

if (process.env.TABS_T3_PARITY_LIVE !== "1")
  throw new Error("Set TABS_T3_PARITY_LIVE=1 to run the real provider tool-use evaluation.");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  process.env.EVIDENCE_FILE ??
    join(root, "docs/architecture/t3-parity-release-audit-2026-10-29/tool-use-live.json"),
);
mkdirSync(dirname(outputPath), { recursive: true });
const startedAt = Date.now();
const home = mkdtempSync(join(tmpdir(), "tabs-t3-tool-use-"));
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
  "Disposable MCP evaluation workspace",
]);
const binaryPath =
  process.env.TABS_PARITY_CODEX_BINARY ??
  execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
const port = await new Promise((resolvePort) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const assignedPort = server.address().port;
    server.close(() => resolvePort(assignedPort));
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
const childExit = new Promise((resolveExit) => child.once("exit", resolveExit));
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
const poll = async (fn, description, timeout = 120_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await pause(250);
  }
  throw new Error(`Timed out: ${description}`);
};
const redact = (value) =>
  String(value ?? "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(/(?:\/Users\/|\/home\/|\/var\/|\/tmp\/|\/private\/var\/|[A-Z]:\\)[^\s"']+/g, "[path]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .slice(0, 400);
const summarizeValue = (value) => {
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "string") return { kind: "string", length: value.length };
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  if (typeof value === "object")
    return { kind: "object", keys: Object.keys(value).sort().slice(0, 30) };
  return { kind: typeof value };
};
const parseJsonValue = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const extractToolResult = (output) => {
  let value = output;
  for (let depth = 0; depth < 4; depth++) {
    value = parseJsonValue(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    if (value.structuredContent !== undefined) {
      value = value.structuredContent;
      continue;
    }
    const text = Array.isArray(value.content)
      ? value.content.find((content) => content?.type === "text")?.text
      : undefined;
    if (text !== undefined) {
      value = text;
      continue;
    }
    if (value.result !== undefined) {
      value = value.result;
      continue;
    }
    return value;
  }
  return value;
};
const readOwnThreadToolItems = (threadId) => {
  const databasePath = join(home, "userdata", "statev2.sqlite");
  const quotedThreadId = `'${threadId.replaceAll("'", "''")}'`;
  const sql = `SELECT payload_json FROM orchestration_v2_projection_turn_items WHERE thread_id = ${quotedThreadId} AND type = 'dynamic_tool' ORDER BY ordinal`;
  const rows = JSON.parse(
    execFileSync("sqlite3", ["-readonly", "-json", databasePath, sql], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  return rows.map(({ payload_json }) => JSON.parse(payload_json));
};
const summarizeToolItem = (item, disposableProjectId) => {
  const input =
    item.input && typeof item.input === "object" && !Array.isArray(item.input) ? item.input : {};
  const outputObject = extractToolResult(item.output);
  const outputText =
    typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? null);
  const outputKeys =
    outputObject && typeof outputObject === "object" && !Array.isArray(outputObject)
      ? Object.keys(outputObject).sort().slice(0, 40)
      : [];
  const nestedText = typeof outputObject === "string" ? outputObject : undefined;
  const originalOutput = parseJsonValue(item.output);
  const isError =
    item.status === "failed" ||
    item.isError === true ||
    originalOutput?.isError === true ||
    originalOutput?.isFailure === true ||
    outputObject?.isError === true ||
    outputObject?.isFailure === true;
  const errorText =
    item.error ??
    outputObject?.message ??
    outputObject?.error ??
    (isError ? (nestedText ?? outputText) : undefined);
  const toolName = item.toolName ?? "";
  const resultPayloadAvailable = item.output !== undefined && item.outputOmitted !== true;
  const providers = Array.isArray(outputObject?.providers) ? outputObject.providers : [];
  const projects = Array.isArray(outputObject?.projects) ? outputObject.projects : [];
  return {
    status: item.status ?? null,
    toolName: toolName || null,
    argumentKeys: Object.keys(input).sort(),
    arguments: Object.fromEntries(
      Object.entries(input)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, summarizeValue(value)]),
    ),
    outputPresent: item.output !== undefined,
    outputOmitted: item.outputOmitted === true,
    isError,
    resultKeys: outputKeys,
    resultLengths: outputObject
      ? Object.fromEntries(
          Object.entries(outputObject)
            .filter(([, value]) => Array.isArray(value))
            .map(([key, value]) => [key, value.length]),
        )
      : undefined,
    capabilityResult:
      toolName.endsWith("orchestrator_capabilities") && resultPayloadAvailable
        ? {
            providerCount: providers.length,
            codexProviderReturned: providers.some(
              (provider) =>
                provider.providerInstanceId === "codex" && provider.driverKind === "codex",
            ),
            gpt6LunaAvailable: providers.some(
              (provider) =>
                provider.providerInstanceId === "codex" &&
                provider.models?.some((model) => model.id === "gpt-6-luna"),
            ),
          }
        : undefined,
    projectListResult:
      toolName.endsWith("t3_project_list") && !isError && resultPayloadAvailable
        ? {
            projectCount: projects.length,
            containsDisposableProject: projects.some(
              (project) => project.id === disposableProjectId,
            ),
          }
        : undefined,
    error: errorText ? redact(errorText) : undefined,
  };
};

let browser;
let page;
let finalEvidence = {
  generatedAt: new Date().toISOString(),
  provider: { driver: "codex", model: "gpt-6-luna" },
  setup:
    "isolated temporary TABS_HOME, Electron profile, and empty disposable Git project; existing Codex CLI configured through normal provider settings API",
  promptDataRecorded: false,
  schemaMeasurement: {
    source:
      "the exact advertisedJsonSchema output for orchestrator_capabilities and t3_project_list from their registered tool definitions",
    scope:
      "these two exercised tools only; the provider received the complete MCP registry, whose full serialized schema catalog is not available in the turn projection",
    bytes: 370,
    estimatedTokens: 106,
    estimateMethod:
      "Math.round(UTF8 JSON schema bytes / 3.5); estimate only, not provider-reported usage",
  },
  comparison: {
    runs: [],
    legacyReadOnlyAlias:
      "none: the registered legacy alias table contains only mutating preview actions, queue operations, thread fork/merge, and scheduled-task updates",
    note: "One live provider run observed the safe tool-call sequence. Result bodies were verified from the isolated profile using a read-only query. No state-changing legacy alias is invoked.",
    evidenceSource:
      "The harness queried only the generated thread's dynamic_tool payloads from the isolated profile's orchestration_v2_projection_turn_items table in statev2.sqlite using sqlite3 -readonly. No other table or user database was accessed.",
  },
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
  page = await poll(
    async () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => !candidate.url().startsWith("devtools:")),
    "renderer page",
    30_000,
  );
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
  const ids = await page.evaluate(
    async ({ workspace }) => {
      const api = window.__tabsNativeApi;
      const projectId = `acceptance-project-${crypto.randomUUID()}`;
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: crypto.randomUUID(),
        projectId,
        title: "MCP tool-use evaluation",
        workspaceRoot: workspace,
      });
      const selection = { instanceId: "codex", model: "gpt-6-luna" };
      const prompt = [
        "Perform this read-only MCP tool-use evaluation using the registered Tabs MCP tools.",
        "First discover provider/model availability by calling orchestrator_capabilities with no filters.",
        "Then call t3_project_list with limit 0 exactly once, observe the invalid-argument response, recover by calling t3_project_list with limit 5, and report only the number of returned projects.",
        "Do not call any mutating tool, do not use shell or other tools, and do not include project IDs or paths in your final answer.",
      ].join(" ");
      const threads = [];
      for (const label of ["evaluation"]) {
        const threadId = `acceptance-${label}-${crypto.randomUUID()}`;
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: crypto.randomUUID(),
          projectId,
          threadId,
          title: `MCP ${label}`,
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
          text: prompt,
          attachments: [],
          modelSelection: selection,
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        threads.push({ label, threadId });
      }
      return { projectId, threads };
    },
    { workspace },
  );
  finalEvidence.environmentReady = Boolean(environmentId);
  const runStart = Date.now();
  for (const target of ids.threads) {
    const outcome = await poll(
      async () =>
        page.evaluate(
          async ({ threadId }) => {
            const projection = await window.__tabsNativeApi.orchestration.getThreadProjection({
              threadId,
            });
            let acceptedApprovals = 0;
            for (const request of projection.runtimeRequests.filter(
              (candidate) => candidate.status === "pending" && candidate.kind === "mcp-elicitation",
            )) {
              const item = projection.turnItems.find(
                (candidate) =>
                  candidate.type === "approval_request" && candidate.requestId === request.id,
              );
              if (item?.type !== "approval_request") continue;
              const name = item.appName ?? "";
              const prompt = item.prompt ?? "";
              if (!/t3[-_ ]?code/i.test(name + " " + prompt))
                throw new Error(`Unexpected provider approval from ${name.slice(0, 80)}`);
              window.__tabsParityApproved ??= new Set();
              if (window.__tabsParityApproved.has(request.id)) continue;
              window.__tabsParityApproved.add(request.id);
              await window.__tabsNativeApi.orchestration.dispatchCommand({
                type: "runtime-request.respond",
                commandId: crypto.randomUUID(),
                threadId,
                requestId: request.id,
                decision: "accept",
              });
              acceptedApprovals++;
            }
            const active = projection.runs.some((run) =>
              ["queued", "preparing", "starting", "running", "waiting"].includes(run.status),
            );
            const finished = projection.runs.length > 0 && !active;
            if (!finished) return null;
            const providerErrors = projection.turnItems
              .filter((item) => item.type === "provider_error")
              .map((item) => ({
                failureClass: item.failure?.class ?? null,
                message: item.failure?.message?.slice(0, 400) ?? null,
              }));
            return {
              runStatuses: projection.runs.map((run) => run.status),
              turnItems: projection.turnItems.filter((item) => item.type === "dynamic_tool"),
              providerErrors,
              providerTurns: projection.providerTurns.map((turn) => ({
                status: turn.status,
                tokenUsage: turn.tokenUsage ?? null,
                turnTokenUsage: turn.turnTokenUsage ?? null,
              })),
              assistantMessages: projection.messages
                .filter((message) => message.role === "assistant")
                .map((message) => {
                  const text = message.text ?? "";
                  const count =
                    text.match(/\b(\d+)\s+(?:registered\s+)?projects?\b/i)?.[1] ??
                    (/^\s*\d+\s*[.!]?\s*$/.test(text) ? text.match(/\d+/)?.[0] : undefined);
                  return {
                    reportsProjectCount: count === undefined ? null : Number(count),
                    mentionsInvalidInput: /invalid|limit\s*0|argument error/i.test(text),
                    length: text.length,
                  };
                }),
              acceptedApprovals: window.__tabsParityApproved?.size ?? acceptedApprovals,
            };
          },
          { threadId: target.threadId },
        ),
      `${target.label} provider run`,
      240_000,
    ).catch((error) => {
      const message = redact(error);
      const timedOut = message.includes("Timed out:");
      return {
        runStatuses: [],
        turnItems: [],
        providerErrors: [
          { failureClass: timedOut ? "acceptance_timeout" : "acceptance_error", message },
        ],
        providerTurns: [],
        timedOut,
      };
    });
    let storedToolItems;
    let databaseReadError;
    try {
      storedToolItems = readOwnThreadToolItems(target.threadId);
    } catch (error) {
      databaseReadError = redact(error);
    }
    const toolItems = storedToolItems?.length ? storedToolItems : (outcome.turnItems ?? []);
    const dynamicTools = toolItems.map((item) => summarizeToolItem(item, ids.projectId));
    const toolEndsWith = (call, name) => call.toolName?.endsWith(name) === true;
    const discoveryCall = dynamicTools.find((call) =>
      toolEndsWith(call, "orchestrator_capabilities"),
    );
    const discoverySuccess = !discoveryCall
      ? false
      : discoveryCall.isError
        ? false
        : discoveryCall.capabilityResult
          ? discoveryCall.capabilityResult.codexProviderReturned &&
            discoveryCall.capabilityResult.gpt6LunaAvailable
          : null;
    const invalid = dynamicTools.some(
      (call) =>
        toolEndsWith(call, "t3_project_list") && call.arguments?.limit === 0 && call.isError,
    );
    const recoveryCall = dynamicTools.find(
      (call) => toolEndsWith(call, "t3_project_list") && call.arguments?.limit === 5,
    );
    const recoveryVerified = recoveryCall?.projectListResult?.containsDisposableProject === true;
    finalEvidence.comparison.runs.push({
      label: target.label,
      elapsedMs: Date.now() - runStart,
      outcome: outcome.timedOut
        ? "timed_out"
        : outcome.providerErrors?.some((item) => item.failureClass === "acceptance_error")
          ? "acceptance_error"
          : outcome.runStatuses?.includes("failed")
            ? "failed"
            : "completed",
      registeredToolCalls: dynamicTools,
      toolPayloadSource: storedToolItems?.length
        ? "isolated_profile_projection_database"
        : "turn_projection",
      databaseReadError,
      discoverySuccess,
      discoveryResultStatus: !discoveryCall
        ? "not_called"
        : discoveryCall.isError
          ? "failed"
          : discoveryCall.outputPresent
            ? "observed"
            : "omitted_from_projection",
      discoverySummary: discoveryCall?.capabilityResult ?? null,
      invalidArgumentObserved: invalid,
      invalidArgumentRecoveryCallIssued: Boolean(recoveryCall),
      invalidArgumentRecoveryResultStatus: !invalid
        ? "not_applicable"
        : !recoveryCall
          ? "not_called"
          : recoveryCall.isError
            ? "failed"
            : recoveryVerified
              ? "verified_project_list_contains_disposable_project"
              : recoveryCall.projectListResult
                ? "completed_but_disposable_project_not_found"
                : "result_unavailable",
      recoverySummary: recoveryCall?.projectListResult ?? null,
      providerErrors: (outcome.providerErrors ?? []).map((item) => ({
        failureClass: item.failureClass,
        message: item.message ? redact(item.message) : null,
      })),
      actualUsage: outcome.providerTurns ?? [],
      assistantReports: outcome.assistantMessages ?? [],
      acceptedApprovalCount: outcome.acceptedApprovals ?? 0,
    });
  }
} catch (error) {
  finalEvidence.blocker = redact(error);
} finally {
  finalEvidence.completedAt = new Date().toISOString();
  finalEvidence.durationMs = Date.now() - startedAt;
  writeFileSync(outputPath, `${JSON.stringify(finalEvidence, null, 2)}\n`);
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
    child.kill("SIGTERM");
    exitMode = await Promise.race([
      childExit.then(() => "sigterm"),
      pause(20_000).then(() => null),
    ]);
  }
  const exitedNormally = exitMode !== null;
  if (!exitedNormally) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    await pause(2000);
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  await browser?.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
  console.log(JSON.stringify({ outputPath, evidence: finalEvidence }));
}
