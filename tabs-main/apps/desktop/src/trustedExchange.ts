import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import { BaseFetcher, Updater, type UpdaterOptions } from "tuf-js";
import { DownloadHTTPError } from "tuf-js/dist/error";
import { isSafeExtensionPackageVersion } from "@tabs/shared/extensions";

const SEGMENT = /^[a-z][a-z0-9-]{1,62}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ROOT_BYTES = 512 * 1024;
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;

export interface TrustedExchangeTarget {
  readonly path: string;
  readonly bytes: number;
  readonly digest: string;
}

/** Only transport failures at the HTTP fetch boundary qualify for offline fallback. */
export class ExchangeTransportError extends Error {
  constructor(cause: unknown) {
    super("Exchange metadata transport is unavailable.", { cause });
    this.name = "ExchangeTransportError";
  }
}

/** TUF transport still rejects redirects and cross-origin requests before signature verification. */
export class ExchangeMetadataFetcher extends BaseFetcher {
  constructor(
    private readonly origin: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    super();
  }

  async fetch(url: string): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
    const parsed = new URL(url);
    if (
      parsed.origin !== this.origin ||
      !parsed.pathname.startsWith("/v1/tuf/metadata/") ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("TUF metadata URL escaped the configured Exchange origin.");
    }
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
      ) {
        throw new ExchangeTransportError(error);
      }
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error("TUF metadata redirects are forbidden.");
    }
    if (!response.ok) {
      throw new DownloadHTTPError("TUF metadata request failed.", response.status);
    }
    if (response.url !== url || !response.body) {
      throw new Error("TUF metadata request changed origin or had no body.");
    }
    return response.body as ReadableStream<Uint8Array<ArrayBuffer>>;
  }
}

export function exchangeTargetPath(namespace: string, name: string, version: string): string {
  if (!SEGMENT.test(namespace) || !SEGMENT.test(name) || !isSafeExtensionPackageVersion(version)) {
    throw new Error("Invalid Exchange target identity.");
  }
  return `extensions/${namespace}/${name}/${version}.tabsext`;
}

/**
 * Requires a root distributed out-of-band with the client. Never trust a root
 * fetched from the registry or derive an installation decision from catalog JSON.
 */
export class TrustedExchange {
  private readonly updaterOptions: UpdaterOptions;
  private refreshInFlight: Promise<Updater> | null = null;
  private initialUpdater: Updater | null = null;

  constructor(options: {
    readonly origin: string;
    readonly trustId: string;
    readonly initialRoot: Buffer;
    readonly stateRoot: string;
    readonly fetcher?: typeof fetch;
  }) {
    const { origin, trustId, initialRoot, stateRoot } = options;
    const parsed = new URL(origin);
    const isLocalDev =
      (process.env.TABS_DEVELOPMENT === "true" || process.env.TABS_TEST_ALLOW_HTTP === "true") &&
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (
      parsed.origin !== origin ||
      (parsed.protocol !== "https:" && !isLocalDev) ||
      !/^[a-z0-9-]{1,64}$/.test(trustId)
    ) {
      throw new Error("Invalid trusted Exchange configuration.");
    }
    if (initialRoot.length === 0 || initialRoot.length > MAX_ROOT_BYTES) {
      throw new Error("Trusted Exchange root is missing or too large.");
    }
    const identity = Crypto.createHash("sha256")
      .update(JSON.stringify([origin, trustId]))
      .digest("hex");
    const metadataDir = Path.join(stateRoot, identity);
    FS.mkdirSync(metadataDir, { recursive: true, mode: 0o700 });
    const rootPath = Path.join(metadataDir, "root.json");
    let createdRoot = false;
    try {
      FS.writeFileSync(rootPath, initialRoot, { flag: "wx", mode: 0o600 });
      createdRoot = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    this.updaterOptions = {
      metadataDir,
      metadataBaseUrl: `${origin}/v1/tuf/metadata`,
      fetcher: new ExchangeMetadataFetcher(origin, options.fetcher),
      config: {
        maxRootRotations: 32,
        maxDelegations: 16,
        rootMaxLength: MAX_ROOT_BYTES,
        timestampMaxLength: 64 * 1024,
        snapshotMaxLength: 1024 * 1024,
        targetsMaxLength: 4 * 1024 * 1024,
      },
    };
    try {
      this.initialUpdater = new Updater(this.updaterOptions);
    } catch (error) {
      if (createdRoot) FS.unlinkSync(rootPath);
      throw error;
    }
  }

  async resolve(
    namespace: string,
    name: string,
    version: string,
  ): Promise<TrustedExchangeTarget | null> {
    const path = exchangeTargetPath(namespace, name, version);
    this.refreshInFlight ??= (async () => {
      const updater = this.initialUpdater ?? new Updater(this.updaterOptions);
      this.initialUpdater = null;
      await updater.refresh();
      return updater;
    })().finally(() => {
      this.refreshInFlight = null;
    });
    const updater = await this.refreshInFlight;
    const target = await updater.getTargetInfo(path);
    if (!target) return null;
    const digest = target.hashes.sha256;
    if (
      target.path !== path ||
      !digest ||
      !SHA256.test(digest) ||
      target.length <= 0 ||
      target.length > MAX_PACKAGE_BYTES
    ) {
      throw new Error("Signed Exchange target is invalid.");
    }
    return { path, bytes: target.length, digest };
  }
}
