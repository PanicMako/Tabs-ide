import { assert, describe, it } from "@effect/vitest";

import {
  readBlockScalar,
  readReleaseNotes,
  verifyDesktopUpdateMetadata,
} from "./verify-desktop-update-metadata.ts";

const notes = "## What changed\n\n- Faster startup\n- Safer updates";
const manifest = `version: 1.4.0
files:
  - url: Tabs-1.4.0-x64.exe
    sha512: abc
    size: 123
releaseNotes: |-
  ## What changed

  - Faster startup
  - Safer updates
releaseDate: '2026-09-21T12:00:00.000Z'
`;

describe("verify-desktop-update-metadata", () => {
  it("extracts and verifies exact multiline release notes", () => {
    assert.equal(readBlockScalar(manifest, "releaseNotes"), notes);
    assert.doesNotThrow(() => verifyDesktopUpdateMetadata(manifest, "1.4.0", notes, "latest.yml"));
  });

  it("extracts and verifies quoted release notes from Windows latest.yml", () => {
    const quotedManifest = `version: 1.4.0\nreleaseNotes: "${notes.replace(/\n/g, "\\r\\n")}"\n`;
    assert.equal(readReleaseNotes(quotedManifest), notes);
    assert.doesNotThrow(() =>
      verifyDesktopUpdateMetadata(quotedManifest, "1.4.0", notes, "latest.yml"),
    );
  });

  it("rejects missing, stale, or mismatched release notes", () => {
    assert.throws(
      () => verifyDesktopUpdateMetadata(manifest, "1.4.1", notes, "latest.yml"),
      /expected 1\.4\.1/,
    );
    assert.throws(
      () => verifyDesktopUpdateMetadata(manifest, "1.4.0", "different", "latest.yml"),
      /exact release notes/,
    );
    assert.throws(
      () =>
        verifyDesktopUpdateMetadata(
          "version: 1.4.0\nreleaseDate: now\n",
          "1.4.0",
          notes,
          "latest.yml",
        ),
      /exact release notes/,
    );
  });
});
