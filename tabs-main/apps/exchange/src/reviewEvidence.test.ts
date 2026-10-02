import { describe, expect, it } from "vitest";
import { reviewEvidence } from "../frontend/src/lib/reviewEvidence";
import type { ScanResult } from "./scan";

const digest = "a".repeat(64);
const scan = {
  passed: true,
  digest,
  scannedAt: "2026-10-01T00:00:00.000Z",
  issues: [{ severity: "warning", code: "capabilities-increased" }],
  files: {},
  comparisonVersion: "1.0.0",
  capabilityChanges: { added: ["workspace.read", "network host: api.example"], removed: [] },
  changes: { added: ["dist/index.html"], modified: [], removed: [] },
  dependencyAudit: {
    status: "partial",
    packagesChecked: 2,
    packagesSkipped: 1,
    findings: [{ name: "example", version: "1.0.0", advisoryId: "GHSA-example" }],
  },
  storageChanges: {
    fromVersion: 1,
    toVersion: 2,
    definitionChanged: true,
    migrations: [{ from: 1, to: 2, renames: [{ from: "old", to: "new" }] }],
  },
  reviewDiff: {
    truncated: false,
    entries: [
      { file: "dist/index.html", change: "added", patch: "+<script>not executed</script>" },
    ],
  },
} satisfies ScanResult;

describe("human-readable exact-digest review evidence", () => {
  it("explains scan coverage, access changes, migrations and file previews", () => {
    const sections = reviewEvidence({ capabilities: ["workspace.read"] }, scan, digest);
    expect(sections.find((entry) => entry.title === "Requested access")?.summary).toContain(
      "workspace.read",
    );
    expect(sections.find((entry) => entry.title === "Access changes")?.summary).toContain(
      "approved 1.0.0",
    );
    expect(
      sections.find((entry) => entry.title === "Dependency advisory coverage")?.summary,
    ).toContain("Only part");
    expect(sections.find((entry) => entry.title === "Profile storage changes")?.items).toEqual([
      "Version 1 to 2: old to new",
    ]);
    expect(
      sections.find((entry) => entry.title === "Text change previews")?.previews?.[0]?.text,
    ).toBe("+<script>not executed</script>");
  });
  it("does not claim unchanged access or dependency safety from absent or failed evidence", () => {
    for (const value of [null, {}, { ...scan, digest: "b".repeat(64) }]) {
      const sections = reviewEvidence({}, value, digest);
      expect(sections).toHaveLength(2);
      expect(sections[1]?.summary).toContain("Do not infer");
    }
    const failed = reviewEvidence(
      {},
      { ...scan, passed: false, issues: [{ severity: "blocking", code: "scan-failed" }] },
      digest,
    );
    expect(failed).toHaveLength(2);
    expect(failed[1]?.items?.[0]).toContain("rescan before approval");
    expect(reviewEvidence(null, null, digest)[0]?.summary).toContain("Manifest unavailable");
    expect(
      reviewEvidence({}, { ...scan, dependencyAudit: undefined }, digest).find(
        (entry) => entry.title === "Dependency advisory coverage",
      )?.summary,
    ).toContain("No dependency audit evidence");
    expect(
      reviewEvidence(
        {},
        { ...scan, issues: [{ severity: "blocking", code: "possible-secret" }] },
        digest,
      )[1]?.summary,
    ).toContain("blocking findings");
    expect(
      reviewEvidence({}, { ...scan, comparisonVersion: undefined }, digest).find(
        (entry) => entry.title === "Access changes",
      )?.summary,
    ).toContain("first-release review");
  });
  it("bounds previews and handles unknown findings without prototype lookup", () => {
    const sections = reviewEvidence(
      {},
      {
        ...scan,
        issues: Array(51).fill({ code: "__proto__", severity: "warning", file: "<img>" }),
        reviewDiff: {
          entries: Array(41).fill({
            file: "file",
            change: "modified",
            patch: "x".repeat(16 * 1024),
          }),
          truncated: true,
        },
      },
      digest,
    );
    const findings = sections.find((entry) => entry.title === "Scan findings")!;
    expect(findings.items).toHaveLength(51);
    expect(findings.items?.[0]).toContain("no recognized explanation");
    expect(findings.items?.[50]).toContain("1 further");
    const previews = sections.find((entry) => entry.title === "Text change previews")!.previews!;
    expect(previews).toHaveLength(40);
    expect(previews[8]?.text).toContain("Preview omitted");
  });
});
