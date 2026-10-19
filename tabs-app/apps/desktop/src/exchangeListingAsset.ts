import { parseSemver } from "@tabs/shared/semver";
const segment = /^[a-z][a-z0-9-]{1,62}$/;
/** Informational publisher content. Never establishes installation trust. */
export async function fetchExchangeListingAsset(
  origin: string,
  value: unknown,
  kind: unknown,
  index: unknown,
  fetcher: typeof fetch = fetch,
): Promise<{ type: string; data: string } | null> {
  const listing = value as Record<string, unknown> | null;
  if (
    !listing ||
    typeof listing !== "object" ||
    listing.registryOrigin !== origin ||
    typeof listing.namespace !== "string" ||
    !segment.test(listing.namespace) ||
    typeof listing.name !== "string" ||
    !segment.test(listing.name) ||
    typeof listing.version !== "string" ||
    !/^[0-9A-Za-z.+-]{1,128}$/.test(listing.version) ||
    !parseSemver(listing.version) ||
    typeof kind !== "string" ||
    !["icon", "readme", "screenshot"].includes(kind) ||
    (kind === "screenshot" && (!Number.isInteger(index) || Number(index) < 0 || Number(index) > 5))
  ) {
    throw new Error("Invalid Exchange listing asset.");
  }
  const suffix = kind === "screenshot" ? `screenshot/${index}` : String(kind);
  const url = new URL(
    `/v1/extensions/${listing.namespace}/${listing.name}/versions/${encodeURIComponent(listing.version)}/assets/${suffix}`,
    origin,
  );
  const response = await fetcher(url.href, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.url !== url.href) throw new Error("Listing asset changed origin or path.");
  if (response.status === 404) return null;
  const type = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (
    !response.ok ||
    !type ||
    (kind === "readme"
      ? !["text/plain", "text/markdown"].includes(type)
      : !["image/png", "image/jpeg", "image/webp"].includes(type))
  ) {
    throw new Error("Listing content is unavailable or unsupported.");
  }
  const limit = kind === "readme" ? 512 * 1024 : 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit || !response.body)
    throw new Error("Listing content is too large.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > limit) throw new Error("Listing content is too large.");
      chunks.push(chunk);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (kind === "readme")
    return { type, data: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  const valid =
    type === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new Error("Listing image format is invalid.");
  return { type, data: `data:${type};base64,${bytes.toString("base64")}` };
}
