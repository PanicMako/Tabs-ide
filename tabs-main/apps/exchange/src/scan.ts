import * as FS from "node:fs/promises";
import * as Path from "node:path";
import * as Crypto from "node:crypto";
import type { InspectedTabsext } from "@tabs/extension-package";

export interface ScanIssue {
  readonly severity: "blocking" | "warning";
  readonly code: string;
  readonly file?: string;
}

export interface ScanResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<ScanIssue>;
  readonly digest: string;
  readonly scannedAt: string;
  readonly files: Readonly<Record<string, string>>;
  readonly comparisonVersion?: string;
  readonly capabilityChanges: {
    readonly added: ReadonlyArray<string>;
    readonly removed: ReadonlyArray<string>;
  };
  readonly changes: {
    readonly added: ReadonlyArray<string>;
    readonly modified: ReadonlyArray<string>;
    readonly removed: ReadonlyArray<string>;
  };
}

const EXECUTABLE_SUFFIX = /\.(?:exe|dll|dylib|so|node|app|bin)$/i;
const SECRET_PATTERN =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,}/;

export async function scanExtractedPackage(
  directory: string,
  inspected: InspectedTabsext,
  priorManifest?: { readonly contributes?: unknown; readonly capabilities?: ReadonlyArray<string> },
  priorFiles: Readonly<Record<string, string>> = {},
  priorVersion?: string,
): Promise<ScanResult> {
  const issues: ScanIssue[] = [];
  const files: Record<string, string> = {};
  for (const file of inspected.files) {
    const contents = await FS.readFile(Path.join(directory, file));
    files[file] = Crypto.createHash("sha256").update(contents).digest("hex");
    if (EXECUTABLE_SUFFIX.test(file)) {
      issues.push({ severity: "blocking", code: "native-executable", file });
    }
    if (file.startsWith("node_modules/") || file === "package-lock.json") {
      issues.push({ severity: "warning", code: "bundled-dependencies", file });
    }
    if (!/\.(?:html|js|mjs|cjs|json|txt|md|css)$/i.test(file)) continue;
    if (contents.length > 1024 * 1024) continue;
    const text = contents.toString("utf8");
    if (SECRET_PATTERN.test(text)) {
      issues.push({ severity: "blocking", code: "possible-secret", file });
    }
    if (/\b(?:eval|new Function)\s*\(/.test(text)) {
      issues.push({ severity: "warning", code: "dynamic-code", file });
    }
  }
  if (
    priorManifest &&
    JSON.stringify(priorManifest.contributes) !== JSON.stringify(inspected.manifest.contributes)
  ) {
    issues.push({ severity: "warning", code: "contributions-changed" });
  }
  const currentCapabilities = inspected.manifest.capabilities ?? [];
  const priorCapabilities = Array.isArray(priorManifest?.capabilities)
    ? priorManifest.capabilities.filter((capability) => typeof capability === "string")
    : [];
  const currentCapabilitySet = new Set<string>(currentCapabilities);
  const priorCapabilitySet = new Set<string>(priorCapabilities);
  const addedCapabilities = currentCapabilities.filter(
    (capability) => !priorCapabilitySet.has(capability),
  );
  const removedCapabilities = priorCapabilities.filter(
    (capability) => !currentCapabilitySet.has(capability),
  );
  if (priorManifest && addedCapabilities.length > 0) {
    issues.push({ severity: "warning", code: "capabilities-increased" });
  }
  return {
    passed: !issues.some((issue) => issue.severity === "blocking"),
    issues,
    digest: inspected.digest,
    scannedAt: new Date().toISOString(),
    files,
    ...(priorVersion ? { comparisonVersion: priorVersion } : {}),
    capabilityChanges: {
      added: addedCapabilities,
      removed: removedCapabilities,
    },
    changes: {
      added: Object.keys(files).filter((file) => !priorFiles[file]),
      modified: Object.keys(files).filter(
        (file) => priorFiles[file] && priorFiles[file] !== files[file],
      ),
      removed: Object.keys(priorFiles).filter((file) => !files[file]),
    },
  };
}
