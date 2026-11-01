import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { windowsNsisTemplateDirectory, writeWindowsNsisScripts } from "./windows-nsis";
import {
  writeWindowsPackedInventory,
  verifyWindowsStagedRuntime,
} from "./windows-packed-inventory";

describe("full-fat Windows installer commit", () => {
  it("checks staged files with the same inventory reader and rejects missing full-fat markers", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-staged-"));
    try {
      for (const name of [
        "Tabs.exe",
        "resources/app.asar",
        "resources/tabs-code-oss/out/vs/code/electron-browser/workbench/workbench-dev.html",
        "resources/tabs-code-oss/out/nls.messages.json",
        "resources/tabs-code-oss/out-build/nls.messages.json",
        "resources/tabs-code-oss/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
        ...["typescript.js", "lib.d.ts", "lib.es5.d.ts", "lib.dom.d.ts"].map(
          (name) => `resources/tabs-code-oss/extensions/node_modules/typescript/lib/${name}`,
        ),
      ]) {
        const filename = path.join(directory, name);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, "runtime");
      }
      const runtime = path.join(directory, "resources/tabs-code-oss");
      fs.writeFileSync(path.join(runtime, "tabs-payload.json"), "{}");
      const count = writeWindowsPackedInventory(runtime);
      expect(verifyWindowsStagedRuntime(directory)).toBe(count);
      fs.writeFileSync(path.join(runtime, "unexpected.js"), "extra");
      expect(() => verifyWindowsStagedRuntime(directory)).toThrow("expected");
      fs.unlinkSync(path.join(runtime, "unexpected.js"));
      fs.unlinkSync(path.join(directory, "resources/app.asar"));
      expect(() => verifyWindowsStagedRuntime(directory)).toThrow();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("preserves the stock installer lifecycle and adds a checked directory move with copy fallback", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-nsis-test-"));
    try {
      const stock = fs.readFileSync(
        path.join(windowsNsisTemplateDirectory(), "installer.nsi"),
        "utf8",
      );
      const script = writeWindowsNsisScripts(directory);
      expect(
        fs.readFileSync(path.join(windowsNsisTemplateDirectory(), "installer.nsi"), "utf8"),
      ).toBe(stock);
      expect(fs.readdirSync(directory).sort()).toEqual([
        "windows-extract-override.nsh",
        "windows-install-phases.nsh",
        "windows-packed-inventory.cjs",
      ]);
      const extraction = fs.readFileSync(script, "utf8");
      expect(extraction).toContain("!macroundef extractUsing7za");
      expect(extraction).toContain('$installMode != "all"');
      expect(extraction.indexOf("verify-staged-runtime.ps1")).toBeLessThan(
        extraction.indexOf('Rename "$PLUGINSDIR\\7z-out" "$INSTDIR"'),
      );
      expect(extraction).toContain('RMDir "$INSTDIR"');
      expect(extraction).not.toContain('RMDir /r "$INSTDIR"');
      expect(extraction).toContain('CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR');
      expect(extraction).toContain("RetryExtract7za:");
      expect(extraction).toContain("AbortExtract7za:");
      expect(extraction).not.toContain("APP_PACKAGE_URL");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("inventories the actual packed editor rather than files excluded by electron-builder", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-inventory-test-"));
    try {
      fs.writeFileSync(
        path.join(directory, "tabs-payload.json"),
        JSON.stringify({ files: 10, sourceMapBytesRemoved: 123 }),
      );
      fs.mkdirSync(path.join(directory, "out"));
      fs.writeFileSync(path.join(directory, "out", "main.js"), "export {};\n");
      expect(writeWindowsPackedInventory(directory)).toBe(1);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, "tabs-payload.json"), "utf8"),
      );
      expect(manifest).toEqual({ files: 10, sourceMapBytesRemoved: 123, packedFiles: 1 });
      expect(writeWindowsPackedInventory(directory)).toBe(1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
