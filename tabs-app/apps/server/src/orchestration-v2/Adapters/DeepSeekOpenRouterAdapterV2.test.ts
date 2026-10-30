import { describe, expect, it } from "vitest";
import { deepSeekOpenRouterOverlay } from "./DeepSeekOpenRouterAdapterV2";
import { OpenRouterSettings } from "@tabs/contracts";
import * as Schema from "effect/Schema";

describe("DeepSeek Harness with OpenRouter", () => {
  it("keeps credentials as environment references and exposes only the account catalog", () => {
    const text = deepSeekOpenRouterOverlay("https://openrouter.ai/api/v1", [
      { slug: "vendor/model", name: "Model\n!!js process.exit()" },
    ]);
    const patches = JSON.parse(text);
    const route = patches.find((p: { id: string }) => p.id === "llm-pi-ai").config.providers
      .openrouter;
    expect(route.apiKeyEnv).toBe("OPENROUTER_API_KEY");
    expect(route).not.toHaveProperty("apiKey");
    expect(route.models).toEqual([
      {
        id: "vendor/model",
        name: "Model\n!!js process.exit()",
        contextWindow: 32768,
        maxTokens: 4096,
      },
    ]);
    expect(patches.find((p: { id: string }) => p.id === "acp").config).toEqual({
      provider: "openrouter",
      model: "vendor/model",
    });
    expect(
      patches.some((p: { id: string }) => ["approval", "sandbox", "permission"].includes(p.id)),
    ).toBe(false);
  });
  it("refuses an empty model catalog instead of silently choosing another provider", () => {
    expect(() => deepSeekOpenRouterOverlay("https://openrouter.ai/api/v1", [])).toThrow(
      "No tool-capable",
    );
  });
  it("defaults to DeepSeek while preserving explicit OpenCode configurations", () => {
    expect(Schema.decodeUnknownSync(OpenRouterSettings)({}).harness).toBe("deepseek");
    expect(
      Schema.decodeUnknownSync(OpenRouterSettings)({
        harness: "opencode",
        binaryPath: "/bin/opencode",
      }),
    ).toMatchObject({ harness: "opencode", binaryPath: "/bin/opencode" });
  });
});

it("applies saved plugin options without putting them after managed OpenRouter routing", () => {
  const patches = JSON.parse(
    deepSeekOpenRouterOverlay(
      "https://openrouter.ai/api/v1",
      [{ slug: "vendor/model", name: "Model" }],
      '[{"id":"search","config":{"limit":8}}]',
    ),
  );
  expect(patches[0]).toEqual({ id: "search", config: { limit: 8 } });
  expect(patches.at(-1).id).toBe("agent-default-model");
  expect(() =>
    deepSeekOpenRouterOverlay(
      "https://openrouter.ai/api/v1",
      [{ slug: "vendor/model", name: "Model" }],
      '[{"id":"acp","disabled":true}]',
    ),
  ).toThrow("Tabs manages");
});
