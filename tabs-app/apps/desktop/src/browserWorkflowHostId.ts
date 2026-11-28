import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Bind the journal to this installation and Chromium storage partition across desktop restarts. */
export function browserWorkflowHostKey(
  userDataDir: string,
  storagePath: string,
  createIfMissing = true,
): string {
  const file = join(userDataDir, "browser-workflow-host-id");
  const read = () => readFileSync(file, "utf8");
  let installationId: string;
  try {
    installationId = read();
  } catch (error) {
    if (!createIfMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    installationId = randomUUID();
    try {
      writeFileSync(file, installationId, { flag: "wx", mode: 0o600 });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      installationId = read();
    }
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(installationId)) {
    throw new Error("The saved browser workflow host identity is invalid.");
  }
  return createHash("sha256")
    .update(JSON.stringify([installationId, storagePath]))
    .digest("hex");
}

/** Keep ordinary input out of a draft while its journal owns the Submit action.
 * The directory contains only hashes. No tab URLs or account data are persisted here. */
export class BrowserSubmissionGuards {
  private entries?: Set<string>;
  constructor(private readonly userDataDir: () => string) {}
  private directory() {
    return join(this.userDataDir(), "browser-submission-guards");
  }
  private load() {
    if (!this.entries) {
      try {
        this.entries = new Set(readdirSync(this.directory()));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.entries = new Set();
      }
    }
    return this.entries;
  }
  private key(partition: string, url: string) {
    return createHash("sha256")
      .update(JSON.stringify([partition, url]))
      .digest("hex");
  }
  private draftAddress(url: string) {
    // A fragment can change without loading a different form.
    return url.split("#", 1)[0] ?? url;
  }
  /** The same draft reached through a query string, a trailing slash or letter case. */
  private aliasAddress(url: string): string | undefined {
    const parsed = URL.parse(url);
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) return undefined;
    const path = parsed.pathname.replace(/\/+$/u, "") || "/";
    return `${parsed.origin}${path}`;
  }
  private aliasKey(partition: string, url: string) {
    const alias = this.aliasAddress(url);
    return alias === undefined
      ? undefined
      : createHash("sha256")
          .update(JSON.stringify(["alias", partition, alias]))
          .digest("hex");
  }
  has(partition: string | undefined, url: string) {
    if (!partition?.startsWith("persist:") || !url) return false;
    const entries = this.load();
    const alias = this.aliasKey(partition, url);
    return (
      entries.has(this.key(partition, this.draftAddress(url))) ||
      // Existing guard files can still contain a hash of the original full URL.
      entries.has(this.key(partition, url)) ||
      (alias !== undefined && entries.has(alias))
    );
  }
  /** Drafts guarded in this run, so a page showing the same visible draft ID can be recognised. */
  private readonly identities = new Map<
    string,
    { partition: string; origin: string; selector: string; resourceId: string }
  >();
  identitiesFor(partition: string | undefined, url: string) {
    const origin = URL.parse(url)?.origin;
    if (!partition || !origin) return [];
    return [...this.identities.values()].filter(
      (entry) => entry.partition === partition && entry.origin === origin,
    );
  }
  set(
    partition: string,
    url: string,
    enabled: boolean,
    identity?: { selector: string; resourceId: string },
  ) {
    const entries = this.load();
    const key = this.key(partition, this.draftAddress(url));
    // A workflow URL that carries its own query identifies the draft by that query.
    const alias = URL.parse(url)?.search ? undefined : this.aliasKey(partition, url);
    const origin = URL.parse(url)?.origin;
    if (enabled) {
      if (identity && origin && !URL.parse(url)?.search)
        this.identities.set(key, { partition, origin, ...identity });
      for (const entry of new Set([key, alias])) {
        if (!entry || entries.has(entry)) continue;
        mkdirSync(this.directory(), { recursive: true, mode: 0o700 });
        writeFileSync(join(this.directory(), entry), "", { mode: 0o600 });
        entries.add(entry);
      }
      return;
    }
    this.identities.delete(key);
    const legacyKey = this.key(partition, url);
    const aliasKey = this.aliasKey(partition, url);
    // Releasing the draft from any alias releases the plain address it was guarded at.
    const parsed = URL.parse(url);
    const plainKey = parsed ? this.key(partition, parsed.origin + parsed.pathname) : undefined;
    for (const entry of new Set([key, legacyKey, aliasKey, plainKey])) {
      if (!entry || !entries.has(entry)) continue;
      rmSync(join(this.directory(), entry), { force: true });
      entries.delete(entry);
    }
  }
}
