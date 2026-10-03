import { describe, expect, it, vi } from "vitest";
import { ChromiumKeyError, deriveKey, resolveChromiumKeys } from "./ChromiumKeys";

describe("Linux cookie key material", () => {
  it("derives v11 from the selected browser's Secret Service key", async () => {
    const lookup = vi.fn().mockResolvedValue("synthetic-secret");
    const keys = await resolveChromiumKeys(
      { platform: "linux", linuxSecretApplication: "chromium" },
      lookup,
    );
    expect(lookup).toHaveBeenCalledWith("chromium");
    expect(keys.cbcV11).toEqual(deriveKey("synthetic-secret", 1));
    expect(keys.cbcV10).toEqual(deriveKey("peanuts", 1));
  });
  it("preserves legacy import and a structured warning when the keyring is unavailable", async () => {
    const keys = await resolveChromiumKeys(
      { platform: "linux", linuxSecretApplication: "chrome" },
      vi.fn().mockRejectedValue(new Error("private detail")),
    );
    expect(keys.cbcV11).toBeUndefined();
    expect(keys.cbcV11Error).toBeInstanceOf(ChromiumKeyError);
    expect(keys.cbcV11Error?.message).not.toContain("private detail");
    expect(keys.cbcV10).toHaveLength(16);
  });
});
