import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
  "starts with a private runtime copy of a read-only hosting secret without logging its contents",
  async () => {
    const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-secret-start-test-"));
    try {
      const bin = Path.join(directory, "bin");
      await FS.mkdir(bin);
      const source = Path.join(directory, "source.json"),
        recorded = Path.join(directory, "recorded-path");
      await FS.writeFile(source, "private-key-sentinel", { mode: 0o444 });
      await FS.writeFile(
        Path.join(bin, "bun"),
        '#!/bin/sh\nprintf "%s" "$EXCHANGE_ONLINE_SIGNING_KEY_FILE" > "$STARTUP_TEST_RECORD"\n',
        { mode: 0o700 },
      );
      const result = spawnSync(
        "/bin/sh",
        [fileURLToPath(new URL("../start.sh", import.meta.url))],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            TMPDIR: directory,
            EXCHANGE_ONLINE_SIGNING_KEY_FILE: source,
            STARTUP_TEST_RECORD: recorded,
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("private-key-sentinel");
      const runtimeFile = await FS.readFile(recorded, "utf8");
      expect(runtimeFile).not.toBe(source);
      expect((await FS.stat(runtimeFile)).mode & 0o777).toBe(0o600);
      expect(await FS.readFile(runtimeFile, "utf8")).toBe("private-key-sentinel");
      expect((await FS.stat(source)).mode & 0o777).toBe(0o444);
    } finally {
      await FS.rm(directory, { recursive: true, force: true });
    }
  },
);
