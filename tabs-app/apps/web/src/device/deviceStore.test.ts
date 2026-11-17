import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptDeviceState,
  configureDevices,
  inspectDevices,
  openDevice,
  startDeviceStateSubscription,
  useDeviceStore,
} from "./deviceStore";
import { createFakeDeviceApi, fakeDevice, fakeDeviceState } from "./fakeDeviceApi";
import {
  canStreamVideo,
  deviceSetupSteps,
  devicePlatformNotes,
  groupDevicesByHost,
  isDeviceSetupComplete,
} from "./deviceLogic";

beforeEach(() => useDeviceStore.setState({ state: null, error: null, refreshing: false }));

describe("deviceStore", () => {
  it("applies snapshots from the subscription and ignores stale revisions", () => {
    const fake = createFakeDeviceApi(fakeDeviceState({ revision: 5 }));
    const stop = startDeviceStateSubscription(fake.api);
    expect(useDeviceStore.getState().state?.revision).toBe(5);
    acceptDeviceState(fakeDeviceState({ revision: 3 }));
    expect(useDeviceStore.getState().state?.revision).toBe(5);
    stop();
    fake.push(fakeDeviceState({ revision: 6 }));
    expect(useDeviceStore.getState().state?.revision).toBe(5);
  });

  it("inspects without installing, and configures through the api", async () => {
    const fake = createFakeDeviceApi();
    await inspectDevices(fake.api);
    expect(fake.calls[0]).toEqual({ method: "list", input: { inspectOnly: true } });
    await configureDevices(fake.api, { enabled: true });
    expect(fake.calls[1]).toEqual({ method: "configure", input: { enabled: true } });
  });

  it("surfaces failures as text instead of throwing", async () => {
    const fake = createFakeDeviceApi();
    fake.api.open = () => Promise.reject(new Error("boom"));
    expect(await openDevice(fake.api, {} as never)).toBeNull();
    expect(useDeviceStore.getState().error).toBe("boom");
  });
});

describe("deviceLogic", () => {
  it("reports setup progress without starting anything", () => {
    expect(deviceSetupSteps(null).every((step) => !step.done)).toBe(true);
    const done = fakeDeviceState();
    expect(isDeviceSetupComplete(done)).toBe(true);
    expect(isDeviceSetupComplete(fakeDeviceState({ onboardingCompleted: false }))).toBe(false);
    expect(isDeviceSetupComplete(fakeDeviceState({ hostStatus: "disabled" }))).toBe(false);
  });

  it("explains the missing Android toolchain with the exact fix", () => {
    const notes = devicePlatformNotes(fakeDeviceState());
    expect(notes.find((n) => n.platform === "ios")?.fix).toBeNull();
    expect(notes.find((n) => n.platform === "android")?.fix).toContain("ANDROID_HOME");
  });

  it("lists running devices first", () => {
    const state = fakeDeviceState({
      devices: [
        fakeDevice({ id: "a", name: "A", booted: false }),
        fakeDevice({ id: "b", name: "B", booted: true }),
      ],
    });
    expect(groupDevicesByHost(state)[0]?.devices.map((d) => d.id)).toEqual(["b", "a"]);
  });

  it("allows video only on secure origins", () => {
    expect(canStreamVideo({ protocol: "http:", hostname: "localhost" })).toBe(true);
    expect(canStreamVideo({ protocol: "http:", hostname: "192.168.1.5" })).toBe(false);
    expect(canStreamVideo({ protocol: "https:", hostname: "x.test" })).toBe(true);
  });
});

import { deviceToolUpdatePolicy, nodeMeetsSshRequirement } from "./deviceToolVersions";
describe("deviceToolVersions", () => {
  it("checks the SSH Node requirement", () => {
    expect(nodeMeetsSshRequirement("v22.12.0")).toBe(true);
    expect(nodeMeetsSshRequirement("v22.11.9")).toBe(false);
    expect(nodeMeetsSshRequirement("v24.0.0")).toBe(true);
    expect(nodeMeetsSshRequirement("junk")).toBe(false);
  });
  it("says versions are unchecked without data", () => {
    expect(deviceToolUpdatePolicy(undefined)).toContain("not been checked");
  });
});
