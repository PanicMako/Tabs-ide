import { describe, expect, it } from "vitest";
import type { SecretProviderId } from "@tabs/contracts";

import { encodeStoredReference, parseStoredReference } from "./storedReference";

describe("stored secret references", () => {
  it("round-trips a reference and ignores plain secrets", () => {
    const reference = { provider: "op" as SecretProviderId, reference: "op://v/i/f" };
    expect(parseStoredReference(encodeStoredReference(reference))).toEqual(reference);
    expect(parseStoredReference("sk-plain")).toBeNull();
    expect(parseStoredReference("tabs-secret-reference:{bad")).toBeNull();
    expect(parseStoredReference(null)).toBeNull();
  });
});
