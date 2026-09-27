import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { packTabsext } from "@tabs/extension-package";
import { DownloadHTTPError, ExpiredMetadataError } from "tuf-js/dist/error";
import type { DesktopExchangeListing, DesktopInstalledExtension } from "@tabs/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  configuredExchangeTrust,
  ExchangeInstallService,
  isOfflineExchangeError,
} from "./exchangeInstall";
import { ExchangeTransportError, exchangeTargetPath } from "./trustedExchange";

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
  it("flags an added network host before retaining project enablement", async () => {
    const root = temporaryDirectory();
    const source = Path.join(root, "source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.writeFileSync(Path.join(source, "dist", "index.html"), "<!doctype html><title>Tool</title>");
    const manifest = {
      manifestVersion: 1 as const,
      publisher: "acme",
      name: "dashboard",
      version: "1.0.1",
      displayName: "Dashboard",
      description: "A UI tool",
      engines: { tabs: ">=1.3.0 <2.0.0" },
      capabilities: ["network"] as Array<"network">,
      networkHosts: ["api.example.com", "billing.example.com"],
      contributes: { tools: [{ id: "main", label: "Dashboard", entry: "dist/index.html" }] },
    };
    FS.writeFileSync(Path.join(source, "tabs-extension.json"), JSON.stringify(manifest));
    const archive = Path.join(root, "update.tabsext");
    const packageInfo = await packTabsext({
      directory: source,
      destination: archive,
      tabsVersion: "1.3.17",
    });
    const previous = {
      id: packageInfo.id,
      source: "exchange",
      registryOrigin: origin,
      digest: "a".repeat(64),
      assignment: {
        extensionId: packageInfo.id,
        enabledGlobally: true,
        enabledProjectIds: [],
        disabledProjectIds: [],
        defaultProfileId: "default",
        profileIdByProjectId: {},
      },
      profiles: [{ id: "default", label: "Default" }],
      manifest: {
        ...manifest,
        version: "1.0.0",
        networkHosts: ["api.example.com"],
      },
    } satisfies DesktopInstalledExtension;
    const service = new ExchangeInstallService(
      { origin, trustId: "official", root: Buffer.from("test") },
      Path.join(root, "metadata"),
      "1.3.17",
      () => [previous],
      async () => {
        throw new Error("not expected");
      },
      async (url) => {
        const response = new Response(new Uint8Array(FS.readFileSync(archive)));
        Object.defineProperty(response, "url", { value: String(url) });
        return response;
      },
      {
        resolve: async () => ({
          path: exchangeTargetPath("acme", "dashboard", "1.0.1"),
          bytes: packageInfo.bytes,
          digest: packageInfo.digest,
        }),
      },
    );
    try {
      const prepared = await service.prepare({
        registryOrigin: origin,
        id: packageInfo.id,
        namespace: "acme",
        name: "dashboard",
        version: "1.0.1",
        digest: packageInfo.digest,
        displayName: "Dashboard",
        description: "A UI tool",
        verifiedPublisher: false,
        tabsCompatibility: ">=1.3.0 <2.0.0",
        capabilities: ["network"],
      });
      expect(prepared.addedCapabilities).toEqual([]);
      expect(prepared.addedNetworkHosts).toEqual(["billing.example.com"]);
      expect(prepared.willKeepEnabled).toBe(false);
    } finally {
      service.dispose();
    }
  });
  it("treats transport outages as offline, but not invalid signed metadata", () => {
    expect(isOfflineExchangeError(new DownloadHTTPError("offline", 503))).toBe(true);
    expect(isOfflineExchangeError(new ExchangeTransportError(new TypeError("fetch failed")))).toBe(
      true,
    );
    expect(isOfflineExchangeError(new DownloadHTTPError("missing", 404))).toBe(false);
    expect(isOfflineExchangeError(new TypeError("invalid metadata"))).toBe(false);
    expect(isOfflineExchangeError(new ExpiredMetadataError("expired"))).toBe(false);
  });
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
      tabsCompatibility: ">=1.3.0 <2.0.0",
      capabilities: [],
    };
    let installed = 0;
    let revoked = false;
    let offline = false;
    let invalidMetadata = false;
    let listedUpdateDigest = "c".repeat(64);
    let currentInstallation: DesktopInstalledExtension | null = null;
    const service = new ExchangeInstallService(
      { origin, trustId: "official", root: Buffer.from("test") },
      Path.join(root, "metadata"),
      "1.3.17",
      () => (currentInstallation ? [currentInstallation] : []),
      async (archive, installedOrigin, digest) => {
        expect(FS.readFileSync(archive)).toEqual(FS.readFileSync(packagePath));
        expect(installedOrigin).toBe(origin);
        expect(digest).toBe(packageInfo.digest);
        installed++;
        return { id: packageInfo.id } as DesktopInstalledExtension;
      },
      async (url) => {
        const response = String(url).endsWith("/v1/extensions/acme/dashboard")
          ? new Response(
              JSON.stringify({
                versions: [
                  {
                    namespace: "acme",
                    name: "dashboard",
                    version: "1.0.1",
                    digest: listedUpdateDigest,
                    verified: false,
                    manifest: {
                      ...JSON.parse(
                        FS.readFileSync(Path.join(source, "tabs-extension.json"), "utf8"),
                      ),
                      version: "1.0.1",
                    },
                  },
                ],
              }),
              { headers: { "content-type": "application/json" } },
            )
          : new Response(new Uint8Array(FS.readFileSync(packagePath)));
        Object.defineProperty(response, "url", { value: String(url) });
        return response;
      },
      {
        resolve: async (_namespace, _name, version) => {
          if (offline) throw new DownloadHTTPError("offline", 503);
          if (invalidMetadata) throw new ExpiredMetadataError("expired");
          return revoked
            ? null
            : {
                path: exchangeTargetPath("acme", "dashboard", version),
                bytes: packageInfo.bytes,
                digest: version === "1.0.1" ? "c".repeat(64) : packageInfo.digest,
              };
        },
      },
    );
    try {
      const prepared = await service.prepare(listing);
      expect(prepared.manifest.capabilities).toEqual(["profile-storage"]);
      expect(prepared.willKeepEnabled).toBe(false);
      const installedEntry = {
        id: listing.id,
        manifest: prepared.manifest,
        source: "exchange",
        registryOrigin: origin,
        digest: listing.digest,
      } as DesktopInstalledExtension;
      expect(await service.statusFor(installedEntry)).toBe("approved");
      offline = true;
      expect(await service.statusFor(installedEntry)).toBe("offline");
      offline = false;
      invalidMetadata = true;
      await expect(service.statusFor(installedEntry)).rejects.toThrow(/expired/);
      invalidMetadata = false;
      await service.confirm(prepared.token);
      expect(installed).toBe(1);
      currentInstallation = installedEntry;
      expect((await service.availableUpdate(installedEntry))?.version).toBe("1.0.1");
      listedUpdateDigest = "d".repeat(64);
      expect(await service.availableUpdate(installedEntry)).toBeNull();
      listedUpdateDigest = "c".repeat(64);
      currentInstallation = {
        ...installedEntry,
        manifest: { ...installedEntry.manifest, version: "2.0.0" },
      };
      await expect(service.prepare(listing)).rejects.toThrow(/downgrade/);
      currentInstallation = { ...installedEntry, digest: "b".repeat(64) };
      await expect(service.prepare(listing)).rejects.toThrow(/cannot change its package digest/);
      currentInstallation = installedEntry;
      const superseded = await service.prepare(listing);
      currentInstallation = {
        ...installedEntry,
        manifest: { ...installedEntry.manifest, version: "2.0.0" },
      };
      await expect(service.confirm(superseded.token)).rejects.toThrow(/downgrade/);
      currentInstallation = installedEntry;
      await expect(service.confirm(prepared.token)).rejects.toThrow(/expired/);
      await expect(
        service.prepare({ ...listing, registryOrigin: "https://evil.example" }),
      ).rejects.toThrow(/trusted registry/);
      const cancelled = await service.prepare(listing);
      service.cancel(cancelled.token);
      await expect(service.confirm(cancelled.token)).rejects.toThrow(/expired/);
      const nowRevoked = await service.prepare(listing);
      revoked = true;
      expect(await service.statusFor(installedEntry)).toBe("revoked");
      await expect(service.confirm(nowRevoked.token)).rejects.toThrow(/no longer present/);
      expect(installed).toBe(1);
    } finally {
      service.dispose();
    }
  });
});
