import { describe, expect, it } from "vitest";
import { ProviderDriverKind } from "@tabs/contracts";

import { applyCodexModelManifest, codexUpdateRequiredModels } from "./codexModelManifest.ts";
import { BUNDLED_MODEL_MANIFEST } from "./ModelManifest.ts";
import type { ServerProviderDraft } from "./providerSnapshot.ts";

const CODEX = ProviderDriverKind.make("codex");

const draft = (version: string | null, slugs: ReadonlyArray<string>): ServerProviderDraft =>
  ({
    version,
    models: slugs.map((slug) => ({ slug, name: slug, isCustom: false, capabilities: null })),
  }) as never;

describe("codexUpdateRequiredModels", () => {
  const withMin = BUNDLED_MODEL_MANIFEST.providers?.codex?.models.filter(
    (entry) => entry.status === "current" && (entry.adapter as any)?.codex?.minVersion,
  );

  it("has Codex models gated by a minimum version in the bundled manifest", () => {
    expect(withMin?.length).toBeGreaterThan(0);
  });

  it("lists current models the installed CLI is too old to show", () => {
    const required = codexUpdateRequiredModels(BUNDLED_MODEL_MANIFEST, CODEX, draft("0.100.0", []));
    expect(required.map((model) => model.slug)).toEqual(
      expect.arrayContaining(withMin!.map((entry) => entry.slug)),
    );
    expect(required.every((model) => model.minVersion.length > 0)).toBe(true);
  });

  it("omits models the CLI already lists and needs nothing for a new enough CLI", () => {
    const first = withMin![0]!;
    const listed = codexUpdateRequiredModels(
      BUNDLED_MODEL_MANIFEST,
      CODEX,
      draft("0.100.0", [first.slug]),
    );
    expect(listed.map((model) => model.slug)).not.toContain(first.slug);
    expect(codexUpdateRequiredModels(BUNDLED_MODEL_MANIFEST, CODEX, draft("99.0.0", []))).toEqual(
      [],
    );
  });

  it("says nothing when the version is unknown", () => {
    expect(codexUpdateRequiredModels(BUNDLED_MODEL_MANIFEST, CODEX, draft(null, []))).toEqual([]);
  });

  it("replaces a stale list when applied to a draft", () => {
    const stale = {
      ...draft("99.0.0", []),
      updateRequiredModels: [{ slug: "x", name: "x", minVersion: "1.0.0" }],
    } as never;
    expect(applyCodexModelManifest(stale, BUNDLED_MODEL_MANIFEST, CODEX)).not.toHaveProperty(
      "updateRequiredModels",
    );
  });
});
