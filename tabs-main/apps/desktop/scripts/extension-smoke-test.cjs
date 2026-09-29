/* Run with Electron and bundled extension manager module as argv[2], temporary dir as argv[3].
 * Exercises a real packaged Tabs extension in actual Electron WebContentsView with strict security. */
const { app, BrowserWindow, protocol } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

// Register custom protocol as standard, secure, and fetch-capable BEFORE app.whenReady().
// This matches the production desktop registration in apps/desktop/src/main.ts.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "tabs-extension",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const bundlePath = process.argv[2];
const temporary =
  process.argv[3] || fs.mkdtempSync(path.join(require("node:os").tmpdir(), "tabs-ext-smoke-"));
const userDataDir = path.join(temporary, "user-data");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
app.setName("Tabs Extension Electron Smoke");

let window = null;
let finished = false;

const deadline = setTimeout(() => {
  console.error("FATAL: Extension Electron smoke test timed out after 60s");
  finish(1);
}, 60000);

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  try {
    if (window && !window.isDestroyed()) window.destroy();
  } catch {}
  process.exitCode = code;
  app.exit(code);
}

async function waitForText(webContents, selector, timeout = 5000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const text = await webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)})?.textContent || ""`,
    );
    if (text) return text;
    await new Promise((r) => setTimeout(r, 25));
  }
  return await webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)})?.textContent || ""`,
  );
}

app.whenReady().then(async () => {
  try {
    console.log("=== STARTING REAL ELECTRON EXTENSION SMOKE TEST ===");
    console.log("Electron version:", process.versions.electron);
    console.log("Chrome version:", process.versions.chrome);
    console.log("Node version:", process.versions.node);

    const { ExtensionViewManager, NativeViewStackCoordinator, packTabsext } = require(bundlePath);
    const root = path.resolve(__dirname, "../../..");
    const helloExtensionDir = path.join(root, "examples/hello-extension");

    // -------------------------------------------------------------
    // Step 1: Package actual Tabs extension into .tabsext archive
    // -------------------------------------------------------------
    const archivePath = path.join(temporary, "tabs-example.hello-0.1.0.tabsext");
    const packStart = performance.now();
    const packed = await packTabsext({
      directory: helloExtensionDir,
      destination: archivePath,
      tabsVersion: "1.3.17",
    });
    const packDurationMs = performance.now() - packStart;
    assert.equal(packed.id, "tabs-example.hello", "Packaged extension ID must match manifest");
    assert.ok(fs.existsSync(archivePath), "Archive .tabsext file must exist on disk");
    assert.ok(packed.digest && packed.digest.length === 64, "Package digest must be valid SHA-256");
    console.log(
      `[1/13] Packaged .tabsext created successfully (${packed.id}, version ${packed.manifest.version}, digest ${packed.digest.slice(0, 16)}... in ${packDurationMs.toFixed(1)}ms)`,
    );

    // -------------------------------------------------------------
    // Step 2: Initialize host BrowserWindow & NativeViewStackCoordinator
    // -------------------------------------------------------------
    window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const viewErrorsReceived = [];
    const origSend = window.webContents.send.bind(window.webContents);
    window.webContents.send = (channel, ...args) => {
      if (channel === "desktop:extension:view-error") {
        viewErrorsReceived.push(args[0]);
      }
      return origSend(channel, ...args);
    };

    class TrackedCoordinator extends NativeViewStackCoordinator {
      attachedViews = [];
      attachToolView(view) {
        if (!this.attachedViews.includes(view)) {
          this.attachedViews.push(view);
        }
        super.attachToolView(view);
      }
      detachToolView(view) {
        const idx = this.attachedViews.indexOf(view);
        if (idx !== -1) this.attachedViews.splice(idx, 1);
        super.detachToolView(view);
      }
    }
    const coordinator = new TrackedCoordinator({ getWindow: () => window });

    const manager = new ExtensionViewManager(
      () => window,
      coordinator,
      path.join(temporary, "installed.json"),
      "1.3.17",
      true,
      { encrypt: (b) => b, decrypt: (b) => b },
    );
    console.log("[2/13] Host BrowserWindow, ViewCoordinator, and ExtensionViewManager initialized");

    // -------------------------------------------------------------
    // Step 3: Install packaged extension archive into isolated manager
    // -------------------------------------------------------------
    const installStart = performance.now();
    const installed = await manager.installLocalPackage(archivePath);
    const installDurationMs = performance.now() - installStart;
    assert.equal(installed.id, "tabs-example.hello");
    assert.equal(installed.source, "local-package");
    assert.equal(installed.manifest.name, "hello");
    console.log(
      `[3/13] Installed local package ${installed.id} into isolated manager (${installDurationMs.toFixed(1)}ms)`,
    );

    // -------------------------------------------------------------
    // Step 4: Configure assignment & multi-profile scopes
    // -------------------------------------------------------------
    manager.addProfile(installed.id, "profile-smoke-2", "Profile Two", "project");
    manager.setAssignment(installed.id, {
      extensionId: installed.id,
      enabledGlobally: false,
      enabledProjectIds: ["project-smoke-1", "project-smoke-2"],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: {
        "project-smoke-1": "default",
        "project-smoke-2": "profile-smoke-2",
      },
      storageGrantedProjectIds: ["project-smoke-1", "project-smoke-2"],
      workspaceReadGrantedProjectIds: ["project-smoke-1"],
    });
    console.log(
      "[4/13] Assignment and profiles configured for project-smoke-1 and project-smoke-2",
    );

    // -------------------------------------------------------------
    // Step 5: Cold view activation & high-precision startup measurement
    // -------------------------------------------------------------
    const coldStart = performance.now();
    await manager.activate({
      projectId: "project-smoke-1",
      extensionId: installed.id,
      toolId: "hello",
      profileId: "default",
      activationId: "act-smoke-1",
    });
    const coldDurationMs = performance.now() - coldStart;

    let currentView = coordinator.attachedViews[coordinator.attachedViews.length - 1];
    assert.ok(currentView, "WebContentsView must be attached to coordinator");
    console.log(
      `[5/13] Cold view activation succeeded in ${coldDurationMs.toFixed(2)}ms (WebContentsView attached)`,
    );

    // -------------------------------------------------------------
    // Step 6: Positive assertion - Actual UI load & DOM content verification
    // -------------------------------------------------------------
    const currentUrl = currentView.webContents.getURL();
    assert.match(
      currentUrl,
      /^tabs-extension:\/\/tabs-example\.hello\/dist\/index\.html\?project=project-smoke-1&profile=default$/,
      "WebContents URL must match custom protocol origin and parameters",
    );

    const headingText = await waitForText(currentView.webContents, "h1");
    assert.equal(
      headingText,
      "Hello from a Tabs extension",
      "Heading text must render matching hello-extension HTML",
    );

    const projectText = await waitForText(currentView.webContents, "#project");
    assert.equal(projectText, "project-smoke-1", "DOM #project must match activation projectId");

    const profileText = await waitForText(currentView.webContents, "#profile");
    assert.equal(profileText, "default", "DOM #profile must match activation profileId");
    console.log(
      `[6/13] UI DOM verified: heading="${headingText}", project="${projectText}", profile="${profileText}"`,
    );

    // -------------------------------------------------------------
    // Step 7: Renderer memory measurement via Chromium process metrics
    // -------------------------------------------------------------
    const osPid = currentView.webContents.getOSProcessId();
    assert.ok(osPid > 0, "Renderer OS PID must be a valid positive integer");
    const appMetrics = app.getAppMetrics();
    const rendererMetric = appMetrics.find((m) => m.pid === osPid);
    assert.ok(rendererMetric, "app.getAppMetrics() must contain the renderer process entry");
    const workingSetKb = rendererMetric.memory.workingSetSize;
    const peakWorkingSetKb = rendererMetric.memory.peakWorkingSetSize;
    console.log(
      `[7/13] Renderer process memory: PID ${osPid}, workingSet: ${(workingSetKb / 1024).toFixed(2)} MB (${workingSetKb} KB), peak: ${(peakWorkingSetKb / 1024).toFixed(2)} MB (${peakWorkingSetKb} KB)`,
    );

    // -------------------------------------------------------------
    // Step 8: Negative assertion - Node and Electron APIs unavailable in guest content
    // -------------------------------------------------------------
    const apiIsolation = await currentView.webContents.executeJavaScript(`
      ({
        hasProcess: typeof process !== "undefined",
        hasRequire: typeof require !== "undefined",
        hasBuffer: typeof Buffer !== "undefined",
        hasGlobal: typeof global !== "undefined",
        windowProcess: typeof window.process,
        windowRequire: typeof window.require,
        windowElectron: typeof window.electron,
        hasTabsExtension: typeof window.tabsExtension === "object",
        hasStorage: typeof window.tabsExtension?.storage === "object",
        hasWorkspace: typeof window.tabsExtension?.workspace === "object",
        hasGit: typeof window.tabsExtension?.git === "object",
        hasNetwork: typeof window.tabsExtension?.network === "object",
        hasLogic: typeof window.tabsExtension?.logic === "object"
      })
    `);

    assert.equal(apiIsolation.hasProcess, false, "Node process global must NOT exist in renderer");
    assert.equal(apiIsolation.hasRequire, false, "Node require global must NOT exist in renderer");
    assert.equal(apiIsolation.hasBuffer, false, "Node Buffer global must NOT exist in renderer");
    assert.equal(apiIsolation.hasGlobal, false, "Node global global must NOT exist in renderer");
    assert.equal(apiIsolation.windowProcess, "undefined", "window.process must be undefined");
    assert.equal(apiIsolation.windowRequire, "undefined", "window.require must be undefined");
    assert.equal(apiIsolation.windowElectron, "undefined", "window.electron must be undefined");
    assert.equal(
      apiIsolation.hasTabsExtension,
      true,
      "tabsExtension contextBridge API must be exposed",
    );
    assert.equal(apiIsolation.hasStorage, true, "tabsExtension.storage must be exposed");
    assert.equal(apiIsolation.hasWorkspace, true, "tabsExtension.workspace must be exposed");
    assert.equal(apiIsolation.hasGit, true, "tabsExtension.git must be exposed");
    assert.equal(apiIsolation.hasNetwork, true, "tabsExtension.network must be exposed");
    assert.equal(apiIsolation.hasLogic, true, "tabsExtension.logic must be exposed");
    console.log(
      "[8/13] Security isolation verified: Node/Electron globals strictly unavailable, contextBridge properly bound",
    );

    // -------------------------------------------------------------
    // Step 9: Negative assertions - Unauthorized popups, navigation, direct network blocked
    // -------------------------------------------------------------
    // A. Popups blocked via setWindowOpenHandler
    const popupResult = await currentView.webContents.executeJavaScript(`
      window.open("https://unauthorized-popup.example.com/", "_blank") === null
    `);
    assert.equal(popupResult, true, "window.open must be denied and evaluate to null");

    // B. Direct external network requests blocked via CSP & webRequest
    const externalFetch = await currentView.webContents.executeJavaScript(`
      fetch("https://evil.example.com/steal")
        .then(() => "success")
        .catch((err) => "blocked: " + (err.message || String(err)))
    `);
    assert.ok(
      externalFetch.startsWith("blocked:"),
      `Direct external fetch must reject, got: ${externalFetch}`,
    );

    // C. Direct loopback network requests blocked
    const loopbackFetch = await currentView.webContents.executeJavaScript(`
      fetch("http://127.0.0.1:9999/secret")
        .then(() => "success")
        .catch((err) => "blocked: " + (err.message || String(err)))
    `);
    assert.ok(
      loopbackFetch.startsWith("blocked:"),
      `Direct loopback fetch must reject, got: ${loopbackFetch}`,
    );

    // D. Unauthorized navigation blocked via will-navigate
    const beforeNavUrl = currentView.webContents.getURL();
    await currentView.webContents.executeJavaScript(`
      try { window.location.href = "https://unauthorized-navigation.example.com/"; } catch {}
    `);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(
      currentView.webContents.getURL(),
      beforeNavUrl,
      "Unauthorized top-level navigation must be blocked by will-navigate",
    );
    console.log(
      "[9/13] Restrictions enforced: popups denied, direct network rejected, unauthorized navigation blocked",
    );

    // -------------------------------------------------------------
    // Step 10: Packaging & custom protocol boundary checks
    // -------------------------------------------------------------
    // A. Valid packaged style.css asset is loaded into the document stylesheet list
    const styleLoaded = await currentView.webContents.executeJavaScript(`
      document.styleSheets.length > 0 &&
      Array.from(document.styleSheets).some((s) => s.href && s.href.includes("style.css"))
    `);
    assert.equal(styleLoaded, true, "Packaged style.css stylesheet must be successfully loaded");

    // B. Path traversal escaping package root is rejected by custom protocol handler
    const traversalBlocked = await currentView.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(false);
        img.onerror = () => resolve(true);
        img.src = "tabs-extension://tabs-example.hello/../../package.json";
      })
    `);
    assert.equal(traversalBlocked, true, "Path traversal escaping package root must be rejected");

    // C. Cross-extension protocol access is rejected by custom protocol handler
    const crossExtensionBlocked = await currentView.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(false);
        img.onerror = () => resolve(true);
        img.src = "tabs-extension://unauthorized-extension-id/icon.png";
      })
    `);
    assert.equal(
      crossExtensionBlocked,
      true,
      "Cross-extension custom protocol access must be blocked",
    );
    console.log(
      "[10/13] Protocol boundary verified: only packaged assets load; traversal and foreign origins rejected",
    );

    // -------------------------------------------------------------
    // Step 11: Project/profile switching and stale activation requests
    // -------------------------------------------------------------
    const warmStart = performance.now();
    await manager.activate({
      projectId: "project-smoke-2",
      extensionId: installed.id,
      toolId: "hello",
      profileId: "profile-smoke-2",
      activationId: "act-smoke-2",
    });
    const warmDurationMs = performance.now() - warmStart;

    currentView = coordinator.attachedViews[coordinator.attachedViews.length - 1];
    const proj2 = await waitForText(currentView.webContents, "#project");
    assert.equal(proj2, "project-smoke-2", "Switching project updates view DOM to project-smoke-2");
    const prof2 = await waitForText(currentView.webContents, "#profile");
    assert.equal(prof2, "profile-smoke-2", "Switching profile updates view DOM to profile-smoke-2");

    // Stale activation request: calling hide with previous activationId must NOT hide current view
    manager.hide({ activationId: "act-smoke-1" });
    assert.equal(
      coordinator.attachedViews.includes(currentView),
      true,
      "Stale activationId hide request must NOT detach active view",
    );
    console.log(
      `[11/13] Project/profile switching verified (${warmDurationMs.toFixed(2)}ms warm switch); stale activation ignored`,
    );

    // -------------------------------------------------------------
    // Step 12: Renderer failure produces recoverable host UI
    // -------------------------------------------------------------
    assert.equal(
      viewErrorsReceived.length,
      0,
      "No view-error events should have occurred before crash",
    );
    const crashedContents = currentView.webContents;
    if (typeof crashedContents.forcefullyCrashRenderer === "function") {
      crashedContents.forcefullyCrashRenderer();
    } else {
      process.kill(crashedContents.getOSProcessId(), "SIGKILL");
    }

    // Await render-process-gone handling
    await new Promise((r) => setTimeout(r, 250));

    assert.equal(
      window.isDestroyed(),
      false,
      "Host BrowserWindow must remain open and undamaged after extension renderer crash",
    );
    assert.equal(
      viewErrorsReceived.length,
      1,
      "Host window must receive exactly one desktop:extension:view-error event",
    );
    assert.equal(viewErrorsReceived[0].extensionId, installed.id);
    assert.equal(viewErrorsReceived[0].activationId, "act-smoke-2");
    assert.equal(viewErrorsReceived[0].projectId, "project-smoke-2");
    assert.equal(viewErrorsReceived[0].profileId, "profile-smoke-2");
    assert.match(viewErrorsReceived[0].error, /crashed/);
    assert.equal(
      coordinator.attachedViews.includes(currentView),
      false,
      "Crashed view must be cleanly detached from coordinator",
    );
    console.log(
      `[12/13] Renderer failure handled cleanly: host UI intact, error emitted ("${viewErrorsReceived[0].error}"), view detached`,
    );

    // -------------------------------------------------------------
    // Step 13: Host recovery - Re-activate new view after crash
    // -------------------------------------------------------------
    const recoveryStart = performance.now();
    await manager.activate({
      projectId: "project-smoke-1",
      extensionId: installed.id,
      toolId: "hello",
      profileId: "default",
      activationId: "act-smoke-3",
    });
    const recoveryDurationMs = performance.now() - recoveryStart;

    const recoveredView = coordinator.attachedViews[coordinator.attachedViews.length - 1];
    assert.ok(recoveredView, "Recovered view must be attached to coordinator");
    assert.equal(recoveredView.webContents.isDestroyed(), false);
    const recoveredHeading = await waitForText(recoveredView.webContents, "h1");
    assert.equal(recoveredHeading, "Hello from a Tabs extension");
    console.log(
      `[13/13] Host recovery confirmed: new WebContentsView successfully activated and functional (${recoveryDurationMs.toFixed(2)}ms)`,
    );

    // -------------------------------------------------------------
    // Final Summary & Performance Report
    // -------------------------------------------------------------
    const report = {
      test: "real-electron-extension-smoke",
      status: "PASS",
      timestamp: new Date().toISOString(),
      environment: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
      metrics: {
        packageCreationMs: Number(packDurationMs.toFixed(2)),
        packageInstallMs: Number(installDurationMs.toFixed(2)),
        coldViewStartupMs: Number(coldDurationMs.toFixed(2)),
        warmViewSwitchMs: Number(warmDurationMs.toFixed(2)),
        postCrashRecoveryMs: Number(recoveryDurationMs.toFixed(2)),
        rendererProcess: {
          osPid,
          workingSetKb,
          workingSetMb: Number((workingSetKb / 1024).toFixed(2)),
          peakWorkingSetKb,
          peakWorkingSetMb: Number((peakWorkingSetKb / 1024).toFixed(2)),
        },
      },
      measurementMethod: {
        startup:
          "High-resolution performance.now() timer measuring duration from ExtensionViewManager.activate() invocation to WebContents load completion and DOM confirmation.",
        memory:
          "Chromium process metrics queried via Electron app.getAppMetrics() matching the guest WebContents OS process ID (webContents.getOSProcessId()), recording resident working set size and peak working set.",
      },
      limitations: [
        "Chromium base renderer overhead: The working set (~60-90 MB on macOS arm64) reflects the full Chromium renderer process footprint (Blink engine, V8 heap VM, compositor pipeline, and IPC bindings) rather than isolated extension DOM/script memory.",
        "Cold vs. warm cache: The first activation initializes session partitions, custom file protocols, and V8 bytecode caches; subsequent view switches benefit from existing warm process state.",
        "Off-screen rendering: In automated headless/inactive test window runs, GPU presentation swapchain buffers differ from an actively focused, full-screen composited user display window.",
      ],
      assertionsVerified: [
        "Actual packaged .tabsext archive creation and integrity verification",
        "Local package installation into isolated ExtensionViewManager",
        "Multi-project and multi-profile assignment configuration",
        "Real WebContentsView UI load and DOM rendering via custom tabs-extension:// protocol",
        "Strict unavailability of Node.js and Electron APIs in guest renderer content",
        "ContextBridge exposure of typed tabsExtension APIs",
        "Denial of unauthorized window.open popups via setWindowOpenHandler",
        "Rejection of direct external and loopback network requests via CSP and webRequest",
        "Prevention of unauthorized top-level navigation via will-navigate",
        "Packaging boundaries: custom protocol loads only packaged assets, blocks traversal and foreign origins",
        "Project and profile switching dynamically updating replacement view DOM",
        "Stale activation requests cannot detach or interfere with replacement view",
        "Isolated crash containment: renderer crash emits view-error event without crashing host window",
        "Recoverable host UI: host cleanly activates replacement view after renderer crash",
      ],
    };

    console.log("\n=======================================================");
    console.log("ELECTRON EXTENSION SMOKE TEST REPORT:");
    console.log(JSON.stringify(report, null, 2));
    console.log("=======================================================\n");

    finish(0);
  } catch (error) {
    console.error("\nFATAL ERROR in extension smoke test:", error);
    finish(1);
  }
});
