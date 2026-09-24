import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { packTabsext } from "@tabs/extension-package";
import type { DesktopExchangeListing, DesktopInstalledExtension } from "@tabs/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { configuredExchangeTrust, ExchangeInstallService } from "./exchangeInstall";
import { exchangeTargetPath } from "./trustedExchange";

const origin = "https://exchange.tabs.example";
const roots: string[] = [];
function temporaryDirectory(): string {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-exchange-install-test-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("Exchange install consent", () => {
  it("requires an out-of-band root whose bytes match the pinned hash", () => {
    const root = temporaryDirectory();
    const path = Path.join(root, "root.json");
    const bytes = Buffer.from('{"root":"fixture"}');
    FS.writeFileSync(path, bytes);
    const environment = {
      TABS_EXCHANGE_TRUST_ROOT_PATH: path,
      TABS_EXCHANGE_TRUST_ROOT_SHA256: Crypto.createHash("sha256").update(bytes).digest("hex"),
      TABS_EXCHANGE_TRUST_ID: "official",
    };
    expect(configuredExchangeTrust(environment, origin)?.root).toEqual(bytes);
    expect(configuredExchangeTrust({}, origin)).toBeNull();
    expect(() =>
      configuredExchangeTrust(
        { ...environment, TABS_EXCHANGE_TRUST_ROOT_SHA256: "0".repeat(64) },
        origin,
      ),
    ).toThrow(/pinned digest/);
    expect(() => configuredExchangeTrust(environment, "http://localhost:3000")).toThrow(/HTTPS/);
  });

  it("prepares exact package bytes and consumes a review token once", async () => {
    const root = temporaryDirectory();
    const source = Path.join(root, "source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.writeFileSync(Path.join(source, "dist", "index.html"), "<!doctype html><title>Tool</title>");
    FS.writeFileSync(
      Path.join(source, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: "acme",
        name: "dashboard",
        version: "1.0.0",
        displayName: "Dashboard",
        description: "A UI tool",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: ["profile-storage"],
        contributes: { tools: [{ id: "main", label: "Dashboard", entry: "dist/index.html" }] },
      }),
    );
    const packagePath = Path.join(root, "package.tabsext");
    const packageInfo = await packTabsext({
      directory: source,
      destination: packagePath,
      tabsVersion: "1.3.17",
    });
    const listing: DesktopExchangeListing = {
      registryOrigin: origin,
      id: packageInfo.id,
      namespace: "acme",
      name: "dashboard",
      version: "1.0.0",
      digest: packageInfo.digest,
      displayName: "Dashboard",
      description: "A UI tool",
      verifiedPublisher: false,
    };
    let installed = 0;
    let revoked = false;
    const service = new ExchangeInstallService(
      { origin, trustId: "official", root: Buffer.from("test") },
      Path.join(root, "metadata"),
      "1.3.17",
      () => [],
      async (archive, installedOrigin, digest) => {
        expect(FS.readFileSync(archive)).toEqual(FS.readFileSync(packagePath));
        expect(installedOrigin).toBe(origin);
        expect(digest).toBe(packageInfo.digest);
        installed++;
        return { id: packageInfo.id } as DesktopInstalledExtension;
      },
      async (url) => {
        const response = new Response(new Uint8Array(FS.readFileSync(packagePath)));
        Object.defineProperty(response, "url", { value: String(url) });
        return response;
      },
      {
        resolve: async () =>
          revoked
            ? null
            : {
                path: exchangeTargetPath("acme", "dashboard", "1.0.0"),
                bytes: packageInfo.bytes,
                digest: packageInfo.digest,
              },
      },
    );
    try {
      const prepared = await service.prepare(listing);
      expect(prepared.manifest.capabilities).toEqual(["profile-storage"]);
      expect(prepared.willKeepEnabled).toBe(false);
      await service.confirm(prepared.token);
      expect(installed).toBe(1);
      await expect(service.confirm(prepared.token)).rejects.toThrow(/expired/);
      await expect(
        service.prepare({ ...listing, registryOrigin: "https://evil.example" }),
      ).rejects.toThrow(/trusted registry/);
      const cancelled = await service.prepare(listing);
      service.cancel(cancelled.token);
      await expect(service.confirm(cancelled.token)).rejects.toThrow(/expired/);
      const nowRevoked = await service.prepare(listing);
      revoked = true;
      await expect(service.confirm(nowRevoked.token)).rejects.toThrow(/no longer present/);
      expect(installed).toBe(1);
    } finally {
      service.dispose();
    }
  });
});
