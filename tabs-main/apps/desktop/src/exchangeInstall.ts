import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { inspectTabsext } from "@tabs/extension-package";
import type {
  DesktopExchangeListing,
  DesktopInstalledExtension,
  DesktopPreparedExchangeInstall,
} from "@tabs/contracts";
import { downloadSignedExchangePackage } from "./exchangePackageDownload";
import { TrustedExchange } from "./trustedExchange";

const SHA256 = /^[a-f0-9]{64}$/;
const TRUST_ID = /^[a-z0-9-]{1,64}$/;
const PREPARED_TTL_MS = 10 * 60_000;

export interface ExchangeTrustConfiguration {
  readonly origin: string;
  readonly trustId: string;
  readonly root: Buffer;
}

/** Root bytes and their hash must be provisioned out-of-band, never from catalog JSON. */
export function configuredExchangeTrust(
  environment: NodeJS.ProcessEnv,
  catalogOrigin: string | null,
): ExchangeTrustConfiguration | null {
  const rootPath = environment.TABS_EXCHANGE_TRUST_ROOT_PATH;
  const rootDigest = environment.TABS_EXCHANGE_TRUST_ROOT_SHA256;
  const trustId = environment.TABS_EXCHANGE_TRUST_ID;
  if (!rootPath || !rootDigest || !trustId || !catalogOrigin) return null;
  if (!Path.isAbsolute(rootPath) || !SHA256.test(rootDigest) || !TRUST_ID.test(trustId)) {
    throw new Error("Invalid Exchange trust-root configuration.");
  }
  const origin = new URL(catalogOrigin);
  if (origin.origin !== catalogOrigin || origin.protocol !== "https:") {
    throw new Error("Trusted Exchange requires an HTTPS registry origin.");
  }
  const stat = FS.statSync(rootPath);
  if (!stat.isFile() || stat.size === 0 || stat.size > 512 * 1024) {
    throw new Error("Exchange trust root is invalid or too large.");
  }
  const root = FS.readFileSync(rootPath);
  if (Crypto.createHash("sha256").update(root).digest("hex") !== rootDigest) {
    throw new Error("Exchange trust root does not match its pinned digest.");
  }
  return { origin: catalogOrigin, trustId, root };
}

interface Prepared {
  readonly archive: string;
  readonly result: DesktopPreparedExchangeInstall;
  readonly expiresAt: number;
}

/** Holds one verified, immutable-by-digest candidate until the user accepts its permissions. */
export class ExchangeInstallService {
  private readonly prepared = new Map<string, Prepared>();
  private readonly stagingRoot = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-exchange-install-"));
  private readonly trusted: Pick<TrustedExchange, "resolve">;

  constructor(
    private readonly configuration: ExchangeTrustConfiguration,
    stateRoot: string,
    private readonly tabsVersion: string,
    private readonly listInstalled: () => DesktopInstalledExtension[],
    private readonly install: (
      archive: string,
      origin: string,
      digest: string,
    ) => Promise<DesktopInstalledExtension>,
    fetcher?: typeof fetch,
    trusted?: Pick<TrustedExchange, "resolve">,
  ) {
    this.trusted =
      trusted ??
      new TrustedExchange({
        origin: configuration.origin,
        trustId: configuration.trustId,
        initialRoot: configuration.root,
        stateRoot,
        ...(fetcher ? { fetcher } : {}),
      });
    this.fetcher = fetcher;
  }

  private readonly fetcher: typeof fetch | undefined;

  async prepare(listing: DesktopExchangeListing): Promise<DesktopPreparedExchangeInstall> {
    this.pruneExpired();
    if (
      listing.registryOrigin !== this.configuration.origin ||
      listing.id !== `${listing.namespace}.${listing.name}` ||
      !SHA256.test(listing.digest)
    ) {
      throw new Error("Exchange listing does not match the trusted registry.");
    }
    const target = await this.trusted.resolve(listing.namespace, listing.name, listing.version);
    if (!target || target.digest !== listing.digest) {
      throw new Error("This listing is not present in current signed Exchange metadata.");
    }
    const archive = await downloadSignedExchangePackage({
      origin: this.configuration.origin,
      target,
      stagingRoot: this.stagingRoot,
      ...(this.fetcher ? { fetcher: this.fetcher } : {}),
    });
    try {
      const inspected = await inspectTabsext(archive, this.tabsVersion);
      if (
        inspected.id !== listing.id ||
        inspected.manifest.version !== listing.version ||
        inspected.digest !== target.digest
      ) {
        throw new Error("Signed package identity differs from Exchange listing.");
      }
      const previous = this.listInstalled().find((extension) => extension.id === inspected.id);
      if (previous?.registryOrigin && previous.registryOrigin !== this.configuration.origin) {
        throw new Error("A same-named extension from another registry is already installed.");
      }
      const oldCapabilities = previous?.manifest.capabilities ?? [];
      const addedCapability = (inspected.manifest.capabilities ?? []).some(
        (capability) => !oldCapabilities.includes(capability),
      );
      const token = Crypto.randomBytes(24).toString("hex");
      const result: DesktopPreparedExchangeInstall = {
        token,
        registryOrigin: this.configuration.origin,
        digest: target.digest,
        manifest: inspected.manifest,
        ...(previous ? { replacesVersion: previous.manifest.version } : {}),
        willKeepEnabled: Boolean(previous && !addedCapability),
      };
      this.prepared.set(token, { archive, result, expiresAt: Date.now() + PREPARED_TTL_MS });
      return result;
    } catch (error) {
      FS.rmSync(Path.dirname(archive), { recursive: true, force: true });
      throw error;
    }
  }

  async confirm(token: string): Promise<DesktopInstalledExtension> {
    this.pruneExpired();
    const prepared = this.prepared.get(token);
    if (!prepared) throw new Error("Exchange install review expired; prepare it again.");
    this.prepared.delete(token);
    try {
      const { publisher, name, version } = prepared.result.manifest;
      const current = await this.trusted.resolve(publisher, name, version);
      if (!current || current.digest !== prepared.result.digest) {
        throw new Error("This version is no longer present in current signed Exchange metadata.");
      }
      return await this.install(
        prepared.archive,
        prepared.result.registryOrigin,
        prepared.result.digest,
      );
    } finally {
      FS.rmSync(Path.dirname(prepared.archive), { recursive: true, force: true });
    }
  }

  cancel(token: string): void {
    const prepared = this.prepared.get(token);
    if (!prepared) return;
    this.prepared.delete(token);
    FS.rmSync(Path.dirname(prepared.archive), { recursive: true, force: true });
  }

  dispose(): void {
    for (const token of this.prepared.keys()) this.cancel(token);
    FS.rmSync(this.stagingRoot, { recursive: true, force: true });
  }

  private pruneExpired(): void {
    for (const [token, prepared] of this.prepared) {
      if (prepared.expiresAt <= Date.now()) this.cancel(token);
    }
  }
}
