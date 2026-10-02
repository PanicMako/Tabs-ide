import { expect, it } from "vitest";
import { catalogPattern, CATALOG_RELEVANCE } from "./catalogSearch.ts";

it("escapes wildcard syntax while preserving literal search text", () => {
  expect(catalogPattern("50%_\\done")).toBe("%50\\%\\_\\\\done%");
  expect(catalogPattern("' OR TRUE --")).toBe("%' OR TRUE --%");
});

it("keeps ranking SQL fixed and ranks names ahead of keywords and descriptions", () => {
  expect(CATALOG_RELEVANCE).toContain("lower($8::text)");
  expect(CATALOG_RELEVANCE.indexOf("THEN 4")).toBeLessThan(CATALOG_RELEVANCE.indexOf("THEN 3"));
  expect(CATALOG_RELEVANCE.indexOf("THEN 3")).toBeLessThan(CATALOG_RELEVANCE.indexOf("THEN 2"));
  expect(CATALOG_RELEVANCE.indexOf("THEN 2")).toBeLessThan(CATALOG_RELEVANCE.indexOf("THEN 1"));
});
