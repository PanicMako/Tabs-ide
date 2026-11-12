import "../index.css";
import "../interface-study.css";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DesktopExtensionBoundsInput } from "@tabs/contracts";
import { WorkbenchPreview } from "./onboarding/WorkbenchPreview";
import { NotificationHistoryPanel } from "./NotificationHistoryPanel";
import { ExtensionToolSurface } from "./ExtensionToolSurface";
import { useNativeSurfaceOverlaySuspension } from "../nativeSurfaceOverlay";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "./ui/dialog";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

it("keeps Labs tool tabs as evenly rounded pills", async () => {
  // Tool tabs only exist inside the Labs interface study, in either skin. They
  // are pill chips (Code, Agents, Dock, Git, Browser), rounded on every corner.
  const html = document.documentElement;
  const previous = html.getAttribute("data-interface-study");
  const view = await render(
    <button className="study-tool-tab active" role="tab">
      Code
    </button>,
  );
  try {
    for (const skin of ["light", "dark"]) {
      html.setAttribute("data-interface-study", skin);
      const style = getComputedStyle(view.container.querySelector("button")!);
      const corners = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ];
      expect(new Set(corners).size, `Labs ${skin} tool tab corners: ${corners}`).toBe(1);
      expect(Number.parseFloat(corners[0]!)).toBeGreaterThan(0);
    }
  } finally {
    if (previous === null) html.removeAttribute("data-interface-study");
    else html.setAttribute("data-interface-study", previous);
    await view.unmount();
  }
});

it("keeps onboarding project tabs consistent with the real workspace", async () => {
  const view = await render(
    <div>
      <div data-slot="workspace-project-tab" data-testid="real-tab" className="rounded-t-xl">
        tabs
      </div>
      <WorkbenchPreview />
    </div>,
  );
  try {
    // The setup preview must draw project tabs exactly like the workspace does.
    const real = getComputedStyle(view.container.querySelector('[data-testid="real-tab"]')!);
    const tab = getComputedStyle(
      view.container.querySelector('[aria-label="Explore example projects"] button')!,
    );
    expect(Number.parseFloat(real.borderTopLeftRadius)).toBeGreaterThan(0);
    expect(tab.borderTopLeftRadius).toBe(real.borderTopLeftRadius);
    expect(tab.borderTopRightRadius).toBe(real.borderTopRightRadius);
    expect(tab.borderBottomLeftRadius).toBe("0px");
  } finally {
    await view.unmount();
  }
});

it("suspends native tools while Notification History is open and resumes them on close", async () => {
  const suspend = vi.fn(),
    resume = vi.fn();
  function Harness() {
    useNativeSurfaceOverlaySuspension({
      enabled: true,
      surfaceReady: true,
      onSuspend: suspend,
      onResume: resume,
    });
    return <NotificationHistoryPanel />;
  }
  const view = await render(<Harness />);
  try {
    const trigger = page.getByRole("button", { name: /^Notifications(?: \(\d+ unread\))?$/ });
    await trigger.click();
    await expect.element(page.getByRole("dialog", { name: "Notification history" })).toBeVisible();
    await expect.poll(() => suspend.mock.calls.length).toBe(1);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => resume.mock.calls.length).toBe(1);
  } finally {
    await view.unmount();
  }
});

it.each([false, true])(
  "preserves extension activation around dialogs (loading: %s)",
  async (loading) => {
    const previous = window.desktopBridge;
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const hide = vi.fn(async () => {});
    const bounds = vi.fn(async (_input: DesktopExtensionBoundsInput) => {});
    const activate = vi.fn(async () => {
      if (loading) await ready;
    });
    window.desktopBridge = {
      activateExtensionTool: activate,
      setExtensionBounds: bounds,
      hideExtensionTool: hide,
    } as unknown as NonNullable<typeof window.desktopBridge>;
    const view = await render(
      <div style={{ width: 500, height: 300 }}>
        <ExtensionToolSurface
          input={{
            projectId: "audit",
            extensionId: "audit.tool",
            toolId: "main",
            profileId: "default",
          }}
          label="Audit"
          source="exchange"
        />
      </div>,
    );
    let modal: Awaited<ReturnType<typeof render>> | undefined;
    const latestBounds = () => bounds.mock.calls.at(-1)?.[0];
    try {
      if (!loading) await expect.poll(() => latestBounds()?.visible).toBe(true);
      modal = await render(
        <Dialog open>
          <DialogPopup>
            <DialogTitle>Audit modal</DialogTitle>
            <DialogDescription>Overlay probe</DialogDescription>
          </DialogPopup>
        </Dialog>,
      );
      await expect.element(page.getByRole("dialog", { name: "Audit modal" })).toBeVisible();
      // Give overlay detection a turn before completing the pending activation.
      if (loading) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        resolveReady();
      }
      await expect.poll(() => latestBounds()?.visible).toBe(false);
      const activationId = latestBounds()!.activationId;
      view.container.firstElementChild!.setAttribute("style", "width:550px;height:300px");
      await expect.poll(() => latestBounds()?.width).toBe(550);
      expect(latestBounds()?.visible).toBe(false);
      await modal.unmount();
      modal = undefined;
      await expect.poll(() => latestBounds()?.visible).toBe(true);
      expect(latestBounds()?.activationId).toBe(activationId);
      expect(activate).toHaveBeenCalledOnce();
      expect(hide).not.toHaveBeenCalled();
    } finally {
      resolveReady();
      await modal?.unmount();
      await view.unmount();
      if (previous) window.desktopBridge = previous;
      else delete window.desktopBridge;
    }
  },
);
