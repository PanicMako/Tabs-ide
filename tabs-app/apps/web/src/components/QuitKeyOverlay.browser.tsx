import "../index.css";
import { afterEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { QuitKeyOverlay } from "./QuitKeyOverlay";

afterEach(() => {
  delete (window as { desktopBridge?: unknown }).desktopBridge;
});

it("shows hold progress from the desktop bridge and hides when it ends", async () => {
  let push: (state: { progress: number | null; armed: boolean }) => void = () => {};
  (window as { desktopBridge?: unknown }).desktopBridge = {
    onQuitKeyProgress: (listener: typeof push) => {
      push = listener;
      return () => {};
    },
  };
  const view = await render(<QuitKeyOverlay />);
  try {
    const overlay = document.querySelector<HTMLElement>('[data-testid="quit-key-overlay"]')!;
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    push({ progress: 0.5, armed: false });
    await expect.poll(() => overlay.textContent).toContain("Keep holding");
    expect(overlay.getAttribute("aria-hidden")).toBe("false");
    push({ progress: null, armed: true });
    await expect.poll(() => overlay.textContent).toContain("again to quit");
    push({ progress: null, armed: false });
    await expect.poll(() => overlay.getAttribute("aria-hidden")).toBe("true");
  } finally {
    await view.unmount();
  }
});
