import { describe, expect, it } from "vitest";

import { resolveCompatibleRuntimeMode } from "./runtimeModeConfig";

describe("resolveCompatibleRuntimeMode", () => {
  it("offers every mode when the provider reports none", () => {
    expect(resolveCompatibleRuntimeMode("auto", undefined).modes).toHaveLength(4);
    expect(resolveCompatibleRuntimeMode("auto", []).modes).toHaveLength(4);
  });

  it("hides unsupported modes and shows the mode the thread really runs in", () => {
    const supported = ["approval-required", "auto-accept-edits", "full-access"] as const;
    expect(resolveCompatibleRuntimeMode("full-access", supported)).toEqual({
      modes: supported,
      mode: "full-access",
    });
    expect(resolveCompatibleRuntimeMode("auto", supported).mode).toBe("approval-required");
  });
});
