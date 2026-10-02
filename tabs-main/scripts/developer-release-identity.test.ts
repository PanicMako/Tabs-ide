import { describe, expect, it } from "vitest";
import { developerReleaseIdentity } from "./developer-release-identity.mjs";

describe("immutable developer release identity", () => {
  it("is stable for the same packages and complete build recipe", () => {
    const recipe = JSON.stringify({ source: "build", runtime: { node: "22", zlib: "1" } });
    expect(developerReleaseIdentity("1.7.0", ["abc", "def"], "1.0.0", recipe)).toBe(
      developerReleaseIdentity("1.7.0", ["abc", "def"], "1.0.0", recipe),
    );
  });
  it("does not reuse an immutable URL across compression runtimes", () => {
    const node = JSON.stringify({ source: "build", runtime: { node: "22", zlib: "1" } });
    const bun = JSON.stringify({ source: "build", runtime: { node: "22", bun: "1" } });
    expect(developerReleaseIdentity("1.7.0", ["abc", "def"], "1.0.0", node)).not.toBe(
      developerReleaseIdentity("1.7.0", ["abc", "def"], "1.0.0", bun),
    );
  });
});
