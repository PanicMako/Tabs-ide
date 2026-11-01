import { closeSync, openSync, readSync } from "node:fs";

/** Inspect the installed application, separately from the NSIS bootstrapper. */
export function windowsPeMachine(filename: string): number {
  const descriptor = openSync(filename, "r");
  try {
    const dos = Buffer.alloc(64);
    if (
      readSync(descriptor, dos, 0, dos.length, 0) !== dos.length ||
      dos.toString("ascii", 0, 2) !== "MZ"
    )
      throw new Error("Invalid Windows executable DOS header.");
    const pe = Buffer.alloc(6);
    if (
      readSync(descriptor, pe, 0, pe.length, dos.readUInt32LE(60)) !== pe.length ||
      pe.readUInt32LE(0) !== 0x4550
    )
      throw new Error("Invalid Windows executable PE header.");
    return pe.readUInt16LE(4);
  } finally {
    closeSync(descriptor);
  }
}
