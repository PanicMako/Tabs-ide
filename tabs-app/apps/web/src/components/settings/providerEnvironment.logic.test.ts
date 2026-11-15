import { describe, expect, it } from "vitest";
import type { ProviderInstanceEnvironmentVariable, SecretProviderId } from "@tabs/contracts";

import {
  environmentFromRows,
  isDuplicateName,
  newEnvironmentRow,
  rowError,
  rowsFromEnvironment,
} from "./providerEnvironment.logic";

const provider = "op" as SecretProviderId;
const isReference = (value: string) => value.startsWith("op://");

describe("provider environment rows", () => {
  it("round-trips plain values and secret references", () => {
    const environment: Array<ProviderInstanceEnvironmentVariable> = [
      { name: "BASE_URL", value: "https://x.test", sensitive: false },
      { name: "API_KEY", value: { provider, reference: "op://v/i/f" }, sensitive: true },
    ];
    const rows = rowsFromEnvironment(environment);
    expect(rows[0]).toMatchObject({ name: "BASE_URL", value: "https://x.test", secret: "" });
    expect(rows[1]).toMatchObject({ name: "API_KEY", value: "", secret: "op://v/i/f" });
    expect(environmentFromRows(rows, provider, environment)).toEqual(environment);
  });

  it("keeps an untouched redacted value as the server holds it", () => {
    const previous: Array<ProviderInstanceEnvironmentVariable> = [
      { name: "TOKEN", value: "", sensitive: true, valueRedacted: true },
    ];
    const rows = rowsFromEnvironment(previous);
    expect(rows[0]?.value).toBe("");
    expect(environmentFromRows(rows, provider, previous)).toEqual(previous);
  });

  it("drops empty rows and validates names, duplicates and references", () => {
    const empty = newEnvironmentRow();
    const named = { ...newEnvironmentRow(), name: "A", value: "1" };
    const duplicate = { ...newEnvironmentRow(), name: "A", value: "2" };
    const bad = { ...newEnvironmentRow(), name: "1BAD", value: "x" };
    const badRef = { ...newEnvironmentRow(), name: "B", secret: "nope" };
    const rows = [empty, named, duplicate, bad, badRef];
    expect(environmentFromRows([empty, named, duplicate, bad], provider)).toEqual([
      { name: "A", value: "1", sensitive: true },
      { name: "A", value: "2", sensitive: true },
    ]);
    expect(rowError(rows, empty, isReference, true)).toBeNull();
    expect(isDuplicateName(rows, duplicate)).toBe(true);
    expect(rowError(rows, duplicate, isReference, true)).toMatch(/already used/u);
    expect(rowError(rows, bad, isReference, true)).toMatch(/letters/u);
    expect(rowError(rows, badRef, isReference, true)).toMatch(/valid secret reference/u);
    expect(rowError(rows, badRef, isReference, false)).toMatch(/secret provider/u);
  });
});
