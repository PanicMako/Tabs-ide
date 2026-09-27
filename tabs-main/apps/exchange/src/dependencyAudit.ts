import * as FS from "node:fs/promises";
import * as Path from "node:path";

const OSV_QUERY_BATCH = "https://api.osv.dev/v1/querybatch";
const MAX_LOCK_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGES = 200;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const BATCH_SIZE = 50;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface DependencyAudit {
  readonly status: "not-declared" | "complete" | "partial" | "unsupported" | "unavailable";
  readonly packagesChecked: number;
  readonly packagesSkipped: number;
  readonly findings: ReadonlyArray<{
    readonly name: string;
    readonly version: string;
    readonly advisoryId: string;
  }>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function packageName(path: string): string | null {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) return null;
  const segments = path.slice(index + marker.length).split("/");
  const name = segments[0]?.startsWith("@")
    ? segments.length === 2
      ? segments.join("/")
      : null
    : segments.length === 1
      ? segments[0]
      : null;
  return name && name.length <= 214 && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ? name : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("Dependency advisory service failed.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Dependency advisory response is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** Advisory only: a lockfile is not proof that a dependency is present in bundled assets. */
export async function auditNpmDependencies(
  directory: string,
  files: readonly string[],
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<DependencyAudit> {
  const empty = { packagesChecked: 0, packagesSkipped: 0, findings: [] } as const;
  if (!files.includes("package-lock.json")) return { status: "not-declared", ...empty };
  try {
    const file = Path.join(directory, "package-lock.json");
    const stat = await FS.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LOCK_BYTES) {
      return { status: "unsupported", ...empty };
    }
    let lock: unknown;
    try {
      lock = JSON.parse(await FS.readFile(file, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) return { status: "unsupported", ...empty };
      throw error;
    }
    if (
      !record(lock) ||
      (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) ||
      !record(lock.packages)
    ) {
      return { status: "unsupported", ...empty };
    }
    const packages = new Map<string, { name: string; version: string }>();
    let skipped = 0;
    let examined = 0;
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path.includes("node_modules/")) continue;
      examined++;
      if (examined > MAX_PACKAGES * 2) return { status: "unsupported", ...empty };
      const name = path.length <= 512 ? packageName(path) : null;
      const version = record(entry) ? entry.version : undefined;
      const resolved = record(entry) ? entry.resolved : undefined;
      if (
        !name ||
        typeof version !== "string" ||
        version.length > 100 ||
        !VERSION.test(version) ||
        typeof resolved !== "string" ||
        !resolved.startsWith("https://registry.npmjs.org/")
      ) {
        skipped++;
        continue;
      }
      packages.set(`${name}@${version}`, { name, version });
      if (packages.size > MAX_PACKAGES || skipped > MAX_PACKAGES) {
        return { status: "unsupported", ...empty };
      }
    }
    const list = [...packages.values()];
    const findings: Array<{ name: string; version: string; advisoryId: string }> = [];
    for (let offset = 0; offset < list.length; offset += BATCH_SIZE) {
      const batch = list.slice(offset, offset + BATCH_SIZE);
      const response = await request(OSV_QUERY_BATCH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          queries: batch.map(({ name, version }) => ({
            package: { ecosystem: "npm", name },
            version,
          })),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await boundedJson(response);
      if (!record(body) || !Array.isArray(body.results) || body.results.length !== batch.length) {
        throw new Error("Dependency advisory response is invalid.");
      }
      for (const [index, result] of body.results.entries()) {
        if (!record(result) || (result.vulns !== undefined && !Array.isArray(result.vulns))) {
          throw new Error("Dependency advisory response is invalid.");
        }
        if (result.next_page_token !== undefined) {
          throw new Error("Dependency advisory result is incomplete.");
        }
        for (const vulnerability of (result.vulns ?? []) as unknown[]) {
          if (
            !record(vulnerability) ||
            typeof vulnerability.id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(vulnerability.id)
          ) {
            throw new Error("Dependency advisory response is invalid.");
          }
          findings.push({ ...batch[index]!, advisoryId: vulnerability.id });
          if (findings.length > 500) throw new Error("Too many dependency advisories.");
        }
      }
    }
    return {
      status: skipped ? "partial" : "complete",
      packagesChecked: list.length,
      packagesSkipped: skipped,
      findings,
    };
  } catch {
    return { status: "unavailable", ...empty };
  }
}
