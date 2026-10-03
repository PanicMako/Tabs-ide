import { describe, expect, it } from "vitest";
import { classifyExecutionFailure, createUnifiedDiff } from "./failureClassification";

describe("classifyExecutionFailure", () => {
  it("classifies selector drift as repairable", () => {
    const error =
      "Error: strict mode violation: getByRole('button', { name: 'Submit' }) resolved to 2 elements";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("selector-drift");
    expect(result.isRepairable).toBe(true);
  });

  it("classifies actionability/timing as repairable", () => {
    const error =
      "locator.click: Timeout 30000ms exceeded.\nwaiting for element to be visible, enabled and stable";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("actionability-timing");
    expect(result.isRepairable).toBe(true);
  });

  it("classifies navigation readiness as repairable", () => {
    const error = "page.goto: Timeout 30000ms exceeded waiting for load state 'load'";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("navigation-readiness");
    expect(result.isRepairable).toBe(true);
  });

  it("classifies fixture defect as repairable", () => {
    const error = "TypeError: Cannot read properties of undefined (reading 'testData')";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("fixture-defect");
    expect(result.isRepairable).toBe(true);
  });

  it("classifies genuine product assertion failure as non-repairable", () => {
    const error =
      'Error: expect(received).toHaveText(expected)\nExpected: "Dashboard"\nReceived: "Welcome"';
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("product-assertion");
    expect(result.isRepairable).toBe(false);
  });

  it("classifies network failures as non-repairable", () => {
    const error = "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("network-failure");
    expect(result.isRepairable).toBe(false);
  });

  it("classifies browser crashes as non-repairable", () => {
    const error = "Target page, context or browser has been closed";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("browser-crash");
    expect(result.isRepairable).toBe(false);
  });

  it("classifies authentication redirects as non-repairable", () => {
    const error = "Page redirected to login: 401 Unauthorized";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("auth-redirect");
    expect(result.isRepairable).toBe(false);
  });

  it("classifies missing credentials as non-repairable", () => {
    const error = "Authentication failed: missing credentials for login";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("missing-credentials");
    expect(result.isRepairable).toBe(false);
  });

  it("classifies infrastructure failures as non-repairable", () => {
    const error = "Error: spawn ENOENT - playwright command failed to start";
    const result = classifyExecutionFailure(error);
    expect(result.classification).toBe("infrastructure-failure");
    expect(result.isRepairable).toBe(false);
  });
});

describe("createUnifiedDiff", () => {
  it("generates unified diff between original and repaired specs", () => {
    const original =
      "import { test } from 'playwright';\ntest('one', async ({ page }) => {\n  await page.click('#old');\n});";
    const repaired =
      "import { test } from 'playwright';\ntest('one', async ({ page }) => {\n  await page.click('#new');\n});";
    const diff = createUnifiedDiff(
      "tests/original.spec.ts",
      "tests/repaired.spec.ts",
      original,
      repaired,
    );
    expect(diff).toContain("--- tests/original.spec.ts");
    expect(diff).toContain("+++ tests/repaired.spec.ts");
    expect(diff).toContain("-  await page.click('#old');");
    expect(diff).toContain("+  await page.click('#new');");
  });

  it("handles reordered repeated lines without hanging", () => {
    const diff = createUnifiedDiff("old.ts", "new.ts", "alpha\nbeta", "beta\nalpha");
    expect(diff).toContain("-alpha");
    expect(diff).toContain("+alpha");
  });
});
