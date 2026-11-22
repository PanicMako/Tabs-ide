import { describe, expect, it } from "vitest";
import { describeComputerUsePermissions } from "./computerUsePermissionCopy";

describe("describeComputerUsePermissions", () => {
  it("reports an unsupported platform as one failing line", () => {
    const lines = describeComputerUsePermissions({
      platformSupported: false,
      accessibility: false,
      screenRecording: "unknown",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.ok).toBe(false);
  });

  it("maps granted, denied and unknown states", () => {
    const granted = describeComputerUsePermissions({
      platformSupported: true,
      accessibility: true,
      screenRecording: "granted",
    });
    expect(granted.map((line) => line.ok)).toEqual([true, true]);

    const missing = describeComputerUsePermissions({
      platformSupported: true,
      accessibility: false,
      screenRecording: "denied",
    });
    expect(missing.map((line) => line.ok)).toEqual([false, false]);
    expect(missing[0]?.detail).toContain("Accessibility");

    const unknown = describeComputerUsePermissions({
      platformSupported: true,
      accessibility: true,
      screenRecording: "unknown",
    });
    expect(unknown[1]?.ok).toBeNull();
  });
});

describe("computerUseSetupSteps", () => {
  it("is ready once Accessibility is granted and marks screen recording optional", async () => {
    const m = await import("./computerUsePermissionCopy");
    const status = {
      platformSupported: true,
      accessibility: true,
      screenRecording: "denied",
    } as const;
    expect(m.computerUseReady(status)).toBe(true);
    const steps = m.computerUseSetupSteps(status);
    expect(steps.map((step) => step.state)).toEqual(["granted", "missing"]);
    expect(steps[1]?.optional).toBe(true);
    expect(m.computerUseReady({ ...status, accessibility: false })).toBe(false);
  });
});
