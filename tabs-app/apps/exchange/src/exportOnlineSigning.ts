import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { unlockBackup } from "../frontend/src/lib/releaseSigning.ts";
import { onlineSigningConfig } from "./metadataRenewal.ts";

/** Run on the operator's device. Never send the root key or backup to the job. */
export async function exportOnlineSigning(
  backupFile: string,
  outputFile: string,
  origin: string,
  password: string,
): Promise<void> {
  if (!Path.isAbsolute(backupFile) || !Path.isAbsolute(outputFile))
    throw new Error("Use absolute backup and output paths.");
  const stat = await FS.stat(backupFile);
  if (!stat.isFile() || stat.size > 100_000) throw new Error("Invalid encrypted signing backup.");
  const backup = await unlockBackup(await FS.readFile(backupFile, "utf8"), password, origin);
  await FS.writeFile(outputFile, JSON.stringify(onlineSigningConfig(backup)), {
    flag: "wx",
    mode: 0o600,
  });
}

if (import.meta.main) {
  const [backupFile, outputFile, origin] = process.argv.slice(2);
  if (!backupFile || !outputFile || !origin)
    throw new Error(
      "Usage: bun src/exportOnlineSigning.ts /absolute/backup.json /absolute/online-keys.json https://registry.example",
    );
  if (!process.stdin.isTTY)
    throw new Error(
      "Unlock the backup interactively on the operator's device; passwords must not appear in command arguments.",
    );
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const terminal = createInterface({ input: process.stdin, output: muted, terminal: true });
  const controller = new AbortController();
  terminal.once("SIGINT", () => controller.abort());
  process.stdout.write("Signing backup password (hidden): ");
  try {
    const password = await terminal.question("", { signal: controller.signal });
    process.stdout.write("\n");
    await exportOnlineSigning(backupFile, outputFile, origin, password);
    process.stdout.write(
      "Exported private non-root signing keys to the protected output file. Store it as the renewal job secret; never commit it.\n",
    );
  } finally {
    terminal.close();
    muted.end();
  }
}
