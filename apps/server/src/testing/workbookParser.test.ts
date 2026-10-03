import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { reconcileWorkbookCase, scenariosFromGraph } from "./reconciliation";
import { parseExpectedResults, parseSteps, parseTestingWorkbook } from "./workbookParser";

const graph = {
  nodes: [
    { stateId: "root", pageUrl: "https://app.test", pageTitle: "Home", snapshot: "Home" },
    {
      stateId: "profile",
      pageUrl: "https://app.test/profile",
      pageTitle: "Profile",
      snapshot: "Profile",
    },
    {
      stateId: "saved",
      pageUrl: "https://app.test/profile",
      pageTitle: "Saved",
      snapshot: "Changes saved",
    },
  ],
  edges: [
    {
      fromStateId: "root",
      toStateId: "profile",
      role: "link",
      name: "Profile",
      intentLocator: "getByRole('link', { name: 'Profile' })",
    },
    {
      fromStateId: "profile",
      toStateId: "saved",
      role: "button",
      name: "Save changes",
      intentLocator: "getByRole('button', { name: 'Save changes' })",
    },
  ],
} as const;

describe("Testing workbook ingestion and reconciliation", () => {
  it("parses numbered and newline-separated steps", () => {
    expect(parseSteps("1. Open profile\n2) Save changes")).toEqual([
      "Open profile",
      "Save changes",
    ]);
  });

  it("aligns numbered expected results with their individual steps", () => {
    expect(parseExpectedResults("1. Profile is visible\n2. Changes are saved", 2)).toEqual([
      "Profile is visible",
      "Changes are saved",
    ]);
    expect(parseExpectedResults("Changes are saved", 2)).toEqual(["", "Changes are saved"]);
  });

  it("imports the controlled workbook with provenance and row-level errors", async () => {
    const fixturePath = resolve(
      import.meta.dirname,
      "../../../../../testing/fixtures/phase2-controlled.xlsx",
    );
    const parsed = await parseTestingWorkbook(fixturePath);

    expect(parsed.workbookName).toBe("phase2-controlled.xlsx");
    expect(parsed.cases).toHaveLength(6);
    expect(parsed.cases[0]).toMatchObject({
      externalId: "QA-001",
      sourceSheet: "QA Cases",
      sourceRow: 5,
      steps: ['Activate link "Profile"', 'Activate button "Save changes"'],
    });
    // A legacy single expected result is attached to the final imported step.
    expect(typeof parsed.cases[0]?.expectedResult).toBe("string");
    expect(parsed.cases[0]?.expectedResults).toEqual([
      "",
      "Profile changes are saved and confirmed",
    ]);
    expect(parsed.cases[0]?.errors).toContain("Duplicate Case ID");
    expect(parsed.cases[2]?.errors).toContain("Duplicate Case ID");
    expect(parsed.cases[3]?.errors).toContain("Case ID is blank");
    expect(parsed.cases[4]?.errors).toContain("Steps are blank or malformed");
  });

  it("accepts the downloadable blank template without inventing cases", async () => {
    const templatePath = resolve(
      import.meta.dirname,
      "../../../web/public/testing/testing-cases-template.xlsx",
    );
    const parsed = await parseTestingWorkbook(templatePath);

    expect(parsed.workbookName).toBe("testing-cases-template.xlsx");
    expect(parsed.cases).toEqual([]);
  });

  it("finds a reachable path and surfaces a deliberate mismatch", async () => {
    const fixturePath = resolve(
      import.meta.dirname,
      "../../../../../testing/fixtures/phase2-controlled.xlsx",
    );
    const parsed = await parseTestingWorkbook(fixturePath);
    const valid = reconcileWorkbookCase(parsed.cases[5]!, graph);
    const mismatch = reconcileWorkbookCase(parsed.cases[1]!, graph);

    expect(valid.status).toBe("matches");
    expect(valid.matchedStateIds).toEqual(["root", "profile", "saved"]);
    expect(mismatch.status).toBe("needs-review");
    expect(mismatch.mismatches[0]).toMatchObject({
      kind: "unreachable",
      expected: 'Activate button "Delete account"',
    });
  });

  it("generates starter scenarios only from reachable graph transitions", () => {
    const scenarios = scenariosFromGraph(graph);
    expect(scenarios).toHaveLength(2);
    expect(scenarios[1]).toMatchObject({
      externalId: "DISCOVERED-002",
      matchedStateIds: ["root", "profile", "saved"],
    });
    // Each auto-generated scenario should carry one expected result per step.
    expect(typeof scenarios[0]?.expectedResult).toBe("string");
    expect(scenarios[1]?.expectedResults).toHaveLength(scenarios[1]?.steps.length ?? 0);
    expect(scenarios[1]?.expectedResult).toContain("Saved");
  });

  it("flags an expected-result mismatch when the described outcome has no graph evidence", () => {
    const parsedWithExpected = {
      externalId: "QA-ER-001",
      description: "Submit the checkout form",
      steps: ['Activate link "Profile"'],
      expectedResults: ["Order confirmation screen appears with invoice number"],
      expectedResult: "Order confirmation screen appears with invoice number",
      sourceSheet: "QA Cases",
      sourceRow: 2,
      errors: [],
    };
    const result = reconcileWorkbookCase(parsedWithExpected, graph);
    expect(result.mismatches.some((m) => m.kind === "expected-result")).toBe(true);
    const erMismatch = result.mismatches.find((m) => m.kind === "expected-result")!;
    expect(erMismatch.expected).toBe("Order confirmation screen appears with invoice number");
  });
});
