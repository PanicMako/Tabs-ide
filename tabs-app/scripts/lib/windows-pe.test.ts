import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { windowsPeMachine } from "./windows-pe";

describe("Windows installed application architecture", () => {
  it("distinguishes x64, ARM64 and the 32-bit installer, rejecting incomplete headers", () => {
    const directory = mkdtempSync(join(tmpdir(), "tabs-pe-"));
    const filename = join(directory, "Tabs.exe");
    try {
      for (const machine of [0x8664, 0xaa64, 0x14c]) {
        const header = Buffer.alloc(134);
        header.write("MZ");
        header.writeUInt32LE(128, 60);
        header.writeUInt32LE(0x4550, 128);
        header.writeUInt16LE(machine, 132);
        writeFileSync(filename, header);
        expect(windowsPeMachine(filename)).toBe(machine);
      }
      writeFileSync(filename, "MZ");
      expect(() => windowsPeMachine(filename)).toThrow("DOS header");
      const invalid = Buffer.alloc(64);
      invalid.write("MZ");
      invalid.writeUInt32LE(4096, 60);
      writeFileSync(filename, invalid);
      expect(() => windowsPeMachine(filename)).toThrow("PE header");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
