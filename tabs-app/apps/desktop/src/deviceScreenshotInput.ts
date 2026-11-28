import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@tabs/contracts";
import { PAGE_READY_FOR_AGENT } from "./browserPageGrant";

export function hasScreenshotReceipts(text: string, digests: readonly string[]): boolean {
  const remaining = text.slice(0, 20_000).split(/\s+/);
  for (const digest of digests) {
    const index = remaining.indexOf(digest);
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

export const SCREENSHOT_IMAGE_RECEIPTS = "same-origin-png";
export const SCREENSHOT_RECEIPT_MODE = `document.querySelector?.('meta[name="tabs-screenshot-receipts"]')?.content || ""`;

const VERIFY_SCREENSHOT_IMAGES = String.raw`(async (digests) => {
  const pageUrl = location.href;
  const urls = digests.map((digest) => {
    const url = new URL(pageUrl);
    url.pathname = url.pathname.replace(/\/+$/u, "") + "/evidence/" + digest;
    url.search = "";
    url.hash = "";
    return url.href;
  });
  const findImages = () => {
    const remaining = Array.from(document.images);
    return urls.map((url) => {
      const index = remaining.findIndex(
        (image) =>
          image.src === url &&
          image.currentSrc === url &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.getClientRects().length > 0 &&
          image.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      );
      return index < 0 ? undefined : remaining.splice(index, 1)[0];
    });
  };
  const images = findImages();
  if (images.some((image) => !image) || !crypto.subtle) return false;

  const maxBytes = ${PROVIDER_SEND_TURN_MAX_IMAGE_BYTES};
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1800);
  try {
    const verified = await Promise.all(
      Array.from(new Map(urls.map((url, i) => [url, digests[i]]))).map(async ([url, expected]) => {
        const response = await fetch(url, {
          mode: "same-origin",
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: abort.signal,
        });
        if (
          response.status !== 200 ||
          !response.body ||
          !/^image\/png(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
          Number(response.headers.get("content-length")) > maxBytes
        )
          return false;
        const reader = response.body.getReader();
        const chunks = [];
        let byteLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          byteLength += value.byteLength;
          if (byteLength > maxBytes) return false;
          chunks.push(value);
        }
        const bytes = new Uint8Array(byteLength);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return (
          Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(
            "",
          ) === expected
        );
      }),
    );
    return (
      location.href === pageUrl &&
      verified.every(Boolean) &&
      findImages().every((image, index) => image === images[index])
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
})`;

export const SCREENSHOT_RECEIPT_MAX_CANDIDATES = 40;

/**
 * Generic image receipt: no meta tag or URL convention. Every expected digest must match the
 * bytes of a distinct, visible, same-origin (or page-rendered blob:/data:) image on the page.
 */
const VERIFY_PAGE_IMAGES = String.raw`(async (digests) => {
  const pageUrl = location.href;
  if (!crypto.subtle) return false;
  const maxBytes = ${PROVIDER_SEND_TURN_MAX_IMAGE_BYTES};
  const maxCandidates = ${SCREENSHOT_RECEIPT_MAX_CANDIDATES};
  const visible = (image) =>
    image.isConnected &&
    image.complete &&
    image.naturalWidth > 0 &&
    image.getClientRects().length > 0 &&
    (typeof image.checkVisibility !== "function" ||
      image.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  const candidates = [];
  for (const image of document.images) {
    if (candidates.length >= maxCandidates) break;
    if (!visible(image)) continue;
    let source;
    try {
      source = new URL(image.currentSrc || image.src, pageUrl);
    } catch {
      continue;
    }
    // Only server-served images count. A blob: or data: image can be a local
    // preview of the selected file, which proves nothing about what was saved.
    if (source.origin !== location.origin || !/^https?:$/.test(source.protocol)) continue;
    candidates.push({ image, url: source.href });
  }
  if (candidates.length < digests.length) return false;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1800);
  const hashes = new Map();
  const hashOf = async (url) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: abort.signal,
    });
    const type = response.headers.get("content-type");
    if (
      response.status !== 200 ||
      !response.body ||
      (type && !/^image\//i.test(type)) ||
      Number(response.headers.get("content-length")) > maxBytes
    )
      return "";
    const reader = response.body.getReader();
    const chunks = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) return "";
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  try {
    await Promise.all(
      Array.from(new Set(candidates.map((entry) => entry.url))).map(async (url) => {
        try {
          hashes.set(url, await hashOf(url));
        } catch {
          hashes.set(url, "");
        }
      }),
    );
    const remaining = [...candidates];
    const matched = digests.map((digest) => {
      const index = remaining.findIndex((entry) => hashes.get(entry.url) === digest);
      return index < 0 ? undefined : remaining.splice(index, 1)[0];
    });
    return (
      location.href === pageUrl &&
      matched.every((entry) => entry && visible(entry.image))
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
})`;

export function screenshotReceiptExpression(
  digests: readonly string[],
  verifyImages = false,
): string {
  const input = JSON.stringify(digests);
  const visible = `(${hasScreenshotReceipts.toString()})(document.body?.innerText || "", ${input})`;
  const imageReceipt = `(async () => {
      if (!(${visible}) || !(await ${VERIFY_SCREENSHOT_IMAGES}(${input}))) return false;
      return (${PAGE_READY_FOR_AGENT}) && (${visible}) ? true : null;
    })()`;
  // Visible text alone is never a receipt: the bytes of a displayed image must match.
  const genericReceipt = `(async () => {
      if (!(await ${VERIFY_PAGE_IMAGES}(${input}))) return false;
      return (${PAGE_READY_FOR_AGENT}) ? true : null;
    })()`;
  return verifyImages
    ? imageReceipt
    : `((${SCREENSHOT_RECEIPT_MODE}) === ${JSON.stringify(SCREENSHOT_IMAGE_RECEIPTS)} ? (${imageReceipt}) : (${genericReceipt}))`;
}

export function selectedDeviceScreenshotScript(url: string, selector: string, id: string) {
  return `(() => {
    if (location.href !== ${JSON.stringify(url)} || !(${PAGE_READY_FOR_AGENT})) return false;
    const selection = globalThis.__tabsSelectedScreenshots?.get(${JSON.stringify(id)});
    if (!selection) return false;
    const matches = document.querySelectorAll(${JSON.stringify(selector)});
    return matches.length === 1 && matches[0] === selection.field &&
      selection.field.type === "file" && selection.field.files?.length === 1 &&
      selection.field.files[0] === selection.file;
  })()`;
}

/** Runs in an isolated guest world. Only the selected File crosses into the page. */
export function deviceScreenshotInputScript(
  url: string,
  selector: string,
  png: string | null,
  id: string,
  activeGrants: string[] = [id],
  pairedGrantId?: string,
) {
  return `(() => {
    if (location.href !== ${JSON.stringify(url)} || !(${PAGE_READY_FOR_AGENT})) return false;
    const selector = ${JSON.stringify(selector)};
    const matches = document.querySelectorAll(selector);
    const field = matches[0];
    if (matches.length !== 1 || !(field instanceof HTMLInputElement) ||
        field.type !== "file" || field.matches(":disabled") || field.files.length !== 0) return false;
    const id = ${JSON.stringify(id)};
    const pairedId = ${JSON.stringify(pairedGrantId ?? null)};
    // This global belongs to the isolated world. Page scripts cannot replace the pinned node.
    const fields = globalThis.__tabsScreenshotFields ??= new Map();
    const pairedFields = globalThis.__tabsPairedScreenshotFields ??= new Map();
    const previousPair = pairedFields.get(pairedId);
    if (pairedId && (fields.get(pairedId) === field || previousPair?.field === field ||
        previousPair?.selector === selector))
      return false;
    if (${png === null}) {
      const active = new Set(${JSON.stringify(activeGrants)});
      for (const key of fields.keys()) if (!active.has(key)) fields.delete(key);
      for (const [key, previous] of pairedFields.entries())
        if (!active.has(previous.pairedId)) pairedFields.delete(key);
      const previous = fields.get(id);
      if (previous && previous !== field) return false;
      fields.set(id, field);
      return true;
    }
    if (fields.get(id) !== field) return false;
    fields.delete(id);
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(`device-${id}.png`)}, { type: "image/png" }));
    field.files = transfer.files;
    if (field.files.length !== 1 || field.files[0].size !== bytes.length) return false;
    const selected = globalThis.__tabsSelectedScreenshots ??= new Map();
    selected.set(id, { field, file: field.files[0] });
    if (selected.size > 32) selected.delete(selected.keys().next().value);
    if (pairedId && !pairedFields.delete(pairedId)) {
      pairedFields.set(id, { field, selector, pairedId });
      if (pairedFields.size > 32) pairedFields.delete(pairedFields.keys().next().value);
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`;
}
