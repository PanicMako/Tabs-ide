import type { DesktopCaptureOptions, DesktopCaptureResult } from "@tabs/contracts";
import { useComposerDraftStore, type ComposerImageAttachment } from "../composerDraftStore";
import { toastManager } from "../components/ui/toast";

/** Converts a base64 data URL into a standard browser File object. */
export function dataUrlToFile(dataUrl: string, name: string, mimeType: string): File {
  const commaIndex = dataUrl.indexOf(",");
  const payload = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: mimeType });
}

export interface DesktopCaptureDependencies {
  captureScreen?: ((options?: DesktopCaptureOptions) => Promise<DesktopCaptureResult>) | undefined;
  requestPermission?: (() => Promise<boolean>) | undefined;
  addImage?: ((threadId: string, image: ComposerImageAttachment) => void) | undefined;
  showToast?:
    | ((toast: { type: "success" | "error" | "info"; title: string; description?: string }) => void)
    | undefined;
  focusComposer?: (() => void) | undefined;
}

/**
 * Captures the desktop display or active window and attaches the resulting screenshot
 * directly into the composer draft for the target thread.
 */
export async function captureDesktopToComposer(
  threadId: string,
  deps: DesktopCaptureDependencies = {},
  options?: DesktopCaptureOptions,
): Promise<DesktopCaptureResult | null> {
  const captureScreen =
    deps.captureScreen ??
    (typeof window !== "undefined" ? window.desktopBridge?.captureDesktopScreen : undefined);
  if (!captureScreen) {
    throw new Error("Desktop capture is only available when running in the native desktop app.");
  }

  try {
    const result = await captureScreen(options);
    const file = dataUrlToFile(result.dataUrl, result.name, result.mimeType);

    const addImage =
      deps.addImage ?? ((tId, img) => useComposerDraftStore.getState().addImage(tId as any, img));
    addImage(threadId, {
      type: "image",
      id: result.id,
      name: result.name,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      previewUrl: result.dataUrl,
      file,
    });

    const showToast = deps.showToast ?? ((t) => toastManager.add(t));
    showToast({
      type: "success",
      title: "Screenshot attached",
      description: "Added capture to composer.",
    });

    if (deps.focusComposer) {
      deps.focusComposer();
    } else if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tabs:focus-composer"));
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to capture screen.";
    const showToast = deps.showToast ?? ((t) => toastManager.add(t));
    showToast({
      type: "error",
      title: "Capture failed",
      description: message,
    });
    throw error;
  }
}
