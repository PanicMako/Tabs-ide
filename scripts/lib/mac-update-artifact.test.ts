import { describe, expect, it } from "vitest";

import { updateMacUpdateMetadata } from "./mac-update-artifact";

describe("updateMacUpdateMetadata", () => {
  it("rewrites metadata after the signed updater ZIP is regenerated", () => {
    const updated = updateMacUpdateMetadata(
      `version: 1.3.15
files:
  - url: Tabs-1.3.15-arm64.zip
    sha512: old-file-hash
    size: 123
path: Tabs-1.3.15-arm64.zip
sha512: old-top-level-hash
releaseDate: '2026-09-22T00:00:00.000Z'
`,
      "Tabs-1.3.15-arm64.zip",
      "new-hash",
      456,
    );

    expect(updated).toContain("    sha512: new-hash\n    size: 456");
    expect(updated).toContain("\nsha512: new-hash\n");
    expect(updated).not.toContain("old-file-hash");
  });

  it("rejects metadata for a different artifact", () => {
    expect(() =>
      updateMacUpdateMetadata(
        "path: Tabs-other.zip\nurl: Tabs-other.zip\nsha512: old\nsize: 1\n",
        "Tabs-1.3.15-arm64.zip",
        "new",
        2,
      ),
    ).toThrow("does not reference");
  });
});
