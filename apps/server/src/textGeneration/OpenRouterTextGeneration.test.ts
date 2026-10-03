import { OpenRouterSettings, ProviderInstanceId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { makeOpenRouterTextGeneration } from "./OpenRouterTextGeneration";

describe("OpenRouterTextGeneration", () => {
  it("sends the operation-specific JSON Schema", async () => {
    const settings: OpenRouterSettings = {
      enabled: true,
      apiKey: "test-openrouter-key",
      baseUrl: "https://openrouter.test/api/v1",
      customModels: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Generate operation schema",
                body: "## Summary\n- Send the PR schema.\n\n## Testing\n- Added contract coverage.",
              }),
            },
          },
        ],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const driver = await Effect.runPromise(makeOpenRouterTextGeneration(settings));
      await Effect.runPromise(
        driver.generatePrContent({
          cwd: "/test",
          baseBranch: "main",
          headBranch: "feature/schema",
          commitSummary: "Add schema support",
          diffSummary: "1 file changed",
          diffPatch: "+ schema",
          modelSelection: {
            instanceId: ProviderInstanceId.make("openrouter"),
            model: "vendor/model",
          },
        }),
      );

      const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        response_format: {
          type: string;
          json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
        };
      };
      expect(request.response_format).toMatchObject({
        type: "json_schema",
        json_schema: {
          name: "generatePrContent",
          strict: true,
          schema: {
            type: "object",
            required: ["title", "body"],
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
