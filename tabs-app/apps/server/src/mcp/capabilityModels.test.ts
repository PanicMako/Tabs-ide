import { expect, it } from "@effect/vitest";
import { OrchestratorMcpCapabilitiesInput, type ServerProviderModel } from "@tabs/contracts";
import * as Schema from "effect/Schema";

import { selectCapabilityModels } from "./capabilityModels.ts";

const models = Array.from({ length: 500 }, (_, index) => ({
  slug: `model-${index}`,
  name: `Model ${index}`,
  isCustom: index === 300,
  isDefault: index === 400,
  aliases: index === 482 ? ["SpecialAlias"] : [],
  capabilities: null,
})) as ServerProviderModel[];

it("preserves the complete catalog when callers omit all query controls", () => {
  const omitted = selectCapabilityModels(models, undefined, "model-499");
  const empty = selectCapabilityModels(models, {}, "model-499");

  expect(omitted.models).toHaveLength(500);
  expect(omitted.models.map((model) => model.slug)).toEqual(models.map((model) => model.slug));
  expect(omitted.totalModels).toBe(500);
  expect(omitted.hasMoreModels).toBe(false);
  expect(empty.models).toHaveLength(500);
});

it("bounds opted-in pages and prioritizes inherited, default, and custom models", () => {
  const result = selectCapabilityModels(models, { limit: 3 }, "model-499");

  expect(result.models.map((model) => model.slug)).toEqual(["model-499", "model-400", "model-300"]);
  expect(result.totalModels).toBe(500);
  expect(result.hasMoreModels).toBe(true);
  expect(result.nextOffset).toBe(3);
  expect(selectCapabilityModels(models, { limit: 1_000 }).models).toHaveLength(100);
  expect(selectCapabilityModels(models, { limit: 100, offset: 0 }).models).toHaveLength(100);
});

it("searches model IDs, names, and aliases without case sensitivity", () => {
  const byId = selectCapabilityModels(models, { search: "MODEL-482" });
  const byAlias = selectCapabilityModels(models, { search: "specialalias" });

  expect(byId.models.map((model) => model.slug)).toEqual(["model-482"]);
  expect(byAlias.models.map((model) => model.slug)).toEqual(["model-482"]);
  expect(selectCapabilityModels(models, { search: "absent" }).models).toEqual([]);
  expect(selectCapabilityModels(models, { search: "model-" }).models).toHaveLength(40);
});

it("allows all search matches when explicitly requested", () => {
  const result = selectCapabilityModels(models, { search: "model-", limit: 1, includeAll: true });

  expect(result.models).toHaveLength(500);
  expect(result.hasMoreModels).toBe(false);
  expect(result.nextOffset).toBeUndefined();
});

it("keeps the full catalog reachable through explicit pages", () => {
  const pages = [];
  for (let offset = 0; offset < 500; offset += 100) {
    pages.push(...selectCapabilityModels(models, { limit: 100, offset }).models);
  }

  expect(new Set(pages.map((model) => model.slug)).size).toBe(500);
});

it("validates runtime query boundaries", () => {
  const decode = Schema.decodeUnknownSync(OrchestratorMcpCapabilitiesInput);

  expect(decode({ limit: 100 }).limit).toBe(100);
  expect(decode({ offset: 0 }).offset).toBe(0);
  expect(decode({ search: " x ", includeAll: false }).search).toBe("x");
  expect(() => decode({ limit: 0 })).toThrow();
  expect(() => decode({ limit: 101 })).toThrow();
  expect(() => decode({ offset: -1 })).toThrow();
  expect(() => decode({ search: "  " })).toThrow();
  expect(() => decode({ search: "x".repeat(201) })).toThrow();
});
