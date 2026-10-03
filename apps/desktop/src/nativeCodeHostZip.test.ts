import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createNativeCodeZip } from "./nativeCodeHostZip";

describe("createNativeCodeZip", () => {
  it("prepares bounded inline and local-file entries", async () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-native-zip-"));
    const source = Path.join(root, "source.bin");
    FS.writeFileSync(source, Buffer.from([1, 2, 3, 4]));
    const zip = vi.fn(async (destination: string) => FS.writeFileSync(destination, "zip"));

    await createNativeCodeZip(
      zip,
      { fsPath: Path.join(root, "out", "report.zip") },
      [
        { path: "summary.txt", contents: "ok" },
        { path: "data/source.bin", source: { fsPath: source }, size: 3 },
      ],
      { maxEntries: 2, maxSize: 10 },
    );

    expect(zip).toHaveBeenCalledWith(Path.join(root, "out", "report.zip"), [
      { path: "summary.txt", contents: "ok" },
      {
        path: "data/source.bin",
        localPath: source,
        localPathSize: 3,
      },
    ]);
  });

  it("rejects duplicate and escaping entry paths", async () => {
    const zip = vi.fn();
    await expect(
      createNativeCodeZip(zip, { fsPath: "/tmp/out.zip" }, [
        { path: "same", contents: "1" },
        { path: "same", contents: "2" },
      ]),
    ).rejects.toThrow("Duplicate ZIP entry");
    await expect(
      createNativeCodeZip(zip, { fsPath: "/tmp/out.zip" }, [{ path: "../outside", contents: "x" }]),
    ).rejects.toThrow("Invalid ZIP entry path");
    expect(zip).not.toHaveBeenCalled();
  });
});
