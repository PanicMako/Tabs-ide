import { expect, it, vi } from "vitest";

import {
  createDeviceScreenshotAuthorizationRequests,
  DEVICE_SCREENSHOT_AUTHORIZATION_CHANNEL,
} from "./deviceScreenshotAuthorizationIpc";

it("accepts a screenshot challenge reply only from its originating frame and request", async () => {
  const requests = createDeviceScreenshotAuthorizationRequests();
  const frame = { detached: false, send: vi.fn() };
  const otherFrame = { detached: false, send: vi.fn() };
  const first = requests.request(frame, "first");
  const second = requests.request(frame, "second");
  await expect(requests.request(otherFrame, "first")).resolves.toBe(false);
  expect(frame.send.mock.calls).toEqual([
    [DEVICE_SCREENSHOT_AUTHORIZATION_CHANNEL, "first"],
    [DEVICE_SCREENSHOT_AUTHORIZATION_CHANNEL, "second"],
  ]);

  requests.reply(otherFrame, "first", true);
  requests.reply(frame, "second", true);
  requests.reply(frame, "first", false);
  await expect(first).resolves.toBe(false);
  await expect(second).resolves.toBe(true);
});

it("denies a screenshot challenge when its frame detaches or its reply times out", async () => {
  vi.useFakeTimers();
  try {
    const requests = createDeviceScreenshotAuthorizationRequests();
    const frame = { detached: false, send: vi.fn() };
    const detached = requests.request(frame, "detached");
    const late = requests.request(frame, "late");
    frame.detached = true;
    requests.reply(frame, "detached", true);
    await expect(detached).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(10_001);
    requests.reply(frame, "late", true);
    await expect(late).resolves.toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
