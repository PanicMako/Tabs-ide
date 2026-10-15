import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import { exchangeTargetPath, type TrustedExchangeTarget } from "./trustedExchange";

/** Only a signed TUF target may supply the path, length, and digest here. */
export async function downloadSignedExchangePackage(input: {
  readonly origin: string;
  readonly target: TrustedExchangeTarget;
  readonly stagingRoot: string;
  readonly fetcher?: typeof fetch;
}): Promise<string> {
  const { origin, target, stagingRoot } = input;
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.protocol !== "https:") {
    throw new Error("Exchange package origin must be HTTPS.");
  }
  const pieces = /^extensions\/([^/]+)\/([^/]+)\/([^/]+)\.tabsext$/.exec(target.path);
  if (
    !pieces ||
    target.path !== exchangeTargetPath(pieces[1]!, pieces[2]!, pieces[3]!) ||
    !/^[a-f0-9]{64}$/.test(target.digest) ||
    !Number.isSafeInteger(target.bytes) ||
    target.bytes <= 0 ||
    target.bytes > 25 * 1024 * 1024
  ) {
    throw new Error("Signed Exchange package target is invalid.");
  }
  const url = new URL(`/v1/tuf/targets/${target.path}`, origin).href;
  const response = await (input.fetcher ?? fetch)(url, {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || response.url !== url || !response.body) {
    throw new Error("Exchange package request failed or changed destination.");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== target.bytes) {
    throw new Error("Exchange package length differs from signed metadata.");
  }
  FS.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const directory = FS.mkdtempSync(Path.join(stagingRoot, "download-"));
  const archive = Path.join(directory, "package.tabsext");
  const handle = FS.openSync(archive, "wx", 0o600);
  const reader = response.body.getReader();
  const hasher = Crypto.createHash("sha256");
  let bytes = 0;
  let verified = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > target.bytes) throw new Error("Exchange package exceeds signed length.");
      hasher.update(part.value);
      let offset = 0;
      while (offset < part.value.byteLength) {
        const written = FS.writeSync(handle, part.value, offset);
        if (written <= 0) throw new Error("Exchange package staging write failed.");
        offset += written;
      }
    }
    if (bytes !== target.bytes || hasher.digest("hex") !== target.digest) {
      throw new Error("Exchange package does not match signed digest and length.");
    }
    verified = true;
    return archive;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
    FS.closeSync(handle);
    if (!verified) {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  }
}
