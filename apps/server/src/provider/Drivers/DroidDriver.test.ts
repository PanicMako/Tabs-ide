import { ProviderDriverKind } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { DROID_MAINTENANCE } from "./DroidDriver.ts";

describe("Droid maintenance routing", () => {
  it("uses the standalone updater for Factory's native install path", () => {
    expect(
      DROID_MAINTENANCE.resolve({
        binaryPath: "/Users/test/.local/bin/droid",
        platform: "darwin",
        env: { PATH: "" },
      }).update?.command,
    ).toBe("droid update");
  });

  it("uses Homebrew for a Homebrew-managed binary", () => {
    expect(
      DROID_MAINTENANCE.resolve({
        binaryPath: "/opt/homebrew/bin/droid",
        platform: "darwin",
        env: { PATH: "" },
      }).update?.command,
    ).toBe("brew upgrade droid");
  });

  it("does not update an explicitly managed custom binary", () => {
    expect(
      DROID_MAINTENANCE.resolve({
        binaryPath: "/company/mdm/bin/droid",
        platform: "darwin",
        env: { PATH: "" },
      }),
    ).toEqual({
      provider: "droid" as ProviderDriverKind,
      packageName: "droid",
      update: null,
    });
  });
});
