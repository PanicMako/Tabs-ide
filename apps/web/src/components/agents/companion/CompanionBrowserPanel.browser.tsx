import "../../../index.css";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { RightPanelTabs } from "../../RightPanelTabs";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { emptyBrowserState } from "./browserSession";
vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    projectId: "project",
    projectName: "Project",
    cwd: "/workspace",
  }),
}));
vi.mock("~/state/workspaceShell", () => ({ useProjectWorkspaceSettings: () => null }));
vi.mock("./CompanionFilesPanel", () => ({ CompanionFilesPanel: () => null }));
vi.mock("./CompanionDiffPanel", () => ({ CompanionDiffPanel: () => null }));
vi.mock("./CompanionTerminalPanel", () => ({ CompanionTerminalPanel: () => null }));
vi.mock("./CompanionPRPanel", () => ({ CompanionPRPanel: () => null }));
vi.mock("~/components/NativePreviewAutomationHost", () => ({
  isNativeBrowserRecordingActive: () => false,
  startNativeBrowserRecording: vi.fn(),
  stopNativeBrowserRecording: vi.fn(),
}));
const scope = "local:project";
const originalBridge = window.desktopBridge;
const originalWorkspace = useCompanionSurfaceStore.getState().workspaces;
const originalPanel = useRightPanelStore.getState();
let sessionId: string;
let bridge: ReturnType<typeof mockBridge>;
function mockBridge() {
  return {
    onBrowserSessionState: vi.fn(() => vi.fn()),
    getBrowserHostState: vi.fn(async () => ({ available: true })),
    ensureBrowserSession: vi.fn(async () => {}),
    getBrowserSessionState: vi.fn(async () => ({
      ...emptyBrowserState("project", sessionId),
      currentUrl: "https://example.test/preserved",
      pageTitle: "Preserved page",
      canGoBack: true,
    })),
    activateBrowserSession: vi.fn(async () => {}),
    hideBrowserSession: vi.fn(async () => {}),
    setBrowserBounds: vi.fn(async () => {}),
    setBrowserZoomFactor: vi.fn(async () => {}),
    setBrowserAudioMuted: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  useCompanionSurfaceStore.setState({ workspaces: {} });
  const id = useCompanionSurfaceStore.getState().open(scope, "browser");
  sessionId = `agents-surface-${id}`;
  useRightPanelStore.setState({ activeTab: "browser", choosingSurface: false, maximized: false });
  bridge = mockBridge();
  window.desktopBridge = bridge as unknown as NonNullable<Window["desktopBridge"]>;
});
afterEach(() => {
  if (originalBridge) window.desktopBridge = originalBridge;
  else delete window.desktopBridge;
  useCompanionSurfaceStore.setState({ workspaces: originalWorkspace });
  useRightPanelStore.setState(originalPanel);
});
function Harness({ visible = true }: { visible?: boolean }) {
  return (
    <div style={{ width: 560, height: 500 }}>
      <RightPanelTabs mode="sidebar" visible={visible} onClose={() => {}} />
    </div>
  );
}
it("uses one compact navigation row and keeps preview tools accessible", async () => {
  const view = await render(<Harness />);
  try {
    await expect
      .element(page.getByLabelText("Browser URL"))
      .toHaveValue("https://example.test/preserved");
    expect(document.querySelectorAll(".companion-toolbar")).toHaveLength(1);
    expect(document.querySelector(".companion-heading")).toBeNull();
    expect(
      document.querySelector(".companion-browser-toolbar")!.getBoundingClientRect().height,
    ).toBeLessThanOrEqual(48);
    await page.getByRole("button", { name: "Browser tools" }).click();
    const menu = page.getByRole("menu").element();
    const contents = menu.querySelector(".overflow-y-auto")!;
    expect(contents.scrollWidth).toBeLessThanOrEqual(contents.clientWidth);
    await page.getByRole("menuitemradio", { name: "Mobile" }).click();
    expect(useCompanionSurfaceStore.getState().workspaces[scope]?.tabs[0]?.viewportWidth).toBe(390);
    await page.getByRole("menuitem", { name: "Zoom in" }).click();
    expect(bridge.setBrowserZoomFactor).toHaveBeenCalledWith({
      projectId: "project",
      sessionId,
      zoomFactor: 1.1,
    });
  } finally {
    await view.unmount();
  }
});
it("detaches the native page on panel close and restores its existing session on reopen", async () => {
  const view = await render(<Harness />);
  try {
    await vi.waitFor(() => expect(bridge.activateBrowserSession).toHaveBeenCalledOnce());
    await page.getByRole("button", { name: "Browser tools" }).click();
    await vi.waitFor(() => expect(bridge.hideBrowserSession).toHaveBeenCalled());
    await view.rerender(<Harness visible={false} />);
    await vi.waitFor(() =>
      expect(bridge.setBrowserBounds).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectId: "project", sessionId, visible: false }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bridge.activateBrowserSession).toHaveBeenCalledOnce();
    expect(document.querySelector(".companion-browser-host")).toBeNull();
    await view.rerender(<Harness />);
    await expect
      .element(page.getByLabelText("Browser URL"))
      .toHaveValue("https://example.test/preserved");
    await vi.waitFor(() => expect(bridge.activateBrowserSession).toHaveBeenCalledTimes(2));
    expect(bridge.activateBrowserSession).toHaveBeenLastCalledWith({
      projectId: "project",
      sessionId,
    });
  } finally {
    await view.unmount();
  }
});
it("does not resurrect a page when startup finishes after its panel closes", async () => {
  let finish!: () => void;
  bridge.ensureBrowserSession.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = await render(<Harness />);
  try {
    await vi.waitFor(() => expect(finish).toBeDefined());
    await view.rerender(<Harness visible={false} />);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bridge.activateBrowserSession).not.toHaveBeenCalled();
    expect(bridge.setBrowserBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId, visible: false }),
    );
  } finally {
    await view.unmount();
  }
});
