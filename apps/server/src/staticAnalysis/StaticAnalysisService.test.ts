/**
 * Unit tests for Phase 1: StaticAnalysisService (parsers) and ContextBuilder.
 *
 * Implements the "Smallest Testable Slice" from the design doc:
 *   - parseTscOutput correctly attributes a type error in a changed file
 *   - buildStaticAnalysisContext only surfaces findings for changed files
 *   - extractChangedFilesFromPatch correctly parses diff headers
 */

import { describe, expect, it } from "vitest";

import {
  buildStaticAnalysisContext,
  extractChangedFilesFromPatch,
  findingMatchesChangedFile,
} from "./ContextBuilder.ts";
import { parseEslintJsonOutput, parseTscOutput } from "./StaticAnalysisService.ts";

// ---------------------------------------------------------------------------
// parseTscOutput
// ---------------------------------------------------------------------------

describe("parseTscOutput", () => {
  it("parses a standard tsc error line", () => {
    const stdout =
      "src/auth/UserService.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.";

    const findings = parseTscOutput(stdout, "");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "src/auth/UserService.ts",
      line: 42,
      col: 7,
      rule: "TS2322",
      severity: "error",
      tool: "tsc",
    });
    expect(findings[0]?.message).toContain("not assignable to type");
  });

  it("parses multiple errors from stdout and stderr combined", () => {
    const stdout =
      "src/Foo.ts(10,3): error TS2304: Cannot find name 'Bar'.\n" +
      "src/Baz.ts(1,1): warning TS6133: 'unused' is declared but its value is never read.";
    const stderr = "src/Qux.ts(5,5): error TS2345: Argument of type 'null' is not assignable.";

    const findings = parseTscOutput(stdout, stderr);

    expect(findings).toHaveLength(3);
    expect(findings[0]?.file).toBe("src/Foo.ts");
    expect(findings[1]?.severity).toBe("warning");
    expect(findings[2]?.file).toBe("src/Qux.ts");
  });

  it("handles absolute paths from tsc", () => {
    const stdout = "/Users/dev/project/src/auth/UserService.ts(12,5): error TS2322: Type mismatch.";

    const findings = parseTscOutput(stdout, "");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("/Users/dev/project/src/auth/UserService.ts");
    expect(findings[0]?.line).toBe(12);
  });

  it("returns empty array for empty output", () => {
    expect(parseTscOutput("", "")).toHaveLength(0);
  });

  it("ignores non-diagnostic lines (summary lines, blank lines)", () => {
    const stdout = [
      "",
      "Found 2 errors in 2 files.",
      "",
      "src/index.ts(1,1): error TS2345: Real error.",
    ].join("\n");

    const findings = parseTscOutput(stdout, "");
    // Should only capture the actual diagnostic line, not the summary
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("src/index.ts");
  });
});

// ---------------------------------------------------------------------------
// parseEslintJsonOutput
// ---------------------------------------------------------------------------

describe("parseEslintJsonOutput", () => {
  it("parses a valid ESLint JSON report", () => {
    const json = JSON.stringify([
      {
        filePath: "/project/src/Component.tsx",
        messages: [
          {
            ruleId: "no-unused-vars",
            severity: 2,
            message: "'foo' is defined but never used.",
            line: 5,
            column: 3,
          },
          {
            ruleId: "no-console",
            severity: 1,
            message: "Unexpected console statement.",
            line: 10,
            column: 1,
          },
        ],
      },
    ]);

    const findings = parseEslintJsonOutput(json);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      file: "/project/src/Component.tsx",
      line: 5,
      col: 3,
      rule: "no-unused-vars",
      severity: "error",
      tool: "eslint",
    });
    expect(findings[1]?.severity).toBe("warning");
  });

  it("returns empty array for empty output", () => {
    expect(parseEslintJsonOutput("")).toHaveLength(0);
  });

  it("returns empty array when JSON is not an array", () => {
    expect(parseEslintJsonOutput("{}")).toHaveLength(0);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseEslintJsonOutput("not json")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findingMatchesChangedFile
// ---------------------------------------------------------------------------

describe("findingMatchesChangedFile", () => {
  it("matches identical relative paths", () => {
    expect(findingMatchesChangedFile("src/auth/UserService.ts", "src/auth/UserService.ts")).toBe(
      true,
    );
  });

  it("matches when finding path is absolute and changed path is relative", () => {
    expect(
      findingMatchesChangedFile(
        "/Users/dev/project/src/auth/UserService.ts",
        "src/auth/UserService.ts",
      ),
    ).toBe(true);
  });

  it("matches when changed path is absolute and finding path is relative", () => {
    expect(
      findingMatchesChangedFile(
        "src/auth/UserService.ts",
        "/Users/dev/project/src/auth/UserService.ts",
      ),
    ).toBe(true);
  });

  it("does not match different files with similar names", () => {
    expect(findingMatchesChangedFile("src/auth/UserService.ts", "src/auth/UserServiceV2.ts")).toBe(
      false,
    );
  });

  it("returns false for empty paths", () => {
    expect(findingMatchesChangedFile("", "src/Foo.ts")).toBe(false);
    expect(findingMatchesChangedFile("src/Foo.ts", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractChangedFilesFromPatch
// ---------------------------------------------------------------------------

describe("extractChangedFilesFromPatch", () => {
  it("extracts file paths from a multi-file diff", () => {
    const patch = [
      "diff --git a/src/auth/UserService.ts b/src/auth/UserService.ts",
      "index abc..def 100644",
      "--- a/src/auth/UserService.ts",
      "+++ b/src/auth/UserService.ts",
      "@@ -1,3 +1,4 @@",
      "+const x: number = 'wrong';",
      " const y = 1;",
      "diff --git a/src/utils/helpers.ts b/src/utils/helpers.ts",
      "index 111..222 100644",
      "--- a/src/utils/helpers.ts",
      "+++ b/src/utils/helpers.ts",
      "@@ -5,2 +5,3 @@",
      "+export function newHelper() {}",
    ].join("\n");

    const files = extractChangedFilesFromPatch(patch);

    expect(files).toContain("src/auth/UserService.ts");
    expect(files).toContain("src/utils/helpers.ts");
    expect(files).toHaveLength(2);
  });

  it("deduplicates repeated file paths", () => {
    const patch = [
      "diff --git a/src/Foo.ts b/src/Foo.ts",
      "diff --git a/src/Foo.ts b/src/Foo.ts",
    ].join("\n");

    const files = extractChangedFilesFromPatch(patch);
    expect(files).toHaveLength(1);
  });

  it("returns empty array for empty patch", () => {
    expect(extractChangedFilesFromPatch("")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildStaticAnalysisContext — the core "Smallest Testable Slice" from the
// design doc: does the context builder correctly attribute a type error in a
// changed file ONLY to that file, and exclude findings for unchanged files?
// ---------------------------------------------------------------------------

describe("buildStaticAnalysisContext — design doc smallest testable slice", () => {
  it("includes findings only for changed files and excludes others", () => {
    const changedFiles = ["src/auth/UserService.ts"];
    const allFindings = [
      {
        // This finding IS in the diff — should appear
        file: "src/auth/UserService.ts",
        line: 42,
        col: 7,
        rule: "TS2322",
        message: "Type 'string' is not assignable to type 'number'.",
        severity: "error" as const,
        tool: "tsc",
      },
      {
        // This finding is NOT in the diff — must be excluded
        file: "src/unrelated/OtherFile.ts",
        line: 5,
        col: 1,
        rule: "TS2345",
        message: "Argument of type 'null' is not assignable.",
        severity: "error" as const,
        tool: "tsc",
      },
    ];

    const result = buildStaticAnalysisContext({ changedFiles, allFindings });

    expect(result.relevantFindingCount).toBe(1);
    expect(result.excludedFindingCount).toBe(1);
    expect(result.contextSection).toContain("UserService.ts");
    expect(result.contextSection).toContain("TS2322");
    expect(result.contextSection).toContain("not assignable to type");
    // The unrelated file must NOT appear
    expect(result.contextSection).not.toContain("OtherFile.ts");
    expect(result.contextSection).not.toContain("TS2345");
  });

  it("correctly attributes an absolute-path tsc finding to its relative changed file", () => {
    const changedFiles = ["src/auth/UserService.ts"];
    const allFindings = [
      {
        // tsc often emits absolute paths
        file: "/Users/dev/tabs-app/src/auth/UserService.ts",
        line: 12,
        col: 5,
        rule: "TS2322",
        message: "Type mismatch.",
        severity: "error" as const,
        tool: "tsc",
      },
    ];

    const result = buildStaticAnalysisContext({ changedFiles, allFindings });

    expect(result.relevantFindingCount).toBe(1);
    expect(result.contextSection).toContain("TS2322");
  });

  it("returns empty contextSection when no findings match changed files", () => {
    const changedFiles = ["src/clean/NoErrors.ts"];
    const allFindings = [
      {
        file: "src/other/HasErrors.ts",
        line: 1,
        col: 1,
        rule: "TS2322",
        message: "Error.",
        severity: "error" as const,
        tool: "tsc",
      },
    ];

    const result = buildStaticAnalysisContext({ changedFiles, allFindings });

    expect(result.contextSection).toBe("");
    expect(result.relevantFindingCount).toBe(0);
    expect(result.excludedFindingCount).toBe(1);
  });

  it("returns empty contextSection when allFindings is empty", () => {
    const result = buildStaticAnalysisContext({
      changedFiles: ["src/auth/UserService.ts"],
      allFindings: [],
    });

    expect(result.contextSection).toBe("");
    expect(result.relevantFindingCount).toBe(0);
  });

  it("groups multiple findings under the same file correctly", () => {
    const changedFiles = ["src/auth/UserService.ts"];
    const allFindings = [
      {
        file: "src/auth/UserService.ts",
        line: 10,
        col: 1,
        rule: "TS2304",
        message: "Cannot find name 'Foo'.",
        severity: "error" as const,
        tool: "tsc",
      },
      {
        file: "src/auth/UserService.ts",
        line: 20,
        col: 3,
        rule: "TS2345",
        message: "Argument null not assignable.",
        severity: "warning" as const,
        tool: "tsc",
      },
    ];

    const result = buildStaticAnalysisContext({ changedFiles, allFindings });

    expect(result.relevantFindingCount).toBe(2);
    // Both rules appear in the same section
    expect(result.contextSection).toContain("TS2304");
    expect(result.contextSection).toContain("TS2345");
    // File appears only once as a heading
    const headingOccurrences = (result.contextSection.match(/UserService\.ts/g) ?? []).length;
    expect(headingOccurrences).toBeGreaterThanOrEqual(1);
  });
});
