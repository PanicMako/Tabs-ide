import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  evaluateVerification,
  generateReproductionPlaywrightCode,
  isFragileSelector,
  type RecordedStep,
} from "./RecordIssueDialog";

describe("RecordIssueDialog helpers", () => {
  describe("generateReproductionPlaywrightCode", () => {
    it("generates valid Playwright reproduction code with navigation and clicks", () => {
      const steps: RecordedStep[] = [
        { id: "1", action: "goto", selector: "", url: "https://example.com/checkout" },
        { id: "2", action: "click", selector: '[data-testid="checkout-btn"]' },
        {
          id: "3",
          action: "assertVisible",
          selector: '[data-testid="error-message"]',
        },
      ];

      const code = generateReproductionPlaywrightCode(
        "https://example.com/checkout",
        steps,
        "Checkout error banner should be displayed",
      );

      expect(code).toContain('import { test, expect } from "playwright/test";');
      expect(code).toContain('await page.goto("https://example.com/checkout");');
      expect(code).toContain('await page.locator("[data-testid=\\"checkout-btn\\"]").click();');
      expect(code).toContain(
        'await expect(page.locator("[data-testid=\\"error-message\\"]")).toBeVisible();',
      );
      expect(code).toContain('Expected outcome: "Checkout error banner should be displayed"');
    });

    it("parameterizes sensitive input without recording plaintext secrets or passwords", () => {
      const steps: RecordedStep[] = [
        {
          id: "1",
          action: "fill",
          selector: 'input[name="password"]',
          value: "superSecretPassword123!",
          placeholder: "user_password",
        },
        {
          id: "2",
          action: "fill",
          selector: 'input[data-testid="api-key-token"]',
          value: "sk-live-987654321",
        },
        {
          id: "3",
          action: "fill",
          selector: 'input[name="username"]',
          value: "alice_developer",
          placeholder: "username",
        },
      ];

      const code = generateReproductionPlaywrightCode(
        "https://example.com/login",
        steps,
        "User should log in successfully",
      );

      // Sensitive values must NOT appear anywhere in the generated code
      expect(code).not.toContain("superSecretPassword123!");
      expect(code).not.toContain("sk-live-987654321");

      // Parameterized via process.env
      expect(code).toContain('process.env["USER_PASSWORD"]');
      expect(code).toContain('process.env["TEST_INPUT_2"]');
      expect(code).toContain("Masked sensitive input");

      // Non-sensitive normal text is preserved
      expect(code).toContain('"alice_developer"');
    });

    it("fails before navigation when no assertions are defined", () => {
      const steps: RecordedStep[] = [{ id: "1", action: "click", selector: "button.submit" }];

      const code = generateReproductionPlaywrightCode(
        "https://example.com",
        steps,
        "Form submits properly",
      );

      expect(code).not.toContain("expect(true");
      expect(code).toContain('throw new Error("Add an assertion before running verification.")');
      expect(code.indexOf("throw new Error")).toBeLessThan(code.indexOf("await page.goto"));
    });

    it("generates text and value assertions properly", () => {
      const steps: RecordedStep[] = [
        {
          id: "1",
          action: "assertText",
          selector: "h1.title",
          expectedValue: "Dashboard Overview",
        },
        {
          id: "2",
          action: "assertValue",
          selector: "input#total-count",
          expectedValue: "42",
        },
      ];

      const code = generateReproductionPlaywrightCode(
        "https://example.com",
        steps,
        "Header and count are accurate",
      );

      expect(code).toContain(
        'await expect(page.locator("h1.title")).toHaveText("Dashboard Overview");',
      );
      expect(code).toContain('await expect(page.locator("input#total-count")).toHaveValue("42");');
    });
  });

  describe("isFragileSelector", () => {
    it("flags positional selectors as fragile", () => {
      expect(isFragileSelector("div:nth-child(3) > span")).toBe(true);
      expect(isFragileSelector("table > tr:nth-of-type(2)")).toBe(true);
      expect(isFragileSelector("ul > li:nth-child(5)")).toBe(true);
    });

    it("flags absolute and deep XPath selectors as fragile", () => {
      expect(isFragileSelector("/html/body/div[2]/div[1]/form")).toBe(true);
      expect(isFragileSelector("xpath=//div[3]/button")).toBe(true);
      expect(isFragileSelector("body > /div[2]")).toBe(true);
    });

    it("flags deep tag-only chains as fragile", () => {
      expect(isFragileSelector("div > div > p > span")).toBe(true);
      expect(isFragileSelector("div main section div article")).toBe(true);
    });

    it("flags hashed dynamic CSS classes as fragile", () => {
      expect(isFragileSelector("button.css-1a2b3c4")).toBe(true);
      expect(isFragileSelector("div.sc-bdVaJa")).toBe(true);
      expect(isFragileSelector("span._1234abcd")).toBe(true);
    });

    it("identifies robust, stable selectors", () => {
      expect(isFragileSelector('[data-testid="submit-button"]')).toBe(false);
      expect(isFragileSelector('[aria-label="Close dialog"]')).toBe(false);
      expect(isFragileSelector('button[name="save"]')).toBe(false);
      expect(isFragileSelector("#user-profile-header")).toBe(false);
      expect(isFragileSelector("button.btn-primary")).toBe(false);
      expect(isFragileSelector("")).toBe(false);
    });
  });

  describe("evaluateVerification", () => {
    it("reports pass when assertions match and no errors occur", () => {
      const result = evaluateVerification(true, "Expected counter to increase");
      expect(result.status).toBe("pass");
      expect(result.message).toContain("passed successfully");
    });

    it("reports fail when assertion throws an error", () => {
      const result = evaluateVerification(
        true,
        "Expected counter to increase",
        new Error('Assertion failed: element "#counter" does not contain "2"'),
      );
      expect(result.status).toBe("fail");
      expect(result.message).toContain('Assertion failed: element "#counter"');
    });

    it("reports interrupted when takeover occurs during verification", () => {
      const result = evaluateVerification(
        true,
        "Expected counter to increase",
        new Error("Action interrupted: human took over control of browser tab"),
      );
      expect(result.status).toBe("interrupted");
      expect(result.message).toContain("interrupted: Action interrupted: human took over");
    });

    it("reports not_verified when steps finished without assertions or expected result", () => {
      const result = evaluateVerification(false, "");
      expect(result.status).toBe("not_verified");
      expect(result.message).toContain("no expected-result assertions were defined");
    });
  });
});

it("does not mistake an expected-result description for executed assertions", () => {
  expect(evaluateVerification(false, "Checkout succeeds").status).toBe("not_verified");
});

it("emits parseable code for quotes, newlines, comment terminators and numeric environment names", () => {
  const code = generateReproductionPlaywrightCode(
    "https://example.com",
    [
      { id: "1", action: "fill", selector: "#password", placeholder: "123_password" },
      { id: "2", action: "assertVisible", selector: "#success" },
    ],
    'Works "correctly" */\nthrow new Error("injected")',
  );
  const result = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  expect(
    result.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
  ).toEqual([]);
  expect(code).not.toContain("test-secret");
  expect(code).toContain('process.env["123_PASSWORD"]');
  expect(code).toContain("Missing environment variable");
});
