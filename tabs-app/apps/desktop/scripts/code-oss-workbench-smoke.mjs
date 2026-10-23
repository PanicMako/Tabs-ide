import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronPath } from "./electron-launcher.mjs";

// Exercise the real native backend, not merely the outer tabs://app page.
// --app=/path/Tabs.app also runs this gate against a mounted packaged artifact.
const desktop = fileURLToPath(new URL("..", import.meta.url));
const suppliedApp = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--app="))
  ?.slice(6);
const appPath = suppliedApp ? resolve(suppliedApp) : null;
const executable = appPath ? join(appPath, "Contents/MacOS/Tabs") : resolveElectronPath();
const runtime = appPath
  ? join(appPath, "Contents/Resources/tabs-code-oss")
  : resolve(desktop, "../../../tabs-code-oss");
const expectedVersion = JSON.parse(await readFile(join(runtime, "package.json"), "utf8")).version;
const temporary = await mkdtemp(join(tmpdir(), "tabs-workbench-smoke-"));
const evidence = process.env.EVIDENCE_DIR ? resolve(process.env.EVIDENCE_DIR) : null;
if (evidence) await mkdir(evidence, { recursive: true });
const output = await open(join(temporary, "process.log"), "w");
const workspace = join(temporary, "workspace");
await mkdir(workspace);
await writeFile(
  join(workspace, "audit.ts"),
  'export const auditMarker = "embedded workbench smoke";\n',
);
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolvePort(port));
  });
});
const env = {
  ...process.env,
  TABS_HOME: join(temporary, "home"),
  TABS_DESKTOP_USER_DATA_DIR: join(temporary, "profile"),
  VITE_DEV_SERVER_URL: "",
  NODE_ENV: "production",
};
delete env.ELECTRON_RUN_AS_NODE;
if (appPath) delete env.TABS_CODE_OSS_BUILD_DIR;
else env.TABS_CODE_OSS_BUILD_DIR = runtime;
const child = spawn(
  executable,
  [...(appPath ? [] : [join(desktop, "dist-electron/main.js")]), `--remote-debugging-port=${port}`],
  {
    cwd: desktop,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", output.fd, output.fd],
  },
);
let exited = false;
const exit = new Promise((resolveExit) => {
  child.once("exit", (code, signal) => {
    exited = true;
    resolveExit({ code, signal });
  });
  child.once("error", (error) => {
    exited = true;
    resolveExit({ error: error.message });
  });
});
const clients = [];
async function poll(probe, label, timeout = 60_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (exited) throw new Error(`App exited before ${label}`);
    const result = await probe();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.onopen = resolveOpen;
    ws.onerror = reject;
  });
  const pending = new Map();
  let next = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const client = {
    send(method, params = {}) {
      return new Promise((resolveRequest, reject) => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, 60_000);
        pending.set(id, { resolve: resolveRequest, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const value = await this.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (value.exceptionDetails)
        throw new Error(
          value.exceptionDetails.exception?.description ?? value.exceptionDetails.text,
        );
      return value.result.value;
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("CDP closed"));
      }
      pending.clear();
      ws.close();
    },
  };
  clients.push(client);
  return client;
}
const targets = async () => {
  try {
    return await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  } catch {
    return [];
  }
};
let shell;
let workbench;
try {
  const page = await poll(
    async () => (await targets()).find((target) => target.url.startsWith("tabs://app/")),
    "outer renderer",
  );
  shell = await connect(page);
  await poll(
    () => shell.evaluate("Boolean(window.desktopBridge?.ensureCodeSession)"),
    "desktop bridge",
  );
  await shell.evaluate("window.desktopBridge.setConfirmBeforeQuit(false)");
  const state = await shell.evaluate("window.desktopBridge.getCodeHostState()");
  assert.equal(state.available, true, `Embedded backend unavailable: ${state.reason}`);
  assert.equal(state.version, expectedVersion);
  assert.equal(state.mode, "embedded");
  console.log(`PASS: complete embedded backend started (${state.version})`);
  // Wait for the outer application's initial project synchronization. Register
  // this project through the real backend so React does not evict a phantom session.
  await poll(
    () => shell.evaluate("Boolean(window.__tabsNativeApi?.orchestration)"),
    "workspace API",
  );
  await poll(
    () =>
      shell.evaluate(`(async () => {
    try { return Boolean(await window.__tabsNativeApi.orchestration.getSnapshot()); }
    catch (error) { if (String(error).includes("initial snapshot")) return false; throw error; }
  })()`),
    "initial project snapshot",
  );
  const projectId = "workbench-smoke";
  await shell.evaluate(
    `window.__tabsNativeApi.orchestration.dispatchCommand(${JSON.stringify({ type: "project.create", commandId: `smoke-${Date.now()}`, projectId: "workbench-smoke", title: "Workbench Smoke", workspaceRoot: workspace })})`,
  );
  await poll(
    () =>
      shell.evaluate(
        `(async () => { const s = await window.__tabsNativeApi.orchestration.getSnapshot(); return s.projects.some(p => p.id === ${JSON.stringify(projectId)}); })()`,
      ),
    "registered project",
  );
  await shell.evaluate(
    `window.desktopBridge.ensureCodeSession(${JSON.stringify({ projectId, workspaceRoot: workspace })})`,
  );
  await shell.evaluate(
    `window.desktopBridge.activateCodeSession(${JSON.stringify({ projectId })})`,
  );
  await shell.evaluate(
    `window.desktopBridge.setCodeBounds(${JSON.stringify({ projectId, x: 15, y: 100, width: 1100, height: 700, visible: true })})`,
  );
  const target = await poll(
    async () =>
      (await targets()).find(
        (target) =>
          target.url.includes(`tabs_projectId=${projectId}`) && !target.url.startsWith("devtools"),
      ),
    "native workbench target",
  );
  assert.equal(
    await realpath(decodeURIComponent(new URL(target.url).pathname)),
    await realpath(join(runtime, "out/vs/code/electron-browser/workbench/workbench-dev.html")),
    "Workbench must load from the selected artifact, not a source/runtime fallback",
  );
  workbench = await connect(target);
  await poll(
    () => workbench.evaluate('Boolean(document.querySelector(".monaco-workbench .part.editor"))'),
    "editor DOM",
  );
  await poll(
    () =>
      shell.evaluate(
        `window.desktopBridge.runCodeCommand(${JSON.stringify(projectId)}, "workbench.action.terminal.new")`,
      ),
    "extension command bridge",
  );
  await poll(
    () => workbench.evaluate('Boolean(document.querySelector(".terminal-wrapper .xterm"))'),
    "integrated terminal",
  );
  await workbench.evaluate(
    'document.querySelector(".terminal-wrapper .xterm-helper-textarea").focus()',
  );
  const terminalResult = join(workspace, "terminal-result.txt");
  const quotedResult = "'" + terminalResult.replaceAll("'", "'\\''") + "'";
  await workbench.send("Input.insertText", { text: `printf TABS_PTY_SMOKE_OK > ${quotedResult}` });
  await workbench.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await workbench.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await poll(
    async () => (await readFile(terminalResult, "utf8").catch(() => "")) === "TABS_PTY_SMOKE_OK",
    "real PTY command output",
  );
  console.log("PASS: bundled workbench extension and real integrated terminal command");
  await shell.evaluate(
    `window.desktopBridge.openCodeFile(${JSON.stringify({ projectId, relativePath: "audit.ts", navigationNonce: 1 })})`,
  );
  await poll(
    () =>
      workbench.evaluate(
        'document.querySelector(".monaco-editor .view-lines")?.textContent.includes("auditMarker")',
      ),
    "real editor file contents",
  );
  const radius = await workbench.evaluate(
    'getComputedStyle(document.querySelector(".monaco-workbench")).getPropertyValue("--vscode-cornerRadius-xLarge").trim()',
  );
  assert.equal(radius, "36px", "Tabs fork CSS must load in the actual workbench");
  console.log("PASS: visible Code session, real file contents and Tabs radius CSS");
  if (evidence) {
    const image = await workbench.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidence, "workbench.png"), Buffer.from(image.data, "base64"));
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          version: state.version,
          backendAvailable: true,
          fileOpened: true,
          radius,
          terminalOpened: true,
          terminalCommandExecuted: true,
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  if (evidence && workbench) {
    try {
      const image = await workbench.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, "failure.png"), Buffer.from(image.data, "base64"));
      const diagnostics = await workbench.evaluate(
        '({text:document.body.innerText,editors:[...document.querySelectorAll(".monaco-editor")].map(e=>({text:e.textContent,classes:e.className,height:e.getBoundingClientRect().height})),url:location.href})',
      );
      await writeFile(join(evidence, "failure.json"), JSON.stringify(diagnostics, null, 2));
    } catch {}
  }
  if (evidence) await writeFile(join(evidence, "failure.txt"), String(error));
  throw error;
} finally {
  for (const client of clients) client.close();
  if (!exited) child.kill("SIGTERM");
  let timeout;
  await Promise.race([
    exit,
    new Promise((resolveWait) => {
      timeout = setTimeout(resolveWait, 15_000);
    }),
  ]);
  clearTimeout(timeout);
  if (!exited) {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
    await exit;
  }
  await output.close();
  if (evidence)
    await writeFile(join(evidence, "process.log"), await readFile(join(temporary, "process.log")));
  await rm(temporary, { recursive: true, force: true });
  console.log("Owned test process stopped and temporary profile removed.");
}
