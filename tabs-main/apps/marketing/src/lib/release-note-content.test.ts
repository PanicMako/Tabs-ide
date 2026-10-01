import { describe, expect, it } from "vitest";
import { resolveReleaseNotes } from "./release-note-content";

describe("release note content", () => {
  it("uses authored in-site notes for v1.3.5", () => {
    const notes = resolveReleaseNotes(
      "v1.3.5",
      "**Full Changelog**: https://github.com/PanicMako/Tabs-ide/compare/v1.3.4...v1.3.5",
    );
    expect(notes).toContain("Antigravity protocol");
    expect(notes).not.toContain("Full Changelog");
  });

  it("uses authored in-site notes for v1.3.4", () => {
    const notes = resolveReleaseNotes(
      "v1.3.4",
      "**Full Changelog**: https://github.com/PanicMako/Tabs-ide/compare/v1.3.3...v1.3.4",
    );
    expect(notes).toContain("Toast notifications over native views");
    expect(notes).not.toContain("Full Changelog");
  });

  it("uses authored in-site notes for v1.3.3", () => {
    const notes = resolveReleaseNotes(
      "v1.3.3",
      "**Full Changelog**: https://github.com/PanicMako/Tabs-ide/compare/v1.3.2...v1.3.3",
    );
    expect(notes).toContain("Workspace skills");
    expect(notes).not.toContain("Full Changelog");
  });

  it("uses authored in-site notes for v1.3.2 instead of the generated comparison link", () => {
    const notes = resolveReleaseNotes(
      "v1.3.2",
      "**Full Changelog**: https://github.com/PanicMako/Tabs-ide/compare/v1.3.1...v1.3.2",
    );
    expect(notes).toContain("steadier embedded editor");
    expect(notes).not.toContain("Full Changelog");
  });

  it("keeps an authored GitHub release body intact", () => {
    expect(resolveReleaseNotes("v9.9.9", "## New\n\n- A real change")).toBe(
      "## New\n\n- A real change",
    );
    expect(resolveReleaseNotes("v1.3.4", "## Corrected public notes\n\n- A shipped change")).toBe(
      "## Corrected public notes\n\n- A shipped change",
    );
  });

  it("uses the existing curated entry for an older generated release", () => {
    expect(
      resolveReleaseNotes(
        "v1.3.1",
        "**Full Changelog**: https://github.com/PanicMako/Tabs-ide/compare/v1.3.0...v1.3.1",
      ),
    ).toContain("Standalone installers");
  });
});
