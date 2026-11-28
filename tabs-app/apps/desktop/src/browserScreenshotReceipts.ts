import { PAGE_READY_FOR_AGENT } from "./browserPageGrant";
import { hasScreenshotReceipts, screenshotReceiptExpression } from "./deviceScreenshotInput";

/**
 * "image": a visible page image whose bytes hash to the expected digest (verified).
 * "pageText": the page only prints the digest, which any page can do (unverified).
 */
export type ScreenshotReceiptKind = "image" | "pageText";

export function classifyScreenshotReceipt(
  imageVerified: boolean,
  visibleText: unknown,
  digests: readonly string[],
): ScreenshotReceiptKind | false {
  if (imageVerified) return "image";
  return typeof visibleText === "string" && hasScreenshotReceipts(visibleText, digests)
    ? "pageText"
    : false;
}

export async function checkAttachmentPage(
  contents: Electron.WebContents,
  url: string,
  digests?: readonly string[],
  verifyImages = false,
) {
  try {
    const receipt =
      digests === undefined ? "true" : screenshotReceiptExpression(digests, verifyImages);
    const result: unknown = await contents.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `location.href === ${JSON.stringify(url)} && (${PAGE_READY_FOR_AGENT}) ? (${receipt}) : null`,
      },
    ]);
    if (result === true) return "ready";
    if (result === false && digests !== undefined) return "missing_receipt";
  } catch {
    // The page may have navigated or closed during execution.
  }
  return "protected";
}
