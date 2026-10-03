import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assert, describe, it } from "@effect/vitest";

describe("create-mac-preview-update-manifest", () => {
  it("embeds release notes inside the signed manifest", () => {
    const directory = mkdtempSync(join(tmpdir(), "tabs-mac-update-manifest-"));
    writeFileSync(join(directory, "Tabs-1.4.0-arm64.zip"), "arm64 update");
    writeFileSync(join(directory, "Tabs-1.4.0-x64.zip"), "x64 update");
    const releaseNotesPath = join(directory, "v1.4.0.md");
    writeFileSync(releaseNotesPath, "## What changed\n\n- Faster startup\n");

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const scriptPath = fileURLToPath(
      new URL("./create-mac-preview-update-manifest.ts", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        scriptPath,
        directory,
        "1.4.0",
        "PanicMako/Tabs-ide",
        releaseNotesPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TABS_MAC_UPDATE_PRIVATE_KEY: privateKey
            .export({ format: "pem", type: "pkcs8" })
            .toString(),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);

    const manifestBytes = readFileSync(join(directory, "tabs-mac-preview-update.json"));
    const signature = Buffer.from(
      readFileSync(join(directory, "tabs-mac-preview-update.json.sig"), "utf8").trim(),
      "base64",
    );
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      releaseNotes?: string;
      assets?: { arm64?: { sha512?: string }; x64?: { sha512?: string } };
    };

    assert.equal(manifest.releaseNotes, "## What changed\n\n- Faster startup");
    assert.ok(manifest.assets?.arm64?.sha512);
    assert.ok(manifest.assets?.x64?.sha512);
    assert.equal(verify(null, manifestBytes, publicKey, signature), true);
  });
});
