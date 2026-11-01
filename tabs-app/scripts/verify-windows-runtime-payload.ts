import { resolve } from "node:path";
import { verifyWindowsRuntimePayload } from "./lib/windows-runtime-payload.ts";

const runtimeRoot = process.argv[2];
if (!runtimeRoot)
  throw new Error("Usage: verify-windows-runtime-payload.ts <packaged-runtime-directory>");
verifyWindowsRuntimePayload(resolve(runtimeRoot));
console.info("Windows editor payload passed production packaging checks.");
