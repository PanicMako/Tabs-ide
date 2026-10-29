import { createHash } from "node:crypto";
import * as path from "node:path";

export function deepSeekHarnessHome(stateDir: string, instanceId: string): string {
  return path.join(
    stateDir,
    "harnesses",
    "deepseek",
    createHash("sha256").update(instanceId).digest("hex").slice(0, 16),
  );
}
