import { describe, expect, it } from "vitest";
import { developerReleaseIdentity } from "../../../scripts/developer-release-identity.mjs";

describe("developer release identity", () => {
  const identity = (digests = ["sdk", "cli"], desktop = "1.0.0", recipe = "instructions") =>
    developerReleaseIdentity("1.7.0", digests, desktop, recipe);

  it("is deterministic and retains the versioned download directory format", () => {
    expect(identity()).toBe(identity());
    expect(identity()).toMatch(/^1\.7\.0-[a-f0-9]{16}$/);
  });

  it("changes when package bytes, desktop compatibility, or setup instructions change", () => {
    const original = identity();
    expect(identity(["new-sdk", "cli"])).not.toBe(original);
    expect(identity(["sdk", "new-cli"])).not.toBe(original);
    expect(identity(undefined, "2.0.0")).not.toBe(original);
    expect(identity(undefined, undefined, "corrected instructions")).not.toBe(original);
  });
});
