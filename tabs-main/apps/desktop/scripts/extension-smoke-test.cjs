/* Run with Electron and bundled extension manager module as argv[2], temporary dir as argv[3].
 * Exercises a real packaged Tabs extension in actual Electron WebContentsView with strict security. */
const { app, BrowserWindow, protocol } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
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
let probeServer = null;
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
  try {
    probeServer?.close();
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
    const coldActivationMs = performance.now() - coldStart;

    let currentView = coordinator.attachedViews[coordinator.attachedViews.length - 1];
    assert.ok(currentView, "WebContentsView must be attached to coordinator");
    console.log(
      `[5/13] Cold view activation succeeded in ${coldActivationMs.toFixed(2)}ms (WebContentsView attached)`,
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
    const coldDurationMs = performance.now() - coldStart;
    console.log(
      `[6/13] UI DOM verified: heading="${headingText}", project="${projectText}", profile="${profileText}" (${coldDurationMs.toFixed(2)}ms from activation start)`,
    );

    // -------------------------------------------------------------
    // Step 7: Renderer memory measurement via Chromium process metrics
    // -------------------------------------------------------------
    const osPid = currentView.webContents.getOSProcessId();
    assert.ok(osPid > 0, "Renderer OS PID must be a valid positive integer");
    const hostPid = window.webContents.getOSProcessId();
    if (hostPid > 0) {
      assert.notEqual(osPid, hostPid, "Extension and host must not share a renderer process");
    }
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

    // B. Use a live local listener: a closed port would reject even without the security policy.
    let directRequests = 0;
    probeServer = http.createServer((_request, response) => {
      directRequests++;
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("UNAUTHORIZED-NETWORK-RESPONSE");
    });
    await new Promise((resolve) => probeServer.listen(0, "127.0.0.1", resolve));
    const probeUrl = `http://127.0.0.1:${probeServer.address().port}/secret`;

    // C. Direct loopback network requests must not reach the listening server.
    const loopbackFetch = await currentView.webContents.executeJavaScript(`
      fetch(${JSON.stringify(probeUrl)})
        .then((response) => response.text())
        .catch((err) => "blocked: " + (err.message || String(err)))
    `);
    assert.ok(
      loopbackFetch.startsWith("blocked:"),
      `Direct loopback fetch must reject, got: ${loopbackFetch}`,
    );
    assert.equal(directRequests, 0, "Direct fetch must not reach the live local listener");

    // D. Unauthorized navigation blocked via will-navigate
    const beforeNavUrl = currentView.webContents.getURL();
    await currentView.webContents.executeJavaScript(`
      try { window.location.href = ${JSON.stringify(probeUrl)}; } catch {}
    `);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(
      currentView.webContents.getURL(),
      beforeNavUrl,
      "Unauthorized top-level navigation must be blocked by will-navigate",
    );
    assert.equal(directRequests, 0, "Navigation must not reach the live local listener");
    await new Promise((resolve) => probeServer.close(resolve));
    probeServer = null;
    console.log(
      "[9/13] Restrictions enforced: popups denied, live-listener fetch and navigation never reached the server",
    );

    // -------------------------------------------------------------
    // Step 10: Packaging & custom protocol boundary checks
    // -------------------------------------------------------------
    // A. Prove a known CSS asset is actually served, not merely listed in document.styleSheets.
    const extensionSession = currentView.webContents.session;
    const ownCss = await extensionSession.fetch(
      "tabs-extension://tabs-example.hello/dist/style.css",
    );
    assert.equal(ownCss.status, 200, "Own packaged stylesheet must be served");
    assert.match(await ownCss.text(), /place-items:\s*center/);
    const computedDisplay = await currentView.webContents.executeJavaScript(
      "getComputedStyle(document.body).display",
    );
    assert.equal(computedDisplay, "grid", "Packaged CSS must affect the rendered document");

    // B. Test the actual asset resolver against a canary outside the installed package.
    const installedDirectory = manager.installed.get(installed.id).directory;
    const outsideCanary = path.join(temporary, "outside-canary.txt");
    fs.writeFileSync(outsideCanary, "PRIVATE-CANARY-NOT-PACKAGED");
    assert.throws(
      () => manager.resolveAsset(installedDirectory, "../../../outside-canary.txt"),
      /Invalid extension asset path/,
      "Path traversal must be rejected before filesystem access",
    );

    // C. Install a real second package, then request its known asset through the first
    // extension's partition. A nonexistent host or an image error would be a false positive.
    const foreignSource = path.join(temporary, "foreign-source");
    fs.cpSync(helloExtensionDir, foreignSource, { recursive: true });
    const foreignManifestPath = path.join(foreignSource, "tabs-extension.json");
    const foreignManifest = JSON.parse(fs.readFileSync(foreignManifestPath, "utf8"));
    foreignManifest.name = "foreign";
    fs.writeFileSync(foreignManifestPath, JSON.stringify(foreignManifest));
    const foreignArchive = path.join(temporary, "tabs-example.foreign.tabsext");
    await packTabsext({
      directory: foreignSource,
      destination: foreignArchive,
      tabsVersion: "1.3.17",
    });
    const foreignInstalled = await manager.installLocalPackage(foreignArchive);
    assert.equal(foreignInstalled.id, "tabs-example.foreign");
    let foreignResponse;
    try {
      foreignResponse = await extensionSession.fetch(
        "tabs-extension://tabs-example.foreign/dist/style.css",
      );
    } catch {
      // A canceled protocol request may reject instead of returning an HTTP response.
    }
    assert.ok(!foreignResponse?.ok, "First extension partition must not read second package");
    console.log(
      "[10/13] Protocol boundary verified: own CSS served, filesystem traversal rejected, installed foreign package denied",
    );

    await currentView.webContents.executeJavaScript(
      'localStorage.setItem("smoke-partition-marker", "first-project-profile")',
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
    currentView = coordinator.attachedViews[coordinator.attachedViews.length - 1];
    const proj2 = await waitForText(currentView.webContents, "#project");
    assert.equal(proj2, "project-smoke-2", "Switching project updates view DOM to project-smoke-2");
    const prof2 = await waitForText(currentView.webContents, "#profile");
    assert.equal(prof2, "profile-smoke-2", "Switching profile updates view DOM to profile-smoke-2");
    const warmDurationMs = performance.now() - warmStart;
    assert.equal(
      await currentView.webContents.executeJavaScript(
        'localStorage.getItem("smoke-partition-marker")',
      ),
      null,
      "Second project/profile partition must not read first partition's browser storage",
    );

    // Stale activation request: calling hide with previous activationId must NOT hide current view
    manager.hide({ activationId: "act-smoke-1" });
    assert.equal(
      coordinator.attachedViews.includes(currentView),
      true,
      "Stale activationId hide request must NOT detach active view",
    );
    const boundsBefore = currentView.getBounds();
    manager.setBounds({
      projectId: "project-smoke-2",
      extensionId: installed.id,
      toolId: "hello",
      profileId: "profile-smoke-2",
      activationId: "act-smoke-1",
      x: 999,
      y: 999,
      width: 999,
      height: 999,
      visible: true,
    });
    assert.deepEqual(
      currentView.getBounds(),
      boundsBefore,
      "Stale bounds must not resize the new view",
    );
    console.log(
      `[11/13] Project/profile partition storage and DOM switch verified (${warmDurationMs.toFixed(2)}ms); stale hide/bounds ignored`,
    );

    // -------------------------------------------------------------
    // Step 12: Renderer failure does not destroy the host window and emits an error.
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
      "Host main process must attempt exactly one desktop:extension:view-error IPC send",
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
      `[12/13] Renderer failure contained: host window survives, IPC send attempted ("${viewErrorsReceived[0].error}"), view detached`,
    );

    // -------------------------------------------------------------
    // Step 13: Manager recovery - Re-activate new view after crash.
    // -------------------------------------------------------------
    const recoveryStart = performance.now();
    await manager.activate({
      projectId: "project-smoke-1",
      extensionId: installed.id,
      toolId: "hello",
      profileId: "default",
      activationId: "act-smoke-3",
    });
    const recoveredView = coordinator.attachedViews[coordinator.attachedViews.length - 1];
    assert.ok(recoveredView, "Recovered view must be attached to coordinator");
    assert.equal(recoveredView.webContents.isDestroyed(), false);
    const recoveredHeading = await waitForText(recoveredView.webContents, "h1");
    assert.equal(recoveredHeading, "Hello from a Tabs extension");
    const recoveryDurationMs = performance.now() - recoveryStart;
    assert.equal(
      await recoveredView.webContents.executeJavaScript(
        'localStorage.getItem("smoke-partition-marker")',
      ),
      "first-project-profile",
      "Returning to the first profile must recover only its own browser storage",
    );
    console.log(
      `[13/13] Manager recovery confirmed: replacement WebContentsView functional with first profile storage (${recoveryDurationMs.toFixed(2)}ms)`,
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
        coldViewActivationMs: Number(coldActivationMs.toFixed(2)),
        coldViewStartupMs: Number(coldDurationMs.toFixed(2)),
        warmViewSwitchMs: Number(warmDurationMs.toFixed(2)),
        postCrashRecoveryMs: Number(recoveryDurationMs.toFixed(2)),
        rendererProcess: {
          osPid,
          hostPid,
          workingSetKb,
          workingSetMb: Number((workingSetKb / 1024).toFixed(2)),
          peakWorkingSetKb,
          peakWorkingSetMb: Number((peakWorkingSetKb / 1024).toFixed(2)),
        },
      },
      measurementMethod: {
        startup:
          "performance.now() around manager.activate() for activation, and through DOM text confirmation for startup/switch/recovery; one run, not a distribution.",
        memory:
          "Chromium process metrics queried via Electron app.getAppMetrics() matching the guest WebContents OS process ID (webContents.getOSProcessId()), recording resident working set size and peak working set.",
      },
      limitations: [
        "The working-set sample is for the full Chromium renderer process, not incremental memory attributable to extension DOM or scripts; no baseline-subtracted comparison was measured.",
        "Cold vs. warm cache: The first activation initializes session partitions, custom file protocols, and V8 bytecode caches; subsequent view switches benefit from existing warm process state.",
        "Off-screen rendering: In automated headless/inactive test window runs, GPU presentation swapchain buffers differ from an actively focused, full-screen composited user display window.",
        "The host window is synthetic; the test intercepts the main-process IPC send and does not exercise Tabs React retry UI or real desktop-to-Exchange installation.",
      ],
      assertionsVerified: [
        "Actual packaged .tabsext archive creation and integrity verification",
        "Local package installation into isolated ExtensionViewManager",
        "Multi-project and multi-profile assignment configuration",
        "Real WebContentsView UI load and DOM rendering via custom tabs-extension:// protocol",
        "Strict unavailability of Node.js and Electron APIs in guest renderer content",
        "Presence of the tabsExtension bridge namespaces in the guest main world",
        "Denial of unauthorized window.open popups via setWindowOpenHandler",
        "Rejection of direct requests and navigation to a listening loopback server, with zero server hits",
        "Top-level navigation attempt does not leave the extension URL",
        "Packaging boundaries: own stylesheet served; resolver rejects traversal; first partition cannot fetch installed foreign package",
        "Project/profile switching updates DOM and separates browser localStorage partitions",
        "Stale activation hide and bounds requests cannot interfere with replacement view",
        "Renderer crash attempts one view-error IPC send without destroying the host window",
        "Manager activates a functional replacement view after renderer crash",
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
