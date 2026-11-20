import "../../index.css";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DeviceFloatWindow } from "./DevicePanel";
import { DevicePicker } from "./DevicePicker";
import { DeviceSetup } from "./DeviceSetup";
import { DeviceToolsDrawer } from "./DeviceToolsDrawer";
import { acceptDeviceState, useDeviceStore } from "~/device/deviceStore";
import {
  createFakeDeviceApi,
  fakeDevice,
  fakeDeviceDetail,
  fakeDeviceState,
} from "~/device/fakeDeviceApi";

beforeEach(() => useDeviceStore.setState({ state: null, error: null, refreshing: false }));

it("setup does nothing until the user starts the hub, then finishes with the agent choice", async () => {
  const fake = createFakeDeviceApi();
  acceptDeviceState(
    fakeDeviceState({
      hostStatus: "idle",
      onboardingCompleted: false,
      hosts: [{ ...fakeDeviceState().hosts[0]!, hubInstalled: false }],
    }),
  );
  await render(<DeviceSetup api={fake.api} />);
  expect(fake.calls).toHaveLength(0);
  await page.getByRole("button", { name: "Install and start" }).click();
  expect(fake.calls[0]).toEqual({ method: "configure", input: { enabled: true } });
});

it("picker lists running devices first and opens a device on click", async () => {
  const fake = createFakeDeviceApi();
  acceptDeviceState(
    fakeDeviceState({
      devices: [
        fakeDevice({ id: "off", name: "Pixel", platform: "android", booted: false }),
        fakeDevice({ id: "on", name: "iPhone 16", booted: true }),
      ],
    }),
  );
  const onChoose = vi.fn();
  await render(<DevicePicker api={fake.api} onChoose={onChoose} />);
  await expect.element(page.getByRole("button", { name: "Open iPhone 16" })).toBeVisible();
  await page.getByRole("button", { name: "Start Pixel" }).click();
  expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: "off" }));
});

it("tools drawer shows only what the platform reads back and sends actions", async () => {
  const fake = createFakeDeviceApi();
  fake.api.detail = async () =>
    fakeDeviceDetail({ settings: { appearance: "light", voiceOver: false } });
  await render(
    <DeviceToolsDrawer
      api={fake.api}
      hostId="local"
      deviceId="SIM-1"
      platform="ios"
      open
      onClose={() => {}}
    />,
  );
  await expect.element(page.getByText("VoiceOver")).toBeVisible();
  expect(page.getByText("Network").elements()).toHaveLength(0);
  await page.getByRole("button", { name: "dark" }).click();
  expect(fake.calls.at(-1)?.input).toMatchObject({ type: "setAppearance", value: "dark" });
});

it("keeps the controls rail inside a narrow panel", async () => {
  const { DeviceStreamView } = await import("./DeviceStreamView");
  acceptDeviceState(fakeDeviceState());
  const view = await render(
    <div style={{ width: 300 }} className="dv-panel">
      <DeviceStreamView
        deviceId="SIM-1"
        platform="ios"
        visible={false}
        onPowerOff={() => {}}
        onToggleTools={() => {}}
      />
    </div>,
  );
  const rail = view.container.querySelector<HTMLElement>(".dv-rail")!;
  const host = view.container.querySelector<HTMLElement>(".dv-panel")!;
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  expect(rail.getBoundingClientRect().right).toBeLessThanOrEqual(
    host.getBoundingClientRect().right,
  );
});

it("floats over the chat, moves when dragged, stays on screen, and returns", async () => {
  const onMove = vi.fn();
  const onReturn = vi.fn();
  const view = await render(
    <DeviceFloatWindow title="iPhone 16" x={100} y={100} onMove={onMove} onReturn={onReturn}>
      <p>screen</p>
    </DeviceFloatWindow>,
  );
  try {
    const dialog = page.getByRole("dialog", { name: "iPhone 16 floating over the chat" });
    await expect.element(dialog).toBeVisible();
    const element = dialog.element() as HTMLElement;
    const before = element.getBoundingClientRect();
    const title = element.querySelector(".dv-float-title") as HTMLElement;
    const box = title.getBoundingClientRect();
    const down = (type: string, x: number, y: number) =>
      title.dispatchEvent(
        new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
      );
    down("pointerdown", box.left + 20, box.top + 10);
    down("pointermove", box.left - 10, box.top + 10);
    down("pointerup", box.left - 10, box.top + 10);
    await expect.poll(() => element.getBoundingClientRect().left).toBeCloseTo(before.left - 30, 0);
    expect(onMove).toHaveBeenCalled();
    const rect = element.getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    await page.getByRole("button", { name: "Return to panel" }).click();
    expect(onReturn).toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});
