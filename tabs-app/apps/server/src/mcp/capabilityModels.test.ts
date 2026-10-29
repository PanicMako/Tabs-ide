import { expect, it } from "vitest";
import type { ServerProviderModel } from "@tabs/contracts";
import { selectCapabilityModels } from "./capabilityModels";
const models = Array.from({ length: 500 }, (_, i) => ({
  slug: `model-${i}`,
  name: `Model ${i}`,
  isCustom: i === 300,
  isDefault: i === 400,
  capabilities: null,
})) as ServerProviderModel[];
it("bounds default output and prioritizes inherited, default and custom models", () => {
  const result = selectCapabilityModels(models, {}, "model-499");
  expect(result.models).toHaveLength(8);
  expect(result.models.slice(0, 3).map((m) => m.slug)).toEqual([
    "model-499",
    "model-400",
    "model-300",
  ]);
  expect(result.totalModels).toBe(500);
  expect(result.nextOffset).toBe(8);
});
it("finds a model outside the default shortlist", () => {
  expect(selectCapabilityModels(models, { search: "model-482" }).models.map((m) => m.slug)).toEqual(
    ["model-482"],
  );
});
it("keeps the full catalog reachable through pages or explicit includeAll", () => {
  const pages = [];
  for (let offset = 0; offset < 500; offset += 100)
    pages.push(...selectCapabilityModels(models, { limit: 100, offset }).models);
  expect(new Set(pages.map((m) => m.slug)).size).toBe(500);
  expect(selectCapabilityModels(models, { includeAll: true }).models).toHaveLength(500);
  expect(models[0]!.slug).toBe("model-0");
});
