import { describe, expect, it } from "vitest";
import { ProviderDriverKind } from "@tabs/contracts";

import { formatProviderUpdateRequiredNotice } from "./providerUpdateRequiredModels.ts";

const claude = (models: ReadonlyArray<{ slug: string; name: string; minVersion: string }>) => ({
  driver: ProviderDriverKind.make("claudeAgent"),
  updateRequiredModels: models,
});

describe("formatProviderUpdateRequiredNotice", () => {
  it("says nothing without models that need an update", () => {
    expect(formatProviderUpdateRequiredNotice(claude([]))).toBeNull();
  });

  it("names the models and the highest version they need", () => {
    expect(
      formatProviderUpdateRequiredNotice(
        claude([
          { slug: "a", name: "Opus A", minVersion: "2.1.0" },
          { slug: "b", name: "Sonnet B", minVersion: "2.3.0" },
        ]),
      ),
    ).toBe("Update Claude Code to v2.3.0 or newer to use Opus A and Sonnet B.");
  });

  it("limits the notice to what the search matches", () => {
    const provider = claude([
      { slug: "a", name: "Opus A", minVersion: "2.1.0" },
      { slug: "b", name: "Sonnet B", minVersion: "2.3.0" },
    ]);
    expect(formatProviderUpdateRequiredNotice(provider, "sonnet")).toContain("Sonnet B");
    expect(formatProviderUpdateRequiredNotice(provider, "zzz")).toBeNull();
  });
});
