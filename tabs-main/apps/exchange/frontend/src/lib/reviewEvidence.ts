export interface ReviewEvidenceSection {
  title: string;
  summary: string;
  items?: string[];
  previews?: Array<{ title: string; text: string }>;
}

const explanations: Record<string, string> = {
  "scan-failed":
    "The worker could not complete package inspection. Resolve the failure and rescan before approval.",
  "known-malicious-package": "The package digest is on the registry blocklist.",
  "known-malicious-file": "A packaged file digest is on the registry blocklist.",
  "native-executable": "A native executable or unsupported executable format was detected.",
  "possible-secret":
    "A possible credential was detected. Do not copy its contents into review reasons.",
  "possible-official-impersonation": "The display name may imply official Tabs ownership.",
  "nested-archive": "A nested archive needs additional inspection.",
  "bundled-dependencies": "Dependency material was included; inspect the actual shipped assets.",
  "dynamic-code":
    "Dynamic code construction was detected. Inspect its purpose and execution boundaries.",
  "contributions-changed": "Tool or command contributions changed from the comparison release.",
  "capabilities-increased": "Requested access increased from the comparison release.",
  "storage-schema-downgrade": "The storage schema version decreased; approval is blocked.",
  "storage-schema-changed": "Profile storage changed. Review the schema and declared migrations.",
  "known-vulnerable-dependency": "Known dependency advisories were reported.",
  "dependency-audit-partial": "Not every declared dependency could be assessed.",
  "dependency-audit-unsupported": "The submitted dependency lockfile could not be assessed.",
  "dependency-audit-unavailable": "Dependency advisory lookup was unavailable or incomplete.",
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, limit = 512): string | undefined {
  return typeof value === "string" && value.length <= limit ? value : undefined;
}
function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => text(entry) !== undefined)) return;
  return value as string[];
}
function list(value: unknown): string {
  const entries = strings(value);
  if (!entries) return "unavailable";
  return entries.length
    ? `${entries.slice(0, 50).join(", ")}${entries.length > 50 ? `; ${entries.length - 50} more in raw evidence` : ""}`
    : "none";
}
function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Reviewer aid only. Approval remains bound to the server's exact-digest scan. */
export function reviewEvidence(
  manifest: unknown,
  scanValue: unknown,
  expectedDigest: string,
): ReviewEvidenceSection[] {
  const packageManifest = record(manifest);
  const sections: ReviewEvidenceSection[] = [
    {
      title: "Requested access",
      summary:
        manifest === null || typeof manifest !== "object" || Array.isArray(manifest)
          ? "Manifest unavailable. Requested access has not been established."
          : `Capabilities: ${packageManifest.capabilities === undefined ? "none" : list(packageManifest.capabilities)}. Network hosts: ${packageManifest.networkHosts === undefined ? "none" : list(packageManifest.networkHosts)}.`,
    },
  ];
  const scan = record(scanValue);
  if (
    typeof scan.passed !== "boolean" ||
    scan.digest !== expectedDigest ||
    !Array.isArray(scan.issues)
  ) {
    sections.push({
      title: "Scan evidence",
      summary:
        "No complete scan bound to the displayed digest is available. Do not infer a passing scan or unchanged permissions.",
    });
    return sections;
  }
  const failed = scan.issues.some((entry) => record(entry).code === "scan-failed");
  const blocked = scan.issues.some((entry) => record(entry).severity === "blocking");
  sections.push({
    title: "Scan findings",
    summary: `${scan.passed && !failed && !blocked ? "No blocking findings reported" : "Scan did not pass or contains blocking findings"}. Scanned: ${text(scan.scannedAt) ?? "unknown"}. Automated checks are not a safety guarantee.`,
    items: scan.issues
      .slice(0, 50)
      .map((value) => {
        const issue = record(value);
        const code = text(issue.code) ?? "unknown";
        const severity =
          issue.severity === "blocking"
            ? "Blocking"
            : issue.severity === "warning"
              ? "Warning"
              : "Unknown severity";
        return `${severity}: ${code}${text(issue.file) ? ` in ${text(issue.file)}` : ""}. ${Object.hasOwn(explanations, code) ? explanations[code] : "Inspect raw scan evidence; this finding has no recognized explanation."}`;
      })
      .concat(
        scan.issues.length > 50
          ? [`${scan.issues.length - 50} further findings are in raw scan evidence.`]
          : scan.issues.length === 0
            ? ["No findings reported."]
            : [],
      ),
  });
  if (failed) return sections;
  const access = record(scan.capabilityChanges);
  sections.push({
    title: "Access changes",
    summary: text(scan.comparisonVersion)
      ? `Compared with approved ${text(scan.comparisonVersion)}. Added: ${list(access.added)}. Removed: ${list(access.removed)}.`
      : "No prior approved comparison release is recorded. Treat requested access as a first-release review, not proof that permissions are unchanged.",
  });
  const changes = record(scan.changes);
  sections.push({
    title: "Package changes",
    summary: `${strings(changes.added)?.length ?? "Unknown"} added, ${strings(changes.modified)?.length ?? "unknown"} modified, ${strings(changes.removed)?.length ?? "unknown"} removed files.`,
    items: ["added", "modified", "removed"].map((key) => `${key}: ${list(changes[key])}`),
  });
  if (scan.dependencyAudit === undefined) {
    sections.push({
      title: "Dependency advisory coverage",
      summary:
        "No dependency audit evidence was supplied. Do not infer that shipped dependencies are free of known vulnerabilities.",
    });
  } else {
    const audit = record(scan.dependencyAudit);
    const coverage = {
      complete: "Declared exact npm versions assessed",
      partial: "Only part of the declared dependencies assessed",
      "not-declared": "No root npm lockfile submitted; dependencies not assessed",
      unsupported: "Submitted lockfile could not be assessed",
      unavailable: "Advisory lookup unavailable or incomplete",
    };
    const state = text(audit.status) ?? "unknown";
    const findings = Array.isArray(audit.findings) ? audit.findings : [];
    sections.push({
      title: "Dependency advisory coverage",
      summary: `${Object.hasOwn(coverage, state) ? coverage[state as keyof typeof coverage] : "Coverage unavailable"}. Checked: ${integer(audit.packagesChecked) ?? "unknown"}; skipped: ${integer(audit.packagesSkipped) ?? "unknown"}. A lockfile does not prove which dependencies are in the shipped bundle.`,
      items: findings
        .slice(0, 50)
        .map((value) => {
          const finding = record(value);
          return `${text(finding.name) ?? "Unknown package"}@${text(finding.version) ?? "unknown"}: ${text(finding.advisoryId) ?? "unknown advisory"}`;
        })
        .concat(
          findings.length > 50
            ? [`${findings.length - 50} further advisories are in raw evidence.`]
            : [],
        ),
    });
  }
  if (scan.storageChanges !== undefined) {
    const storage = record(scan.storageChanges);
    const from = integer(storage.fromVersion);
    const to = integer(storage.toVersion);
    sections.push({
      title: "Profile storage changes",
      summary: `Schema ${from ?? "unknown"} to ${to ?? "unknown"}. ${from === undefined || to === undefined ? "Inspect raw storage evidence." : to < from ? "Downgrade blocks approval." : to === from ? "Definition changed without a schema version increase; inspect the manifest." : "Review declared migrations before approval."}`,
      items: Array.isArray(storage.migrations)
        ? storage.migrations.slice(0, 50).map((value) => {
            const step = record(value);
            const renames = Array.isArray(step.renames)
              ? step.renames.slice(0, 50).map((value) => {
                  const rename = record(value);
                  return `${text(rename.from) ?? "unknown"} to ${text(rename.to) ?? "unknown"}`;
                })
              : [];
            return `Version ${integer(step.from) ?? "unknown"} to ${integer(step.to) ?? "unknown"}: ${renames.join(", ") || "no renames shown"}`;
          })
        : ["Migration evidence unavailable."],
    });
  }
  const diff = record(scan.reviewDiff);
  if (Array.isArray(diff.entries)) {
    let remaining = 128 * 1024;
    sections.push({
      title: "Text change previews",
      summary: `${diff.entries.length} file preview(s)${diff.truncated === true || diff.entries.length > 40 ? "; preview truncated" : ""}. Download and independently inspect the archive for complete evidence.`,
      previews: diff.entries.slice(0, 40).map((value) => {
        const entry = record(value);
        const patch = text(entry.patch, Math.min(remaining, 16 * 1024));
        if (patch) remaining -= patch.length;
        return {
          title: `${text(entry.change) ?? "unknown change"}: ${text(entry.file) ?? "unknown file"}`,
          text:
            patch ??
            `Preview omitted: ${text(entry.omitted) ?? "invalid or oversized preview"}. Inspect the archive.`,
        };
      }),
    });
  }
  return sections;
}
