import { describe, expect, it } from "vitest";
import { isTestFilePath } from "./testFiles";

describe("isTestFilePath", () => {
  it.each([
    "src/foo.test.ts",
    "src/foo.spec.tsx",
    "apps/web/src/Foo.browser.tsx",
    "src/__tests__/foo.ts",
    "src/__snapshots__/foo.snap",
    "tests/integration/db.ts",
    "pkg/store_test.go",
    "tests/test_store.py",
    "src/test/java/FooTest.java",
    "src/FooTests.kt",
    "C:\\repo\\src\\foo.test.ts",
  ])("treats %s as a test file", (path) => {
    expect(isTestFilePath(path)).toBe(true);
  });

  it.each([
    "src/foo.ts",
    "src/latest.ts",
    "src/contest/entry.ts",
    "docs/testing-guide.md",
    "src/attestation.ts",
    "src/Contest.java",
  ])("does not treat %s as a test file", (path) => {
    expect(isTestFilePath(path)).toBe(false);
  });
});
