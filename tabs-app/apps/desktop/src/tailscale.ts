import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface TailscaleStatus {
  available: boolean;
  running: boolean;
  magicDnsName: string | null;
  ipv4: string | null;
}

function firstString(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function parseStatus(value: unknown): TailscaleStatus {
  if (typeof value !== "object" || value === null) {
    throw new Error("Tailscale returned an invalid status response.");
  }
  const record = value as Record<string, unknown>;
  const self =
    typeof record.Self === "object" && record.Self !== null
      ? (record.Self as Record<string, unknown>)
      : null;
  const dnsName = typeof self?.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : null;
  return {
    available: true,
    running: record.BackendState === "Running",
    magicDnsName: dnsName && dnsName.length > 0 ? dnsName : null,
    ipv4: firstString(self?.TailscaleIPs),
  };
}

export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  const executable = process.platform === "win32" ? "tailscale.exe" : "tailscale";
  try {
    const { stdout } = await exec(executable, ["status", "--json"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return parseStatus(JSON.parse(stdout) as unknown);
  } catch (cause) {
    // A stopped or signed-out daemon is different from an absent executable;
    // the UI should suggest starting Tailscale rather than reinstalling it.
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    return {
      available: code !== "ENOENT",
      running: false,
      magicDnsName: null,
      ipv4: null,
    };
  }
}
