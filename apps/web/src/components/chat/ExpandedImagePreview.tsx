export interface ExpandedImageItem {
  src: string;
  name: string;
  type?: "image" | "video";
  originalUrl?: string;
}

export interface ExpandedImagePreview {
  images: ExpandedImageItem[];
  index: number;
}

export function buildExpandedImagePreview(
  images: ReadonlyArray<{ id: string; name: string; previewUrl?: string; type?: string }>,
  selectedImageId: string,
): ExpandedImagePreview | null {
  const previewableImages = images.flatMap((image) =>
    image.previewUrl
      ? [
          {
            id: image.id,
            src: image.previewUrl,
            name: image.name,
            type: (image.type === "video" ? "video" : "image") as "image" | "video",
          },
        ]
      : [],
  );
  if (previewableImages.length === 0) {
    return null;
  }
  const selectedIndex = previewableImages.findIndex((image) => image.id === selectedImageId);
  if (selectedIndex < 0) {
    return null;
  }
  return {
    images: previewableImages.map((image) => ({
      src: image.src,
      name: image.name,
      type: image.type,
    })),
    index: selectedIndex,
  };
}

/** Fetches a media source as a Blob. Handles data URLs, blob URLs, and remote/local URLs. */
export async function readMediaBlob(src: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(src);
  } catch (cause) {
    throw new Error(
      "The file could not be fetched. The connection may be unavailable or blocked by CORS.",
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(`The file could not be fetched (HTTP ${response.status}).`);
  }
  return response.blob();
}

/** Downloads media with the specified filename via Blob Object URL. */
export async function downloadMedia(src: string, filename: string): Promise<void> {
  const blob = await readMediaBlob(src);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || "image";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** Converts an image blob to PNG via an offscreen HTML5 canvas. */
export async function convertBlobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") {
    return blob;
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 1;
    const height = img.naturalHeight || 1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not create 2D canvas context for image conversion.");
    }
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error("Failed to encode image to PNG."))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Copies an image to the system clipboard in PNG format. */
export async function copyImageToClipboard(src: string): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error("Clipboard image copying is not supported in this browser environment.");
  }

  const rawBlob = await readMediaBlob(src);
  const pngBlob = await convertBlobToPng(rawBlob);

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": pngBlob,
    }),
  ]);
}
