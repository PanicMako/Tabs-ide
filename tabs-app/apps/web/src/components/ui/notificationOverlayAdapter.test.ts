import { describe, expect, it, vi } from "vitest";
import React from "react";
import {
  extractTextContent,
  handleNotificationOverlayAction,
  handleNotificationOverlayDismiss,
  isDesktopNotificationOverlayAvailable,
  serializeToastToPayload,
  syncNotificationOverlayToBridge,
} from "./notificationOverlayAdapter";

describe("notificationOverlayAdapter", () => {
  describe("extractTextContent", () => {
    it("extracts text from strings and numbers", () => {
      expect(extractTextContent("Hello")).toBe("Hello");
      expect(extractTextContent(42)).toBe("42");
      expect(extractTextContent(null)).toBe("");
      expect(extractTextContent(undefined)).toBe("");
    });

    it("extracts text recursively from React elements and arrays", () => {
      const element = React.createElement(
        "div",
        null,
        "Hello ",
        React.createElement("span", null, "World"),
        "!",
      );
      expect(extractTextContent(element)).toBe("Hello World!");
    });
  });

  describe("serializeToastToPayload", () => {
    it("serializes basic toast options into a clean NotificationToastPayload", () => {
      const payload = serializeToastToPayload({
        id: "toast-1",
        type: "success",
        title: "Saved",
        description: "Your changes were saved successfully.",
      });

      expect(payload).toEqual(
        expect.objectContaining({
          id: "toast-1",
          type: "success",
          title: "Saved",
          description: "Your changes were saved successfully.",
          duration: 5000,
        }),
      );
    });

    it("converts actionProps to an action payload without transferring functions", () => {
      const onClick = vi.fn();
      const payload = serializeToastToPayload({
        id: "toast-action",
        type: "error",
        title: "Failed to connect",
        actionProps: {
          children: "Retry",
          onClick,
        },
      });

      expect(payload.action).toEqual({
        actionId: "primary",
        label: "Retry",
      });
      // Functions are not exposed in payload
      expect(payload).not.toHaveProperty("onClick");
    });

    it("defaults invalid types to info", () => {
      const payload = serializeToastToPayload({
        id: "toast-unknown",
        type: "not-a-real-type" as any,
        title: "Notice",
      });
      expect(payload.type).toBe("info");
    });

    it("keeps creation time stable when an existing toast is synchronized again", () => {
      const first = serializeToastToPayload({ id: "stable-toast", title: "Working" });
      const second = serializeToastToPayload({ id: "stable-toast", title: "Working" });
      expect(second.createdAt).toBe(first.createdAt);
    });
  });

  describe("syncNotificationOverlayToBridge", () => {
    it("safely resolves if bridge is undefined or does not support overlay", async () => {
      await expect(syncNotificationOverlayToBridge(undefined, [])).resolves.toBeUndefined();
      await expect(syncNotificationOverlayToBridge({} as any, [])).resolves.toBeUndefined();
    });

    it("syncs serialized payloads to the desktop bridge", async () => {
      const syncSpy = vi.fn().mockResolvedValue(undefined);
      const bridge = { syncNotificationOverlay: syncSpy };

      await syncNotificationOverlayToBridge(bridge, [
        {
          id: "toast-1",
          type: "info",
          title: "Update Available",
        },
      ]);

      expect(syncSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "toast-1",
          type: "info",
          title: "Update Available",
        }),
      ]);
    });
  });

  describe("handleNotificationOverlayAction", () => {
    it("routes action callbacks to the correct matching toast", () => {
      const onRetry = vi.fn();
      const toasts = [
        {
          id: "toast-1",
          title: "Notice",
        },
        {
          id: "toast-2",
          title: "Error",
          actionProps: {
            children: "Retry",
            onClick: onRetry,
          },
        },
      ];

      const handled = handleNotificationOverlayAction(toasts, {
        toastId: "toast-2",
        actionId: "primary",
      });

      expect(handled).toBe(true);
      expect(onRetry).toHaveBeenCalledTimes(1);

      // Unknown action or toast
      expect(
        handleNotificationOverlayAction(toasts, {
          toastId: "unknown",
          actionId: "primary",
        }),
      ).toBe(false);
    });
  });

  describe("handleNotificationOverlayDismiss", () => {
    it("calls toast onClose and closes the toast in the manager", () => {
      const onClose = vi.fn();
      const manager = { close: vi.fn() };
      const toasts = [
        {
          id: "toast-1",
          title: "Completed",
          data: { onClose },
        },
      ];

      const handled = handleNotificationOverlayDismiss(toasts, { toastId: "toast-1" }, manager);

      expect(handled).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(manager.close).toHaveBeenCalledWith("toast-1");
    });
  });

  describe("isDesktopNotificationOverlayAvailable", () => {
    it("returns false in node or browser without desktopBridge", () => {
      expect(isDesktopNotificationOverlayAvailable()).toBe(false);
    });

    it("keeps DOM notifications enabled in popout windows", () => {
      const previousWindow = globalThis.window;
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          desktopBridge: {
            isPopout: true,
            syncNotificationOverlay: vi.fn(),
          },
        },
      });

      expect(isDesktopNotificationOverlayAvailable()).toBe(false);

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    });
  });
});
