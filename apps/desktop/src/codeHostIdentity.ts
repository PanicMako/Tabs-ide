import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as Path from "node:path";

export interface CodeHostIdentity {
  machineId: string;
  sqmId: string;
  devDeviceId: string;
}

/** Keep extension-visible identity with user data, rather than the replaceable runtime. */
export function resolveCodeHostIdentity(stateDir: string, vscodeRoot: string): CodeHostIdentity {
  const filename = Path.join(stateDir, "code-oss-desktop", "machine-identity.json");
  const readIdentity = (): CodeHostIdentity => {
    const value = JSON.parse(readFileSync(filename, "utf8")) as Partial<CodeHostIdentity> | null;
    if (
      !value ||
      ![value.machineId, value.sqmId, value.devDeviceId].every(
        (id) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id),
      )
    ) {
      throw new Error(
        "Invalid saved Code-OSS machine identity. Existing identity was not replaced.",
      );
    }
    return value as CodeHostIdentity;
  };
  try {
    return readIdentity();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // Preserve the identity of the runtime already in use on first adoption.
  const hash = (kind: string) => createHash("sha256").update(`${kind}:${vscodeRoot}`).digest("hex");
  const identity = { machineId: hash("machine"), sqmId: hash("sqm"), devDeviceId: hash("dev") };
  mkdirSync(Path.dirname(filename), { recursive: true });
  try {
    writeFileSync(filename, JSON.stringify(identity), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return readIdentity();
    throw error;
  }
  return identity;
}
