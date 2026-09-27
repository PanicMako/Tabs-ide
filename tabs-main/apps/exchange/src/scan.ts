import * as FS from "node:fs/promises";
import * as Path from "node:path";
import * as Crypto from "node:crypto";
import type { InspectedTabsext } from "@tabs/extension-package";
import type { ReviewDiff } from "./reviewDiff.ts";

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
  readonly reviewDiff?: ReviewDiff;
  readonly files: Readonly<Record<string, string>>;
  readonly comparisonVersion?: string;
  readonly capabilityChanges: {
    readonly added: ReadonlyArray<string>;
    readonly removed: ReadonlyArray<string>;
  };
  readonly storageChanges?: {
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly definitionChanged: boolean;
    readonly migrations: NonNullable<InspectedTabsext["manifest"]["storage"]>["migrations"];
  };
  readonly changes: {
    readonly added: ReadonlyArray<string>;
    readonly modified: ReadonlyArray<string>;
    readonly removed: ReadonlyArray<string>;
  };
}

const EXECUTABLE_SUFFIX = /\.(?:exe|dll|dylib|so|node|app|bin|wasm|sh|bat|cmd|ps1)$/i;
const NESTED_ARCHIVE_SUFFIX = /\.(?:zip|tar|tgz|gz|7z|rar|jar)$/i;
const SECRET_PATTERN =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk_live_[A-Za-z0-9]{20,}/;

function hasExecutableSignature(contents: Buffer): boolean {
  if (contents.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true;
  if (contents.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]))) return true;
  const magic = contents.length >= 4 ? contents.readUInt32BE(0) : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic)) {
    return true;
  }
  if (contents.length < 0x40 || contents.subarray(0, 2).toString("ascii") !== "MZ") return false;
  const peOffset = contents.readUInt32LE(0x3c);
  return (
    peOffset <= contents.length - 4 &&
    contents.subarray(peOffset, peOffset + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))
  );
}

export async function scanExtractedPackage(
  directory: string,
  inspected: InspectedTabsext,
  priorManifest?: {
    readonly contributes?: unknown;
    readonly capabilities?: ReadonlyArray<string>;
    readonly networkHosts?: ReadonlyArray<string>;
    readonly storage?: InspectedTabsext["manifest"]["storage"];
  },
  priorFiles: Readonly<Record<string, string>> = {},
  priorVersion?: string,
  blockedDigests: ReadonlySet<string> = new Set(),
): Promise<ScanResult> {
  const issues: ScanIssue[] = [];
  const files: Record<string, string> = {};
  if (blockedDigests.has(inspected.digest)) {
    issues.push({ severity: "blocking", code: "known-malicious-package" });
  }
  if (
    inspected.manifest.publisher !== "tabs" &&
    inspected.manifest.publisher !== "official" &&
    /\b(?:tabs\s+(?:official|verified|staff|exchange)|official\s+tabs)\b/i.test(
      inspected.manifest.displayName,
    )
  ) {
    issues.push({ severity: "warning", code: "possible-official-impersonation" });
  }
  for (const file of inspected.files) {
    const contents = await FS.readFile(Path.join(directory, file));
    files[file] = Crypto.createHash("sha256").update(contents).digest("hex");
    if (blockedDigests.has(files[file]!)) {
      issues.push({ severity: "blocking", code: "known-malicious-file", file });
    }
    if (EXECUTABLE_SUFFIX.test(file) || hasExecutableSignature(contents)) {
      issues.push({ severity: "blocking", code: "native-executable", file });
    }
    if (NESTED_ARCHIVE_SUFFIX.test(file)) {
      issues.push({ severity: "warning", code: "nested-archive", file });
    }
    if (file.startsWith("node_modules/") || file === "package-lock.json") {
      issues.push({ severity: "warning", code: "bundled-dependencies", file });
    }
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
  const currentNetworkHosts = inspected.manifest.networkHosts ?? [];
  const priorNetworkHosts = Array.isArray(priorManifest?.networkHosts)
    ? priorManifest.networkHosts.filter((host) => typeof host === "string")
    : [];
  const priorContributes = priorManifest?.contributes;
  const priorCommands =
    priorContributes && typeof priorContributes === "object" && "commands" in priorContributes
      ? priorContributes.commands
      : undefined;
  const priorAiTools = new Set(
    Array.isArray(priorCommands)
      ? priorCommands
          .filter(
            (command) =>
              command &&
              typeof command === "object" &&
              command.aiCallable === true &&
              typeof command.id === "string",
          )
          .map((command) => command.id as string)
      : [],
  );
  const currentCapabilitySet = new Set<string>(currentCapabilities);
  const priorCapabilitySet = new Set<string>(priorCapabilities);
  const addedCapabilities = [
    ...currentCapabilities.filter((capability) => !priorCapabilitySet.has(capability)),
    ...currentNetworkHosts
      .filter((host) => !priorNetworkHosts.includes(host))
      .map((host) => `network host: ${host}`),
    ...(inspected.manifest.contributes.commands ?? [])
      .filter((command) => command.aiCallable === true && !priorAiTools.has(command.id))
      .map((command) => `AI-callable command: ${command.id}`),
  ];
  const removedCapabilities = [
    ...priorCapabilities.filter((capability) => !currentCapabilitySet.has(capability)),
    ...priorNetworkHosts
      .filter((host) => !currentNetworkHosts.includes(host))
      .map((host) => `network host: ${host}`),
  ];
  if (priorManifest && addedCapabilities.length > 0) {
    issues.push({ severity: "warning", code: "capabilities-increased" });
  }
  const previousStorageVersion = priorManifest?.storage?.version ?? 1;
  const nextStorageVersion = inspected.manifest.storage?.version ?? 1;
  const storageDefinitionChanged =
    JSON.stringify(priorManifest?.storage ?? null) !==
    JSON.stringify(inspected.manifest.storage ?? null);
  if (priorManifest && nextStorageVersion < previousStorageVersion) {
    issues.push({ severity: "blocking", code: "storage-schema-downgrade" });
  } else if (priorManifest && storageDefinitionChanged) {
    issues.push({ severity: "warning", code: "storage-schema-changed" });
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
    ...(priorManifest && storageDefinitionChanged
      ? {
          storageChanges: {
            fromVersion: previousStorageVersion,
            toVersion: nextStorageVersion,
            definitionChanged: true,
            migrations: inspected.manifest.storage?.migrations ?? [],
          },
        }
      : {}),
    changes: {
      added: Object.keys(files).filter((file) => !priorFiles[file]),
      modified: Object.keys(files).filter(
        (file) => priorFiles[file] && priorFiles[file] !== files[file],
      ),
      removed: Object.keys(priorFiles).filter((file) => !files[file]),
    },
  };
}
