import { describe, expect, it } from "vitest";
import { resolveNativeCodeExtensionEnvironment } from "./nativeCodeHostExtensionEnvironment";

describe("native extension-host project environment", () => {
  const projects = new Map([
    [3, "a"],
    [7, "b"],
  ]);
  it("restores missing identity from the registered response window", () => {
    expect(resolveNativeCodeExtensionEnvironment(3, { PATH: "/bin" }, projects)).toEqual({
      PATH: "/bin",
      TABS_PROJECT_ID: "a",
    });
  });
  it("overrides stale identity without mutating the supplied environment", () => {
    const original = { TABS_PROJECT_ID: "a", OTHER: "preserved" };
    expect(resolveNativeCodeExtensionEnvironment(7, original, projects)).toEqual({
      TABS_PROJECT_ID: "b",
      OTHER: "preserved",
    });
    expect(original.TABS_PROJECT_ID).toBe("a");
  });
  it("rejects unregistered or disposed windows instead of inheriting another project", () => {
    expect(() =>
      resolveNativeCodeExtensionEnvironment(9, { TABS_PROJECT_ID: "a" }, projects),
    ).toThrow("registered project window");
    expect(() => resolveNativeCodeExtensionEnvironment(3, {}, new Map())).toThrow(
      "registered project window",
    );
  });
});
