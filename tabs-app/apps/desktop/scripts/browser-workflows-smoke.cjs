/* Run with Electron and a bundled browserHostManager module as argv[2].
 * Uses only synthetic cookies, a loopback fixture, and temporary app storage. */
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const temporary =
  process.env.TABS_BROWSER_SMOKE_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "tabs-browser-workflows-"));
fs.mkdirSync(temporary, { recursive: true });
app.setPath("userData", temporary);
app.setName("Tabs Browser Workflow Test");
let window, manager, server;
let finished = false;
const deadline = setTimeout(() => {
  console.error("Native workflow smoke timed out");
  app.exit(1);
}, 60000);
app
  .whenReady()
  .then(async () => {
    const { BrowserHostManager, deriveBrowserPartition } = require(process.argv[2]);
    server = http.createServer((request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<html><body><div id="identity">${(request.headers.cookie || "none").replace(/[<>&]/g, "")}</div><input id="name" onkeydown="if(event.key==='Enter')document.querySelector('#result').textContent='Entered'"><input id="accept" type="checkbox"><select id="choice"><option value="a">A</option><option value="b">B</option></select><button id="go" onclick="document.querySelector('#result').textContent='Done'">Go</button><p id="result">Waiting</p><div style="height:2500px"></div></body></html>`,
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    window = new BrowserWindow({
      width: 1600,
      height: 1000,
      show: false,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
    });
    await window.loadURL("data:text/html,<html><body>Isolated browser workflow test</body></html>");
    window.setIgnoreMouseEvents(true); // Physical pointer movement must not interfere with this isolated harness.
    window.showInactive();
    manager = new BrowserHostManager(() => window);
    for (const [profile, value] of [
      ["smoke-a", "account-a"],
      ["smoke-b", "account-b"],
    ]) {
      await session
        .fromPartition(deriveBrowserPartition({ profileId: profile }))
        .cookies.set({ url, name: "synthetic-account", value });
    }
    await manager.ensureSession({
      projectId: "smoke",
      sessionId: "source",
      initialUrl: url,
      taskId: "task-a",
    });
    manager.setBounds({
      projectId: "smoke",
      sessionId: "source",
      x: 0,
      y: 50,
      width: 1400,
      height: 800,
      visible: true,
    });
    await manager.activateSession({ projectId: "smoke", sessionId: "source" });
    await manager.comparisons.configure({
      projectId: "smoke",
      comparisonId: "smoke",
      sourceSessionId: "source",
      syncNavigation: false,
      syncScroll: false,
      panes: [
        {
          profileId: "smoke-a",
          url,
          viewport: { width: 375, height: 667 },
          bounds: { x: 0, y: 60, width: 375, height: 667 },
        },
        {
          profileId: "smoke-b",
          url,
          viewport: { width: 1366, height: 768 },
          bounds: { x: 400, y: 60, width: 1000, height: 700 },
        },
      ],
    });
    const evaluate = (sessionId, expression) =>
      manager.runAutomation({
        projectId: "smoke",
        sessionId,
        source: "human",
        operation: "evaluate",
        input: { expression },
      });
    const a = await evaluate(
      "comparison-smoke-a",
      "({ width: innerWidth, height: innerHeight, cookie: document.cookie })",
    );
    const b = await evaluate(
      "comparison-smoke-b",
      "({ width: innerWidth, height: innerHeight, cookie: document.cookie })",
    );
    assert.equal(a.width, 375);
    assert.equal(a.height, 667);
    assert.equal(b.width, 1366);
    assert.equal(b.height, 768);
    assert.match(a.cookie, /account-a/);
    assert.doesNotMatch(a.cookie, /account-b/);
    assert.match(b.cookie, /account-b/);
    assert.doesNotMatch(b.cookie, /account-a/);
    console.log("smoke: profiles and viewport dimensions verified");
    const captures = await manager.comparisons.capture("smoke", "smoke");
    assert.deepEqual(
      captures.map((item) => item.tabId),
      ["comparison-smoke-a", "comparison-smoke-b"],
    );
    for (const capture of captures) assert.ok(fs.statSync(capture.path).size > 100);
    console.log("smoke: both screenshots saved");
    await manager.comparisons.close("smoke", "smoke");
    assert.equal(
      (
        await manager.runAutomation({
          projectId: "smoke",
          sessionId: "source",
          source: "human",
          operation: "status",
        })
      ).available,
      true,
    );
    await assert.rejects(
      manager.runAutomation({
        projectId: "smoke",
        sessionId: "source",
        source: "agent",
        taskId: "task-b",
        operation: "status",
      }),
    );
    console.log("smoke: source preserved and task identity enforced");
    await manager.runAutomation({
      projectId: "smoke",
      sessionId: "source",
      source: "human",
      operation: "recordStart",
    });
    await manager.runAutomation({
      projectId: "smoke",
      sessionId: "source",
      source: "human",
      operation: "click",
      input: { selector: "#go" },
    });
    const recorded = await manager.runAutomation({
      projectId: "smoke",
      sessionId: "source",
      source: "human",
      operation: "recordStop",
    });
    assert.ok(
      recorded.steps.some((step) => step.action === "click" && step.selector === "#go"),
      "Native recorder must see the real click",
    );
    assert.ok(
      recorded.steps
        .filter((step) => step.action === "fill")
        .every((step) => step.value === undefined),
      "Recorded inputs must omit private values",
    );
    manager.hideActiveSession(); // The review modal hides its underlying native surface.
    await evaluate("source", "document.querySelector('#result').textContent = 'Waiting'");
    await manager.runAutomation({
      projectId: "smoke",
      sessionId: "source",
      source: "human",
      operation: "click",
      input: { selector: "#go" },
    });
    assert.equal(
      await evaluate("source", "document.querySelector('#result').textContent"),
      "Done",
      "A background tab must accept clicks",
    );
    const result = await manager.runAutomation({
      projectId: "smoke",
      sessionId: "source",
      source: "human",
      operation: "verify",
      input: {
        url,
        steps: [
          { id: "1", action: "fill", selector: "#name", value: "Test input" },
          { id: "press", action: "press", selector: "#name", key: "Enter" },
          { id: "pressed", action: "assertText", selector: "#result", expectedValue: "Entered" },
          { id: "check", action: "check", selector: "#accept" },
          { id: "uncheck", action: "uncheck", selector: "#accept" },
          { id: "select", action: "selectOption", selector: "#choice", value: "b" },
          { id: "selected", action: "assertValue", selector: "#choice", expectedValue: "b" },
          { id: "2", action: "click", selector: "#go" },
          { id: "3", action: "assertValue", selector: "#name", expectedValue: "Test input" },
          { id: "4", action: "assertText", selector: "#result", expectedValue: "Done" },
        ],
      },
    });
    assert.equal(result.status, "pass", result.message);
    assert.ok(fs.existsSync(result.afterScreenshotPath));
    console.log(
      JSON.stringify({
        result: "pass",
        profileIsolation: true,
        viewports: [
          [a.width, a.height],
          [b.width, b.height],
        ],
        comparisonScreenshots: captures.length,
        sourcePreserved: true,
        verification: result.status,
        recordedSteps: recorded.steps.length,
        backgroundClicks: true,
        executedSteps: result.completedSteps,
        assertions: result.passedAssertions,
      }),
    );
  })
  .then(
    () => finish(0),
    (error) => {
      console.error(error);
      finish(1);
    },
  );
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  try {
    manager?.dispose?.();
  } catch {}
  if (window && !window.isDestroyed()) window.destroy();
  server?.close();
  app.once("will-quit", () => {
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
    } catch {}
  });
  process.exitCode = code;
  app.exit(code);
}
