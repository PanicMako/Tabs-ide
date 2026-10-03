import { describe, expect, it } from "vitest";

import { trimNonEmpty } from "./publicConfig";

describe("cloud public configuration", () => {
  it("treats blank public values as unconfigured", () => {
    expect(trimNonEmpty(undefined)).toBeNull();
    expect(trimNonEmpty("   ")).toBeNull();
    expect(trimNonEmpty(" configured ")).toBe("configured");
  });
});
