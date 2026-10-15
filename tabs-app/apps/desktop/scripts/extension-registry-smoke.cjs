/* Test-only real Electron consumer of a live HTTPS Exchange and signed metadata. */
const { app, BrowserWindow, protocol, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { Readable } = require("node:stream");
const assert = require("node:assert/strict");
const fixture = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
const origin = new URL(fixture.origin);
assert.equal(process.env.NODE_ENV, "test");
assert.equal(fixture.testOnly, true);
assert.equal(origin.protocol, "https:");
assert.equal(origin.hostname, "127.0.0.1");
assert.equal(origin.origin, fixture.origin);
assert.equal(fixture.namespace, "acme");
assert.equal(fixture.name, "dashboard");
const temporary = process.argv[3];
app.setPath("userData", path.join(temporary, "user-data"));
fs.mkdirSync(app.getPath("userData"), { recursive: true });
protocol.registerSchemesAsPrivileged([
  { scheme: "tabs-extension", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const ca = fs.readFileSync(fixture.caPath);
const fetcher = async (input, init = {}) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  assert.equal(url.origin, fixture.origin, "Fixture transport cannot leave its registry origin");
  assert.equal(init.method ?? "GET", "GET");
  return new Promise((resolve, reject) => {
    const request = https.request(url, { ca, rejectUnauthorized: true }, (response) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const result = new Response(Readable.toWeb(response), {
        status: response.statusCode,
        headers,
      });
      Object.defineProperty(result, "url", { value: url.href });
      resolve(result);
    });
    const abort = () => request.destroy(new Error("Fixture request cancelled"));
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => init.signal?.removeEventListener("abort", abort));
    request.once("error", reject);
    request.end();
  });
};
const deadline = setTimeout(() => app.exit(1), 60000);
app.whenReady().then(async () => {
  let window;
  let service;
  try {
    const {
      ExtensionViewManager,
      NativeViewStackCoordinator,
      ExchangeInstallService,
      discoverExchangeVersions,
    } = require(process.argv[2]);
    window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    class Coordinator extends NativeViewStackCoordinator {
      current = null;
      attachToolView(view) {
        this.current = view;
        super.attachToolView(view);
      }
      detachToolView(view) {
        if (this.current === view) this.current = null;
        super.detachToolView(view);
      }
    }
    const coordinator = new Coordinator({ getWindow: () => window });
    const manager = new ExtensionViewManager(
      () => window,
      coordinator,
      path.join(temporary, "installed.json"),
      "1.3.17",
      false,
    );
    ipcMain.handle("desktop:extension:storage", (event, operation) => {
      if (event.senderFrame !== event.sender.mainFrame)
        throw new Error("Extension storage is available only to the main frame.");
      return manager.invokeStorage(event.sender, operation);
    });
    assert.equal(manager.list().length, 0, "Consumer environment starts clean");
    service = new ExchangeInstallService(
      {
        origin: fixture.origin,
        trustId: "electron-acceptance",
        root: Buffer.from(fixture.root, "base64"),
      },
      temporary,
      "1.3.17",
      () => manager.list(),
      (archive, registry, digest, options) =>
        manager.installVerifiedExchangePackage(archive, registry, digest, options),
      fetcher,
    );
    const releases = await discoverExchangeVersions(
      fixture.origin,
      "1.3.17",
      fixture.namespace,
      fixture.name,
      fetcher,
    );
    const first = releases.find((release) => release.version === "1.0.0");
    assert.ok(first);
    const installed = await service.confirm((await service.prepare(first)).token);
    assert.equal(installed.source, "exchange");
    assert.equal(installed.digest, fixture.digest1);
    assert.equal(installed.assignment.enabledGlobally, false);
    manager.addProfile(installed.id, "work", "Work", "project");
    manager.addProfile(installed.id, "personal", "Personal", "project");
    manager.setAssignment(installed.id, {
      extensionId: installed.id,
      enabledGlobally: false,
      enabledProjectIds: ["alpha", "beta"],
      disabledProjectIds: [],
      defaultProfileId: "work",
      profileIdByProjectId: { alpha: "work", beta: "personal" },
      storageGrantedProjectIds: ["alpha"],
    });
    let sequence = 0;
    async function activate(projectId, profileId) {
      await manager.activate({
        extensionId: installed.id,
        toolId: "hello",
        projectId,
        profileId,
        activationId: `registry-${++sequence}`,
      });
      const contents = coordinator.current.webContents;
      assert.equal(
        await contents.executeJavaScript("document.querySelector('h1')?.textContent"),
        "Hello from a Tabs extension",
      );
      assert.equal(await contents.executeJavaScript("typeof process"), "undefined");
      return contents;
    }
    const work = await activate("alpha", "work");
    await work.executeJavaScript("localStorage.setItem('account-proof', 'Work')");
    await work.executeJavaScript("window.tabsExtension.storage.set('account-proof', 'Work')");
    let personal = await activate("beta", "personal");
    assert.equal(await personal.executeJavaScript("localStorage.getItem('account-proof')"), null);
    await assert.rejects(
      personal.executeJavaScript("window.tabsExtension.storage.get('account-proof')"),
      /not granted/,
    );
    manager.setAssignment(installed.id, {
      ...manager.list()[0].assignment,
      storageGrantedProjectIds: ["alpha", "beta"],
    });
    personal = await activate("beta", "personal");
    assert.equal(
      await personal.executeJavaScript("window.tabsExtension.storage.get('account-proof')"),
      null,
    );
    await personal.executeJavaScript("localStorage.setItem('account-proof', 'Personal')");
    await personal.executeJavaScript(
      "window.tabsExtension.storage.set('account-proof', 'Personal')",
    );
    async function verifyAccount(project, profile, label) {
      const contents = await activate(project, profile);
      assert.equal(
        await contents.executeJavaScript("localStorage.getItem('account-proof')"),
        label,
      );
      assert.equal(
        await contents.executeJavaScript("window.tabsExtension.storage.get('account-proof')"),
        label,
      );
    }
    const update = await service.availableUpdate(manager.list()[0]);
    assert.equal(update.version, "1.1.0");
    const prepared = await service.prepare(update);
    assert.deepEqual(prepared.addedCapabilities, []);
    manager.hide();
    const updated = await service.confirm(prepared.token, { silent: true });
    assert.equal(updated.digest, fixture.digest2);
    assert.deepEqual(updated.assignment.storageGrantedProjectIds, ["alpha", "beta"]);
    const updateRoot = path.join(temporary, "extension-packages", installed.id, fixture.digest2);
    const entry = updated.manifest.contributes.tools.find((tool) => tool.id === "hello").entry;
    const updateEntry = path.resolve(updateRoot, entry);
    assert.ok(updateEntry.startsWith(`${updateRoot}${path.sep}`));
    const heldEntry = `${updateEntry}.acceptance-held`;
    assert.equal(fs.existsSync(heldEntry), false);
    fs.renameSync(updateEntry, heldEntry);
    try {
      await assert.rejects(activate("alpha", "work"), /rolled back/);
      assert.equal(manager.list()[0].digest, fixture.digest1);
      assert.deepEqual(manager.list()[0].assignment, updated.assignment);
      await verifyAccount("alpha", "work", "Work");
      await verifyAccount("beta", "personal", "Personal");
    } finally {
      // The host retains the failed extraction under its recovery name.
      assert.equal(fs.existsSync(updateRoot), false);
    }
    manager.hide();
    const retry = await service.prepare(update);
    assert.equal((await service.confirm(retry.token, { silent: true })).digest, fixture.digest2);
    await verifyAccount("alpha", "work", "Work");
    await verifyAccount("beta", "personal", "Personal");
    console.log(
      "REGISTRY_ELECTRON_ACCEPTANCE_PASS: signed HTTPS install, real sandboxed view, failed-load rollback and retry, Work/Personal browser and host storage isolation, denied project grant and grant retention",
    );
    service.dispose();
    window.destroy();
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error("REGISTRY_ELECTRON_ACCEPTANCE_FAIL", error);
    clearTimeout(deadline);
    window?.destroy();
    app.exit(1);
  }
});
