import { desktopCapturer, shell, systemPreferences } from "electron";
import type {
  DesktopCaptureOptions,
  DesktopCapturePermissionStatus,
  DesktopCaptureResult,
} from "@tabs/contracts";

export class DesktopCaptureCoordinator {
  async getPermissionStatus(): Promise<DesktopCapturePermissionStatus> {
    if (process.platform === "darwin") {
      try {
        const status = systemPreferences.getMediaAccessStatus("screen");
        if (
          status === "granted" ||
          status === "denied" ||
          status === "restricted" ||
          status === "not-determined"
        ) {
          return status;
        }
        return "unknown";
      } catch {
        return "unknown";
      }
    }
    return "granted";
  }

  async requestPermission(): Promise<boolean> {
    if (process.platform === "darwin") {
      try {
        const current = systemPreferences.getMediaAccessStatus("screen");
        if (current === "granted") return true;

        // On macOS, calling desktopCapturer triggers the permission prompt if status is not-determined
        if (current === "not-determined") {
          try {
            await desktopCapturer.getSources({
              types: ["screen"],
              thumbnailSize: { width: 1, height: 1 },
            });
          } catch {
            // ignore probe error
          }
          if (systemPreferences.getMediaAccessStatus("screen") === "granted") {
            return true;
          }
        }

        // Direct user to System Settings -> Privacy & Security -> Screen Recording
        await shell
          .openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
          )
          .catch(() => undefined);
        return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  async captureScreen(options: DesktopCaptureOptions = {}): Promise<DesktopCaptureResult> {
    const perm = await this.getPermissionStatus();
    if (perm === "denied" || perm === "restricted") {
      throw new Error(
        "Screen recording permission is required. Please grant Screen Recording permissions in System Settings.",
      );
    }

    const width = Math.min(Math.max(options.thumbnailWidth ?? 1920, 320), 3840);
    const height = Math.min(Math.max(options.thumbnailHeight ?? 1080, 240), 2160);
    const types: Array<"screen" | "window"> =
      options.target === "window" ? ["window"] : ["screen", "window"];

    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });

    if (sources.length === 0) {
      throw new Error("No display screen or window was found to capture.");
    }

    // Privacy safeguard: Avoid selecting Tabs' own window if capturing external windows
    const external =
      options.target === "window" && sources.length > 1
        ? sources.find(
            (s) =>
              !s.name.toLowerCase().includes("tabs") && !s.name.toLowerCase().includes("electron"),
          )
        : null;
    const selected = external ?? sources[0];
    if (!selected) {
      throw new Error("No display screen or window was found to capture.");
    }

    const thumbnail = selected.thumbnail;
    const size = thumbnail.getSize();
    const dataUrl = thumbnail.toDataURL();

    // Approximate raw PNG byte size from base64 dataUrl length
    const base64Content = dataUrl.split(",", 2)[1] ?? "";
    const sizeBytes = Math.round((base64Content.length * 3) / 4);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = `Screenshot ${timestamp}.png`;
    const id = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      name,
      mimeType: "image/png",
      dataUrl,
      sizeBytes,
      width: size.width,
      height: size.height,
    };
  }
}
