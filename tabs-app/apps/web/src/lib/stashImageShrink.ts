/**
 * Stash keeps image data in browser storage, which holds about 2.7M characters per draft.
 * A macOS screenshot (Cmd+Shift+3) is several megabytes, so it never fit and the whole
 * draft was refused. Oversized images are re-encoded smaller instead.
 */

/** Longest side to try, then the JPEG quality to try at that size, from best to smallest. */
export const STASH_SHRINK_STEPS: ReadonlyArray<{ maxSide: number; quality: number }> = [
  { maxSide: 2400, quality: 0.86 },
  { maxSide: 1800, quality: 0.8 },
  { maxSide: 1400, quality: 0.74 },
  { maxSide: 1000, quality: 0.66 },
  { maxSide: 700, quality: 0.6 },
];

/** Share of the entry's storage each image may use; a draft with N images splits it evenly. */
export function stashImageBudgetChars(totalChars: number, imageCount: number): number {
  return Math.floor(totalChars / Math.max(1, imageCount));
}

/** Scales a size so its longest side is at most `maxSide`, never enlarging. */
export function scaleToMaxSide(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const ratio = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Walks the shrink steps until one encodes within the budget. Returns null when even the
 * smallest step is too big, so the caller can still refuse the draft honestly.
 */
export async function shrinkToBudget<T extends { dataUrl: string }>(
  budgetChars: number,
  encode: (step: { maxSide: number; quality: number }) => Promise<T | null>,
): Promise<T | null> {
  for (const step of STASH_SHRINK_STEPS) {
    const encoded = await encode(step);
    if (encoded && encoded.dataUrl.length <= budgetChars) return encoded;
  }
  return null;
}

/** Re-encodes an image file as a smaller JPEG data URL in the browser. */
export async function encodeImageForStash(
  file: Blob,
  step: { maxSide: number; quality: number },
): Promise<{ dataUrl: string; mimeType: string } | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  try {
    const { width, height } = scaleToMaxSide(bitmap.width, bitmap.height, step.maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // JPEG has no alpha: paint white first so transparent screenshots do not turn black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/jpeg", step.quality), mimeType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
