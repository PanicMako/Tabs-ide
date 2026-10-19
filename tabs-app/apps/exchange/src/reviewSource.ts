import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { extractTabsext } from "@tabs/extension-package";

export class ReviewSourceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function validateReviewSourceRequest(file: string | null, digest: string | null): string {
  if (
    !file ||
    file.length > 512 ||
    file.includes("\\") ||
    file.includes("\0") ||
    file.startsWith("/") ||
    file.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new ReviewSourceError(400, "Choose an exact packaged file path.");
  if (!digest || !/^[a-f0-9]{64}$/.test(digest))
    throw new ReviewSourceError(400, "An exact package fingerprint is required.");
  return file;
}

/** Inspect bytes, never execute them; reuse the archive validator's extraction and size limits. */
export async function readReviewSource(
  bytes: Buffer,
  identity: { digest: string; namespace: string; name: string; version: string },
  file: string,
) {
  validateReviewSourceRequest(file, identity.digest);
  if (Crypto.createHash("sha256").update(bytes).digest("hex") !== identity.digest)
    throw new ReviewSourceError(409, "Package fingerprint changed. Refresh the review queue.");
  const temporary = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-review-source-"));
  try {
    const archive = Path.join(temporary, "package.tabsext");
    await FS.writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
    const destination = Path.join(temporary, "content");
    const inspected = await extractTabsext({
      archive,
      destination,
      expectedDigest: identity.digest,
      tabsVersion: null,
    });
    if (
      inspected.manifest.publisher !== identity.namespace ||
      inspected.manifest.name !== identity.name ||
      inspected.manifest.version !== identity.version
    )
      throw new ReviewSourceError(409, "Package identity differs from this review.");
    if (!inspected.files.includes(file))
      throw new ReviewSourceError(404, "File not present in this submitted archive.");
    const path = Path.join(destination, file);
    const stat = await FS.stat(path);
    const base = { digest: identity.digest, file, bytes: stat.size };
    if (stat.size > 384 * 1024) return { ...base, omitted: "too-large" };
    const content = await FS.readFile(path);
    if (content.includes(0)) return { ...base, omitted: "binary" };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return { ...base, omitted: "binary" };
    }
    if (
      Array.from(text).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 && ![9, 10, 13].includes(code);
      })
    )
      return { ...base, omitted: "binary" };
    return { ...base, sha256: Crypto.createHash("sha256").update(content).digest("hex"), text };
  } finally {
    await FS.rm(temporary, { recursive: true, force: true });
  }
}
