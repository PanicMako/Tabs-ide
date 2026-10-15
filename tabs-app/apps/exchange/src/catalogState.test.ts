import { expect, it } from "vitest";
import {
  catalogParameters,
  readCatalogState,
  validateCatalogPage,
} from "../frontend/src/lib/catalogState.ts";

it("roundtrips filters through URL state without carrying an old cursor", () => {
  const state = { q: "git & review", category: "productivity", sort: "name" as const };
  expect(readCatalogState(catalogParameters(state).toString())).toEqual(state);
  expect(readCatalogState("?sort=bad&category=../secrets")).toEqual({
    q: "",
    category: "",
    sort: "",
  });
  expect(readCatalogState(`?q=${"x".repeat(101)}`).q).toHaveLength(100);
  expect(catalogParameters(state).has("cursor")).toBe(false);
});

it("requires consistent bounded pagination and safe identities", () => {
  const page = {
    extensions: [
      {
        namespace: "acme",
        name: "tool",
        version: "1.0.0",
        verified: false,
        manifest: { displayName: "Tool", description: "Purpose" },
      },
    ],
    nextCursor: null,
    hasMore: false,
  };
  expect(validateCatalogPage(page)).toEqual(page);
  expect(() => validateCatalogPage({ ...page, hasMore: true })).toThrow();
  expect(() => validateCatalogPage({ ...page, nextCursor: "bad/cursor", hasMore: true })).toThrow();
  expect(() =>
    validateCatalogPage({
      ...page,
      extensions: [{ ...page.extensions[0], namespace: "../escape" }],
    }),
  ).toThrow();
  expect(() => validateCatalogPage(null)).toThrow();
});
