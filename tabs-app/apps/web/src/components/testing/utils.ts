/**
 * Pure helper functions for the Testing workspace.
 *
 * These are module-level utilities with no side-effects, safe to import by any
 * view component.  Keep this file free of React imports.
 */

import type { TestingLocatorEntry } from "@tabs/contracts";

/**
 * Returns true when at least one locator argument contains a redacted PII
 * placeholder such as `<PII_EMAIL>` or `<REDACTED_TOKEN>`.
 */
export function testingLocatorHasRedactedArgument(entry: TestingLocatorEntry): boolean {
  return Object.values(entry.arguments).some(
    (value) => typeof value === "string" && /<(?:PII_|REDACTED_)[^>]*>/u.test(value),
  );
}

/**
 * Generates the Playwright locator code string for the given entry.
 *
 * @param entry - The locator entry to render.
 * @param pageVariable - The variable name to use for the Playwright page object (default: "page").
 */
export function testingLocatorCode(entry: TestingLocatorEntry, pageVariable = "page"): string {
  if (entry.lifecycleStatus === "manual-required" || testingLocatorHasRedactedArgument(entry)) {
    return "Manual locator required - choose a stable test ID or non-sensitive label";
  }
  const args = entry.arguments;
  const value = (key: string) => JSON.stringify(String(args[key] ?? ""));
  switch (entry.strategy) {
    case "role":
      return `${pageVariable}.getByRole(${value("role")}, { name: ${value("name")} })`;
    case "label":
      return `${pageVariable}.getByLabel(${value("text")})`;
    case "test-id":
      return `${pageVariable}.getByTestId(${value("testId")})`;
    case "placeholder":
      return `${pageVariable}.getByPlaceholder(${value("text")})`;
    case "alt-text":
      return `${pageVariable}.getByAltText(${value("text")})`;
    case "title":
      return `${pageVariable}.getByTitle(${value("text")})`;
    case "text":
      return `${pageVariable}.getByText(${value("text")})`;
    case "css":
      return `${pageVariable}.locator(${value("selector")})`;
  }
}
