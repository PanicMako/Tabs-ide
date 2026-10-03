import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readPublishedThemes } from "./environmentTheme.ts";

describe("environment themes", () => {
  it("reads valid bounded theme files in stable order", () => {
    const directory = mkdtempSync(join(tmpdir(), "tabs-environment-themes-"));
    writeFileSync(
      join(directory, "zinc.json"),
      JSON.stringify({ name: "Zinc", appearance: "dark", canvas: "#111", accent: "#38bdf8" }),
    );
    writeFileSync(
      join(directory, "amber.json"),
      JSON.stringify({
        name: "Amber",
        appearance: "light",
        colors: { background: "#fff", primary: "#b45309" },
      }),
    );

    expect(readPublishedThemes(directory).map((theme) => theme.id)).toEqual(["amber", "zinc"]);
  });

  it("ignores malformed, colorless, reserved, and symlinked files", () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-environment-themes-"));
    const directory = join(root, "themes");
    mkdirSync(directory);
    writeFileSync(join(directory, "broken.json"), "{");
    writeFileSync(
      join(directory, "empty.json"),
      JSON.stringify({ name: "Empty", appearance: "dark" }),
    );
    writeFileSync(
      join(directory, "system.json"),
      JSON.stringify({ name: "Reserved", appearance: "dark", canvas: "#000", accent: "#fff" }),
    );
    const outside = join(root, "outside.json");
    writeFileSync(
      outside,
      JSON.stringify({ name: "Outside", appearance: "dark", canvas: "#000", accent: "#fff" }),
    );
    symlinkSync(outside, join(directory, "linked.json"));

    expect(readPublishedThemes(directory)).toEqual([]);
  });
});
