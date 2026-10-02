import { createHash } from "node:crypto";

// The recipe includes instructions and metadata defaults, not just package bytes.
export function developerReleaseIdentity(apiVersion, packageDigests, desktopVersion, recipe) {
  const input = JSON.stringify({ apiVersion, packageDigests, desktopVersion, recipe });
  return `${apiVersion}-${createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
}
