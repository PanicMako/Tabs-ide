import "../../index.css";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DeviceFloatWindow } from "./DevicePanel";
import { DevicePicker } from "./DevicePicker";
import { DeviceSetup } from "./DeviceSetup";
import { DeviceStreamView } from "./DeviceStreamView";
import { DeviceToolsDrawer } from "./DeviceToolsDrawer";
import { acceptDeviceState, useDeviceStore } from "~/device/deviceStore";
import {
  createFakeDeviceApi,
  createFakeMjpegStream,
  fakeDevice,
  fakeDeviceDetail,
  fakeDeviceJpeg,
  fakeDeviceState,
  fakeIosMjpegUrl,
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
  expect(fake.calls[0]).toEqual({
    method: "configure",
    input: { enabled: true },
  });
});

it("picker lists running devices first and opens a device on click", async () => {
  const fake = createFakeDeviceApi();
  acceptDeviceState(
    fakeDeviceState({
      devices: [
        fakeDevice({
          id: "off",
          name: "Pixel",
          platform: "android",
          booted: false,
        }),
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
  expect(fake.calls.at(-1)?.input).toMatchObject({
    type: "setAppearance",
    value: "dark",
  });
});

it.each([240, 300, 540])("keeps the screen and controls inside a %ipx panel", async (width) => {
  acceptDeviceState(fakeDeviceState());
  const view = await render(
    <div style={{ width }} className="dv-panel">
      <DeviceStreamView
        hostId="local"
        deviceId="SIM-1"
        platform="ios"
        visible={false}
        onScreenshot={() => {}}
        onToggleFloat={() => {}}
        onPowerOff={() => {}}
        onToggleTools={() => {}}
      />
    </div>,
  );
  const rail = view.locator.getByRole("group", { name: "Device controls" }).element();
  const screen = view.locator.getByRole("application", { name: "Device screen" }).element();
  const host = view.container.querySelector<HTMLElement>(".dv-panel")!;
  const panelBounds = host.getBoundingClientRect();
  const railBounds = rail.getBoundingClientRect();
  const screenBounds = screen.getBoundingClientRect();
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  expect(railBounds.right).toBeLessThanOrEqual(panelBounds.right);
  expect(screenBounds.right).toBeLessThanOrEqual(panelBounds.right);
  if (width <= 400) expect(railBounds.top).toBeGreaterThan(screenBounds.bottom);
  else expect(railBounds.left).toBeGreaterThan(screenBounds.right);
});

async function renderIosStream(responses: Response[]) {
  const device = fakeDevice({
    hostId: "mac-host",
    id: "SIM-RETRY",
    platform: "ios",
  });
  const state = fakeDeviceState({ devices: [device] });
  const fake = createFakeDeviceApi(state);
  acceptDeviceState(state, fake.api);

  const streamUrl = fakeIosMjpegUrl(state.hubBasePath, device.hostId, device.id);
  const media = new Map(
    responses.map((response, index) => [`${streamUrl}&ticket=${index + 1}`, response]),
  );
  const authorizeVideo = vi
    .fn<(url: string) => Promise<string>>()
    .mockRejectedValue(new Error("Unexpected MJPEG authorization"));
  for (const url of media.keys()) authorizeVideo.mockResolvedValueOnce(url);
  // Leave the independent input socket disconnected.
  fake.api.authorizeMediaUrl = (url) =>
    url === streamUrl ? authorizeVideo(url) : new Promise(() => {});
  const originalFetch = globalThis.fetch;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, options) => {
    const response = media.get(input instanceof Request ? input.url : String(input));
    return response ? Promise.resolve(response) : originalFetch(input, options);
  });

  const container = document.createElement("div");
  const imageError = vi.fn();
  container.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement) imageError(event.isTrusted);
    },
    { capture: true },
  );
  const sendGesture = vi.fn();
  const stream = (visible: boolean) => (
    <DeviceStreamView
      api={fake.api}
      hostId={device.hostId}
      deviceId={device.id}
      platform={device.platform}
      visible={visible}
      manualInput={{ id: "manual", send: sendGesture }}
      onPowerOff={() => {}}
      onToggleTools={() => {}}
    />
  );
  document.body.appendChild(container);
  const view = await render(stream(true), { container });
  return {
    view,
    stream,
    streamUrl,
    authorizeVideo,
    imageError,
    fetch,
    sendGesture,
  };
}

function iosStreamWithCorruptFrame() {
  const stream = createFakeMjpegStream();
  // JPEG start/end markers with no image data trigger Chromium's decoder error.
  stream.writeFrame(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  return stream.response;
}

it("recovers a failed initial iOS live frame while the device screen stays visible", async () => {
  const retry = createFakeMjpegStream();
  retry.writeFrame(await fakeDeviceJpeg(1, 1));
  const { view, streamUrl, authorizeVideo, imageError, fetch } = await renderIosStream([
    iosStreamWithCorruptFrame(),
    retry.response,
  ]);
  const screen = view.locator.getByRole("application", {
    name: "Device screen",
  });
  const liveImage = screen.getByRole("img", { name: "Live device screen" });
  const mountedScreen = screen.element();
  try {
    await expect.element(screen).toBeVisible();
    await expect.poll(() => imageError.mock.calls).toEqual([[true]]);
    await expect
      .poll(() => {
        const image = view.container.querySelector<HTMLImageElement>(
          'img[alt="Live device screen"]',
        );
        return [image?.naturalWidth, image?.naturalHeight];
      })
      .toEqual([1, 1]);
    await expect.element(liveImage).toBeVisible();
    expect(screen.element()).toBe(mountedScreen);
    expect(authorizeVideo.mock.calls).toEqual([[streamUrl], [streamUrl]]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${streamUrl}&ticket=1`,
      `${streamUrl}&ticket=2`,
    ]);
  } finally {
    await view.unmount();
    fetch.mockRestore();
  }
});

it("cancels a scheduled iOS live stream retry when the device screen is hidden", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { view, stream, streamUrl, authorizeVideo, imageError, fetch } = await renderIosStream([
    iosStreamWithCorruptFrame(),
  ]);
  try {
    await expect.poll(() => imageError.mock.calls).toEqual([[true]]);
    expect(vi.getTimerCount()).toBe(1);
    await view.rerender(stream(false));
    expect(vi.getTimerCount()).toBe(0);
    expect(authorizeVideo.mock.calls).toEqual([[streamUrl]]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${streamUrl}&ticket=1`]);
  } finally {
    await view.unmount();
    fetch.mockRestore();
    vi.useRealTimers();
  }
});

it("clears a painted iOS frame on EOF and reconnects to the same device", async () => {
  const first = createFakeMjpegStream();
  first.writeFrame(await fakeDeviceJpeg(16, 16, "red"));
  const next = createFakeMjpegStream();
  const nextFrame = await fakeDeviceJpeg(16, 16, "blue");

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { view, streamUrl, authorizeVideo, imageError, fetch, sendGesture } = await renderIosStream(
    [first.response, next.response],
  );
  try {
    const screen = view.locator.getByRole("application", {
      name: "Device screen",
    });
    const liveImage = screen.getByRole("img", { name: "Live device screen" });
    const mountedScreen = screen.element();
    const context = document.createElement("canvas").getContext("2d")!;
    const frameColor = () => {
      const image = mountedScreen.querySelector("img");
      if (!image?.naturalWidth) return;
      context.drawImage(image, 0, 0, 1, 1);
      const [red, , blue] = context.getImageData(0, 0, 1, 1).data;
      return red! > blue! ? "red" : "blue";
    };
    await expect.poll(frameColor).toBe("red");
    await expect.element(liveImage).toBeVisible();

    const capture = vi.spyOn(mountedScreen, "setPointerCapture").mockImplementation(() => {});
    const pointer = (type: "pointerdown" | "pointerup") => {
      const rect = mountedScreen.getBoundingClientRect();
      mountedScreen.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          isPrimary: true,
          pointerId: 1,
          buttons: type === "pointerdown" ? 1 : 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
    };
    pointer("pointerdown");
    expect(capture).toHaveBeenCalledWith(1);

    first.close();
    await expect.element(liveImage).not.toBeInTheDocument();
    await expect.element(screen.getByText("Connecting to the screen…")).toBeVisible();
    expect(imageError).not.toHaveBeenCalled();
    expect(authorizeVideo.mock.calls).toEqual([[streamUrl]]);
    expect(vi.getTimerCount()).toBe(1);

    await vi.runOnlyPendingTimersAsync();
    expect(authorizeVideo.mock.calls).toEqual([[streamUrl], [streamUrl]]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${streamUrl}&ticket=1`,
      `${streamUrl}&ticket=2`,
    ]);
    next.writeFrame(nextFrame);
    await expect.poll(frameColor).toBe("blue");
    await expect.element(liveImage).toBeVisible();
    expect(screen.element()).toBe(mountedScreen);
    expect(imageError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    pointer("pointerup");
    expect(sendGesture).not.toHaveBeenCalled();
    pointer("pointerdown");
    pointer("pointerup");
    expect(sendGesture).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "tap",
        viewport: { width: 16, height: 16 },
      }),
    );
    capture.mockRestore();
  } finally {
    await view.unmount();
    fetch.mockRestore();
    vi.useRealTimers();
  }
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
    const dialog = page.getByRole("dialog", {
      name: "iPhone 16 floating over the chat",
    });
    await expect.element(dialog).toBeVisible();
    const element = dialog.element() as HTMLElement;
    const before = element.getBoundingClientRect();
    const title = element.querySelector(".dv-float-title") as HTMLElement;
    const box = title.getBoundingClientRect();
    const down = (type: string, x: number, y: number) =>
      title.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y,
          pointerId: 1,
          bubbles: true,
        }),
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
