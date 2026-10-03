import { describe, expect, it, vi } from "vitest";
import { DesktopCaptureCoordinator } from "./DesktopCaptureCoordinator";

const electronMocks = vi.hoisted(() => {
  const thumbnailMock = {
    getSize: vi.fn(() => ({ width: 1920, height: 1080 })),
    toDataURL: vi.fn(
      () =>
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    ),
  };

  return {
    thumbnailMock,
    desktopCapturer: {
      getSources: vi.fn(async () => [
        {
          id: "screen:0:0",
          name: "Entire Screen",
          thumbnail: thumbnailMock,
        },
        {
          id: "window:123:0",
          name: "Tabs Dev Root",
          thumbnail: thumbnailMock,
        },
        {
          id: "window:456:0",
          name: "VS Code External",
          thumbnail: thumbnailMock,
        },
      ]),
    },
    systemPreferences: {
      getMediaAccessStatus: vi.fn(() => "granted"),
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
    },
  };
});

vi.mock("electron", () => ({
  desktopCapturer: electronMocks.desktopCapturer,
  systemPreferences: electronMocks.systemPreferences,
  shell: electronMocks.shell,
}));

describe("DesktopCaptureCoordinator", () => {
  it("queries screen permission status", async () => {
    const coordinator = new DesktopCaptureCoordinator();
    const status = await coordinator.getPermissionStatus();
    expect(["granted", "unknown"]).toContain(status);
  });

  it("captures desktop screen and produces PNG capture result", async () => {
    const coordinator = new DesktopCaptureCoordinator();
    const result = await coordinator.captureScreen();

    expect(result.id).toMatch(/^capture-/);
    expect(result.name).toMatch(/^Screenshot .+\.png$/);
    expect(result.mimeType).toBe("image/png");
    expect(result.dataUrl).toContain("data:image/png;base64,");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("filters out own app window when window capture target is specified", async () => {
    const coordinator = new DesktopCaptureCoordinator();
    const result = await coordinator.captureScreen({ target: "window" });

    expect(result).toBeDefined();
    expect(electronMocks.desktopCapturer.getSources).toHaveBeenCalledWith(
      expect.objectContaining({ types: ["window"] }),
    );
  });

  it("fails with user-friendly error when permission is denied", async () => {
    electronMocks.systemPreferences.getMediaAccessStatus.mockReturnValueOnce("denied");
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    try {
      const coordinator = new DesktopCaptureCoordinator();
      await expect(coordinator.captureScreen()).rejects.toThrow(
        /Screen recording permission is required/,
      );
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });
});
