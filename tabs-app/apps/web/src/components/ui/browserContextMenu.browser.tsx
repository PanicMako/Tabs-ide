import "../../index.css";
import type { DesktopBrowserContextMenuPayload } from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MotionDurationPreview } from "../settings/MotionDurationPreview";
import { applyTestColorScheme, resetTestColorScheme } from "../../test/colorScheme";
import { ContextMenuHost } from "./ContextMenuHost";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

it("draws the snapshot, confirms it, shows the themed menu and reports the chosen id", async () => {
  applyTestColorScheme("dark");
  let emit: ((payload: DesktopBrowserContextMenuPayload) => void) | null = null;
  const ready = vi.fn().mockResolvedValue(undefined);
  const resolve = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "desktopBridge", {
    configurable: true,
    writable: true,
    value: {
      onBrowserContextMenu: (listener: typeof emit) => {
        emit = listener;
        return () => {
          emit = null;
        };
      },
      browserContextMenuReady: ready,
      resolveBrowserContextMenu: resolve,
    },
  });
  const view = await render(
    <div className="h-72 w-96 bg-background text-foreground">
      <ContextMenuHost />
    </div>,
  );
  try {
    await vi.waitFor(() => expect(emit).not.toBeNull());
    emit!({
      token: "tok-1",
      snapshot: PNG,
      bounds: { x: 10, y: 10, width: 200, height: 160 },
      point: { x: 60, y: 50 },
      items: [
        { id: "copy-link", label: "Copy link address" },
        { id: "back", label: "Back", disabled: true },
        { id: "reload", label: "Reload" },
      ],
    });
    await expect.element(page.getByRole("menuitem", { name: "Reload" })).toBeVisible();
    expect(ready).toHaveBeenCalledWith("tok-1");
    expect(document.querySelector('[data-slot="browser-context-menu-snapshot"]')).not.toBeNull();
    await page.screenshot({ path: "__screenshots__/browser-context-menu-dark.png" });
    await page.getByRole("menuitem", { name: "Reload" }).click();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith("tok-1", "reload"));
    await expect
      .poll(() => document.querySelector('[data-slot="browser-context-menu-snapshot"]'))
      .toBeNull();
  } finally {
    await view.unmount();
    Reflect.deleteProperty(window, "desktopBridge");
    resetTestColorScheme();
  }
});

it("motion duration preview reads as a small panel window, not a stray line", async () => {
  applyTestColorScheme("light");
  const view = await render(
    <div className="flex items-center gap-3 bg-background p-4 text-foreground">
      Panel animations <MotionDurationPreview durationMs={0} />
    </div>,
  );
  try {
    const box = document.querySelector<HTMLElement>('[data-slot="motion-duration-preview"]')!;
    expect(box.getBoundingClientRect().height).toBeGreaterThanOrEqual(20);
    await page.screenshot({ path: "__screenshots__/motion-duration-preview-light.png" });
  } finally {
    await view.unmount();
    resetTestColorScheme();
  }
});
