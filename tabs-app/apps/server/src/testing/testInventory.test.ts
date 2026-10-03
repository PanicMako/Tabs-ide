import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanTestingInventory } from "./testInventory";

describe("Testing test inventory", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("merges managed cases with a nested static Playwright inventory", () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-test-inventory-"));
    roots.push(root);
    mkdirSync(join(root, "tests"));
    writeFileSync(
      join(root, "tests", "account.spec.ts"),
      `import { test } from "@playwright/test";
test.describe("Account", () => {
  test("TC-00421 updates profile", async () => {});
});`,
    );
    const result = scanTestingInventory({
      projectId: "project-a",
      projectPath: root,
      managedCases: [
        { id: "case-1", externalId: "QA-100", description: "Sign in", status: "matches" },
      ],
    });

    expect(result.repositoryFilesScanned).toBe(1);
    expect(result.roots[0]?.children[0]?.externalCaseId).toBe("QA-100");
    expect(result.roots[1]?.children[0]?.children[0]?.children[0]).toMatchObject({
      label: "TC-00421 updates profile",
      externalCaseId: "TC-00421",
      runnable: true,
    });
  });

  it("returns an empty repository root for a project without test files", () => {
    const root = mkdtempSync(join(tmpdir(), "tabs-test-inventory-"));
    roots.push(root);
    expect(
      scanTestingInventory({ projectId: "project-a", projectPath: root, managedCases: [] }),
    ).toMatchObject({ repositoryFilesScanned: 0, parseWarnings: [] });
  });
});
