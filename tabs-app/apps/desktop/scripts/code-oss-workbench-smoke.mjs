import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
const expectedVersion = JSON.parse(
  await readFile(resolve(desktop, "../../../tabs-code-oss/package.json"), "utf8"),
).version;
assert.equal(
  JSON.parse(await readFile(join(runtime, "package.json"), "utf8")).version,
  expectedVersion,
);
if (appPath) {
  const media = spawnSync(
    "bun",
    [resolve(desktop, "../../scripts/verify-code-oss-media.ts"), join(runtime, "extensions")],
    { encoding: "utf8" },
  );
  assert.equal(media.status, 0, media.stderr || String(media.error));
  console.log(`PASS: packaged extension media ${media.stdout.trim()}`);
}
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
const markdownMarker = "TABS_MARKDOWN_RENDERED_SMOKE";
await writeFile(
  join(workspace, "audit.md"),
  `# ${markdownMarker}\n\nA **rendered** Markdown document.\n`,
);
await writeFile(
  join(workspace, "audit.ipynb"),
  JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { language_info: { name: "python" } },
    cells: [
      {
        cell_type: "code",
        id: "smoke",
        metadata: {},
        source: ["1"],
        execution_count: 1,
        outputs: [{ output_type: "stream", name: "stdout", text: ["TABS_NOTEBOOK_OUTPUT_SMOKE"] }],
      },
    ],
  }),
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
  [
    ...(appPath ? [] : [join(desktop, "dist-electron/main.js")]),
    // The isolated smoke profile must not prompt for access to the login Keychain.
    ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
    `--remote-debugging-port=${port}`,
  ],
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
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  ws.onclose = (event) => rejectPending(new Error(`CDP closed (${event.code})`));
  ws.onerror = () => rejectPending(new Error("CDP connection failed"));
  const client = {
    send(method, params = {}) {
      return new Promise((resolveRequest, reject) => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          const detail =
            method === "Runtime.evaluate"
              ? ` (${String(params.expression).replaceAll(/\s+/g, " ").slice(0, 120)})`
              : "";
          reject(new Error(`${method}${detail} timed out`));
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
let browserServer;
async function press(key, code, windowsVirtualKeyCode) {
  await workbench.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
  });
  await workbench.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
  });
}
async function renderedText(marker) {
  const activeWebviewHosts = new Set(
    await workbench.evaluate(`[...document.querySelectorAll("iframe.webview")]
    .filter(frame => frame.src.startsWith("vscode-webview:") && frame.checkVisibility({visibilityProperty: true}))
    .map(frame => new URL(frame.src).host)`),
  );
  if (activeWebviewHosts.size === 0) return false;
  const children = (await targets()).filter(
    (target) => target.type === "iframe" && target.webSocketDebuggerUrl,
  );
  const inspect = async (client) => {
    const snapshot = await client.send("DOMSnapshot.captureSnapshot", { computedStyles: [] });
    return snapshot.documents.some(({ documentURL, layout }) => {
      const documentUrl = snapshot.strings[documentURL];
      if (!documentUrl?.startsWith("vscode-webview:")) return false;
      const url = new URL(documentUrl);
      return (
        activeWebviewHosts.has(url.host) &&
        layout.text.some((index) => snapshot.strings[index]?.includes(marker))
      );
    });
  };
  if (await inspect(workbench)) return true;
  for (const target of children) {
    const client = await connect(target);
    try {
      if (await inspect(client)) return true;
    } finally {
      client.close();
      clients.splice(clients.indexOf(client), 1);
    }
  }
  return false;
}
async function screenshot(name) {
  if (!evidence) return;
  const result = await workbench.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(evidence, `${name}.png`), Buffer.from(result.data, "base64"));
}
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
  await poll(
    () =>
      shell.evaluate(`(() => {
      if (location.hash.includes("/settings")) {
        location.hash = "#/";
        return false;
      }
      const skip = [...document.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "Skip setup",
      );
      if (skip) {
        skip.click();
        return false;
      }
      return Boolean(document.querySelector('[aria-label="New tab"], [aria-label="Open projects"]'));
    })()`),
    "desktop workspace after first-run setup",
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
  const selectCodeProject = (title) =>
    poll(
      () =>
        shell.evaluate(`(() => {
      const title = ${JSON.stringify(title)};
      const matches = element => element?.innerText.split("\\n").includes(title);
      const tabs = [...document.querySelectorAll('[data-slot="workspace-project-tab"]')];
      const current = tabs.find(tab => tab.getAttribute("data-active") === "true");
      if (!matches(current)) {
        const tab = tabs.find(matches);
        const recent = [...document.querySelectorAll("button")].find(
          button => matches(button) && button.getClientRects().length,
        );
        (tab ?? recent)?.click();
        return false;
      }
      const code = document.querySelector('[role="tab"][data-tool-kind="code"]');
      if (code?.getAttribute("aria-selected") === "true") return true;
      code?.click();
      return false;
    })()`),
      `Code tool selected for ${title}`,
    );
  await selectCodeProject("Workbench Smoke");
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
  const openFile = (relativePath, navigationNonce) =>
    shell.evaluate(
      `window.desktopBridge.openCodeFile(${JSON.stringify({ projectId, relativePath, navigationNonce })})`,
    );
  const sourceContains = (client, marker) =>
    client.evaluate(
      `[...document.querySelectorAll(".part.editor .monaco-editor .view-lines")].some(lines => lines.getBoundingClientRect().height > 0 && lines.textContent.includes(${JSON.stringify(marker)}))`,
    );
  const quickInput = '.quick-input-widget:not([style*="display: none"])';
  const findRow = (text) =>
    workbench.evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(`${quickInput} .monaco-list-row`)})).flatMap(row => {
        if (!row.innerText.includes(${JSON.stringify(text)})) return [];
        const {x,y,width,height} = row.getBoundingClientRect();
        return width && height ? [{x:x+width/2,y:y+height/2}] : [];
      })[0]`,
    );
  const selectRow = async (text) => {
    const point = await poll(() => findRow(text), text, 20_000);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await workbench.send("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
    }
  };
  const command = async (query, label) => {
    assert.equal(
      await shell.evaluate(
        `window.desktopBridge.runCodeCommand(${JSON.stringify(projectId)}, "workbench.action.showCommands")`,
      ),
      true,
    );
    await poll(
      () => workbench.evaluate(`document.activeElement?.value === ">"`),
      "command palette input",
    );
    await workbench.send("Input.insertText", { text: query });
    await selectRow(label);
  };
  const reopen = async (editorType) => {
    await command("Reopen Editor With", "View: Reopen Editor With...");
    await selectRow(editorType);
    await poll(
      () =>
        workbench.evaluate(
          `document.querySelector(".breadcrumbs-editor-type")?.textContent.includes(${JSON.stringify(editorType)})`,
        ),
      `${editorType} active`,
    );
  };

  await openFile("audit.md", 2);
  await poll(() => sourceContains(workbench, markdownMarker), "Markdown source");
  const renderedParagraph = "Markdown document.";
  await reopen("Markdown Editor");
  await poll(() => renderedText(renderedParagraph), "rendered Markdown Editor contents");
  await screenshot("markdown-editor");
  await reopen("Markdown Preview");
  await poll(() => renderedText(renderedParagraph), "rendered Markdown Preview contents");
  await screenshot("markdown-preview");
  await reopen("Text Editor");
  // A webview-to-text switch can leave Monaco waiting for a compositor frame.
  // Capture the actual viewport before asserting the rendered source.
  await workbench.send("Page.captureScreenshot", { format: "png" });
  await poll(
    () => sourceContains(workbench, markdownMarker),
    "Markdown source after switching back",
  );
  console.log("PASS: Markdown Editor and Preview render actual content and switch back to source");

  await openFile("audit.ipynb", 3);
  await poll(() => renderedText("TABS_NOTEBOOK_OUTPUT_SMOKE"), "notebook rendered output");
  await screenshot("notebook");
  console.log("PASS: bundled notebook output renderer");

  // Use HTTP so the browser exercises its normal network and iframe path.
  const { createServer: createHttpServer } = await import("node:http");
  browserServer = createHttpServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<!doctype html><title>Tabs smoke</title><h1>TABS_BROWSER_RENDERED_SMOKE</h1>");
  });
  await new Promise((resolveListen, reject) => {
    browserServer.once("error", reject);
    browserServer.listen(0, "127.0.0.1", resolveListen);
  });
  await command("Open Integrated Browser", "Open Integrated Browser");
  const browserUrl = `http://127.0.0.1:${browserServer.address().port}/`;
  const browserInput = ".browser-url-display";
  await poll(
    () => workbench.evaluate(`!!document.querySelector(${JSON.stringify(browserInput)})`),
    "browser address bar",
  );
  await workbench.evaluate(`document.querySelector(${JSON.stringify(browserInput)}).focus()`);
  await workbench.send("Input.insertText", { text: browserUrl });
  await press("Enter", "Enter", 13);
  await poll(async () => {
    const page = (await targets()).find((target) => target.url === browserUrl);
    if (!page) return false;
    const client = await connect(page);
    try {
      return await client.evaluate(
        'document.querySelector("h1")?.innerText === "TABS_BROWSER_RENDERED_SMOKE"',
      );
    } finally {
      client.close();
      clients.splice(clients.indexOf(client), 1);
    }
  }, "integrated browser rendered page");
  await screenshot("browser");
  console.log("PASS: integrated browser loads a real local page");

  const secondProjectId = "workbench-smoke-second";
  const secondWorkspace = join(temporary, "second");
  await mkdir(secondWorkspace);
  await writeFile(join(secondWorkspace, "audit.ts"), "export const onlyInSecondProject = true;\n");
  await shell.evaluate(
    `window.__tabsNativeApi.orchestration.dispatchCommand(${JSON.stringify({
      type: "project.create",
      commandId: `smoke-second-${Date.now()}`,
      projectId: secondProjectId,
      title: "Second Workbench Smoke",
      workspaceRoot: secondWorkspace,
    })})`,
  );
  await shell.evaluate(`document.querySelector('[aria-label="New tab"]').click()`);
  await selectCodeProject("Second Workbench Smoke");
  const second = await connect(
    await poll(
      async () =>
        (await targets()).find((target) =>
          target.url.includes(`tabs_projectId=${secondProjectId}&`),
        ),
      "second workbench target",
    ),
  );
  await poll(
    () =>
      shell.evaluate(
        `window.desktopBridge.runCodeCommand(${JSON.stringify(secondProjectId)}, "workbench.action.terminal.new")`,
      ),
    "second project command bridge",
  );
  await shell.evaluate(
    `window.desktopBridge.openCodeFile(${JSON.stringify({ projectId: secondProjectId, relativePath: "audit.ts", navigationNonce: 1 })})`,
  );
  await poll(() => sourceContains(second, "onlyInSecondProject"), "second project's own file");
  await poll(
    () => second.evaluate('!!document.querySelector(".terminal-wrapper .xterm")'),
    "second project's terminal",
  );
  await openFile("audit.ts", 4);
  await selectCodeProject("Workbench Smoke");
  await poll(
    () => sourceContains(workbench, "auditMarker"),
    "first project's own file after returning",
  );
  assert.equal(await sourceContains(workbench, "onlyInSecondProject"), false);
  console.log("PASS: two real workbenches route file opens and commands to their own projects");

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
          markdownEditorRendered: true,
          markdownPreviewRendered: true,
          notebookRendered: true,
          browserRendered: true,
          twoProjectsIsolated: true,
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
  browserServer?.close();
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
  if (evidence) {
    await writeFile(join(evidence, "process.log"), await readFile(join(temporary, "process.log")));
    const trace = await readFile(
      join(temporary, "home", "userdata", "code-host-manager.log"),
    ).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (trace) await writeFile(join(evidence, "code-host-manager.log"), trace);
  }
  await rm(temporary, { recursive: true, force: true });
  console.log("Owned test process stopped and temporary profile removed.");
}
