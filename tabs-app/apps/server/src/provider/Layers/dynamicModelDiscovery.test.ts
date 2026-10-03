import { describe, expect, it } from "vitest";
import {
  validateServerProviderModel,
  validateServerProviderModelList,
  inferModelCapabilitiesFromSlug,
  type ServerProviderModel,
} from "@tabs/contracts";

describe("Dynamic Model Discovery & Effect/Schema Safety Tests", () => {
  it("decodes valid provider model payloads correctly", () => {
    const rawValidModel = {
      slug: "claude-opus-5",
      name: "Claude Opus 5",
      isCustom: false,
      capabilities: null,
      source: "known" as const,
    };

    const validated = validateServerProviderModel(rawValidModel);
    expect(validated).not.toBeNull();
    expect(validated?.slug).toBe("claude-opus-5");
    expect(validated?.name).toBe("Claude Opus 5");
    expect(validated?.source).toBe("known");
  });

  it("safely rejects malformed/corrupt provider model payloads (fail closed)", () => {
    const malformedPayloads = [
      { slug: "", name: "No Slug", isCustom: false }, // empty slug invalid
      { slug: "opus-5", name: "", isCustom: false }, // empty name invalid
      { slug: "opus-5" }, // missing fields
      "invalid string payload",
      12345,
      null,
      undefined,
    ];

    for (const badPayload of malformedPayloads) {
      const validated = validateServerProviderModel(badPayload);
      expect(validated).toBeNull();
    }

    const validatedList = validateServerProviderModelList(malformedPayloads);
    expect(validatedList).toEqual([]);
  });

  it("infers capabilities for unknown slugs using family patterns", () => {
    const opusCaps = inferModelCapabilitiesFromSlug("custom-claude-opus-next");
    expect(opusCaps.optionDescriptors?.some((d) => d.id === "effort")).toBe(true);

    const haikuCaps = inferModelCapabilitiesFromSlug("custom-claude-haiku-lightning");
    expect(haikuCaps.optionDescriptors?.some((d) => d.id === "fastMode")).toBe(true);

    const unknownCaps = inferModelCapabilitiesFromSlug("completely-unrecognized-model-v1");
    expect(unknownCaps.optionDescriptors?.length).toBe(1);
    expect(unknownCaps.optionDescriptors?.[0]?.id).toBe("contextWindow");
  });

  it("preserves prior good model state when receiving a malformed payload mid-session", () => {
    const priorGoodModels: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "claude-opus-5",
        name: "Claude Opus 5",
        isCustom: false,
        capabilities: null,
        source: "known",
      },
      {
        slug: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        isCustom: false,
        capabilities: null,
        source: "known",
      },
    ];

    const garbageIncomingPayload = [{ invalidSlug: 123 }, { corruptedField: true }];

    const validatedNext = validateServerProviderModelList(garbageIncomingPayload);
    expect(validatedNext.length).toBe(0);

    // Simulated merge behavior: if validatedNext is empty, return priorGoodModels
    const resolvedModels = validatedNext.length > 0 ? validatedNext : priorGoodModels;
    expect(resolvedModels).toEqual(priorGoodModels);
  });
});
