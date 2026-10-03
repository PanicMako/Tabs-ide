import type { BrowserReproductionStep as RecordedStep } from "@tabs/contracts";

export function isFragileSelector(selector: string): boolean {
  if (!selector) return false;
  const s = selector.trim();
  // Positional pseudo-classes like :nth-child(3), :nth-of-type(2)
  if (/:(nth-child|nth-of-type)\(\d+\)/i.test(s)) return true;
  // Absolute / deep XPath
  if (s.startsWith("/") || s.startsWith("xpath=") || s.includes("/div[")) return true;
  // Deep tag-only hierarchy: e.g. "div > div > p > span"
  if (/^([a-z]+(\s*>\s*|\s+)){3,}[a-z]+$/i.test(s)) return true;
  // Dynamically generated hashed CSS classes e.g. .css-1a2b3c, .sc-xyz123, ._1234abcd
  if (/\b(?:css-|sc-|_)[0-9a-zA-Z]{5,}\b/.test(s)) return true;
  return false;
}

export function generateReproductionPlaywrightCode(
  url: string,
  steps: readonly RecordedStep[],
  expectedResult: string,
): string {
  const setup: string[] = [];
  const actions: string[] = [];
  // Validate structure now, but require actual environment values when the spec runs.
  try {
    prepareReproduction(steps, new Proxy({}, { get: () => "reviewed-parameter" }));
  } catch (error) {
    setup.push(
      `  throw new Error(${JSON.stringify(error instanceof Error ? error.message : "Review the reproduction.")});`,
    );
  }
  let inputCount = 0;
  for (const step of steps) {
    const locator = `page.locator(${JSON.stringify(step.selector || "body")})`;
    switch (step.action) {
      case "goto":
        actions.push(`  await page.goto(${JSON.stringify(step.url || url)});`);
        break;
      case "click":
        actions.push(`  await ${locator}.click();`);
        break;
      case "fill":
      case "selectOption": {
        inputCount++;
        let value: string;
        if (step.value !== undefined && !isSensitiveReproductionInput(step))
          value = JSON.stringify(step.value);
        else {
          const name = reproductionInputName(step, inputCount);
          value = `input_${inputCount}`;
          setup.push(`  // Masked sensitive input: supply a reviewed environment parameter.`);
          setup.push(`  const ${value} = process.env[${JSON.stringify(name)}];`);
          setup.push(
            `  if (${value} === undefined) throw new Error(${JSON.stringify(`Missing environment variable: ${name}`)});`,
          );
        }
        actions.push(`  await ${locator}.${step.action}(${value});`);
        break;
      }
      case "check":
      case "uncheck":
        actions.push(`  await ${locator}.${step.action}();`);
        break;
      case "press":
        actions.push(`  await ${locator}.press(${JSON.stringify(step.key || "Enter")});`);
        break;
      case "assertVisible":
        actions.push(`  await expect(${locator}).toBeVisible();`);
        break;
      case "assertText":
        actions.push(
          `  await expect(${locator}).toHaveText(${JSON.stringify(step.expectedValue ?? "")});`,
        );
        break;
      case "assertValue":
        actions.push(
          `  await expect(${locator}).toHaveValue(${JSON.stringify(step.expectedValue ?? "")});`,
        );
        break;
    }
  }
  return [
    'import { test, expect } from "playwright/test";',
    "",
    `// Expected outcome: ${JSON.stringify(expectedResult || "Reviewed expected behavior")}`,
    `test(${JSON.stringify(`reproduce and verify: ${expectedResult.slice(0, 80) || "reported issue"}`)}, async ({ page }) => {`,
    ...setup,
    `  await page.goto(${JSON.stringify(url)});`,
    ...actions,
    "});",
    "",
  ].join("\n");
}

export function reproductionInputName(step: RecordedStep, index: number): string {
  return (step.placeholder || `TEST_INPUT_${index}`).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

export function isSensitiveReproductionInput(step: RecordedStep): boolean {
  return /password|secret|token|api[-_]?key|auth|bearer|pin|credential/i.test(
    `${step.selector} ${step.placeholder ?? ""}`,
  );
}

/** Validate the entire sequence before the first page mutation. */
export function prepareReproduction(
  steps: readonly RecordedStep[],
  env: Record<string, string | undefined>,
): RecordedStep[] {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 500)
    throw new Error("Review between 1 and 500 reproduction steps.");
  if (!steps.some((step) => step.action.startsWith("assert")))
    throw new Error("Add an assertion before running verification.");
  const actions = new Set([
    "goto",
    "click",
    "fill",
    "selectOption",
    "check",
    "uncheck",
    "press",
    "assertVisible",
    "assertText",
    "assertValue",
  ]);
  let inputCount = 0;
  return steps.map((step) => {
    if (!actions.has(step.action)) throw new Error("Unsupported reproduction action.");
    if (step.action === "goto") {
      const url = new URL(step.url ?? "");
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Use an HTTP(S) reproduction URL without credentials.");
      return { ...step };
    }
    if (typeof step.selector !== "string" || !step.selector.trim() || step.selector.length > 2000)
      throw new Error("Every action and assertion needs a reviewed selector.");
    if ((step.isFragile || isFragileSelector(step.selector)) && !step.reviewed)
      throw new Error("Review fragile selectors before verification.");
    if (step.action === "press" && !step.key) throw new Error("Review the key to press.");
    if (
      (step.action === "assertText" || step.action === "assertValue") &&
      step.expectedValue === undefined
    )
      throw new Error("Review the expected assertion value.");
    if (step.action !== "fill" && step.action !== "selectOption") return { ...step };
    inputCount++;
    if (step.value !== undefined && !isSensitiveReproductionInput(step)) return { ...step };
    const name = reproductionInputName(step, inputCount);
    if (env[name] === undefined) throw new Error(`Missing environment variable: ${name}`);
    return { ...step, value: env[name] };
  });
}
