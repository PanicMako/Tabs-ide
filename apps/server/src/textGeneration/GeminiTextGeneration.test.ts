import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import { GeminiSettings, ProviderInstanceId } from "@tabs/contracts";
import { makeGeminiTextGeneration } from "./GeminiTextGeneration";

describe("GeminiTextGeneration", () => {
  it("fails with clear error when API key is unconfigured", async () => {
    const settings: GeminiSettings = {
      enabled: true,
      apiKey: "",
      baseUrl: "https://generativelanguage.googleapis.com",
      customModels: [],
    };

    const driver = await Effect.runPromise(makeGeminiTextGeneration(settings));

    const program = driver.generateDiffSummary({
      cwd: "/test",
      diffSummary: "1 file changed",
      diffPatch: "+ hello",
      modelSelection: {
        instanceId: ProviderInstanceId.make("gemini"),
        model: "gemini-3.6-flash",
      },
    });

    const error = await Effect.runPromise(Effect.flip(program));
    expect(error.message).toContain("Gemini API key is not configured");
  });

  it("succeeds end-to-end with mock fetch response", async () => {
    const settings: GeminiSettings = {
      enabled: true,
      apiKey: "test-gemini-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      customModels: [],
    };

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  summary: "Updated documentation.",
                  keyChanges: "- Added Gemini provider support.",
                  notesAndRisk: "No breaking changes.",
                }),
              },
            ],
          },
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const driver = await Effect.runPromise(makeGeminiTextGeneration(settings));

      const result = await Effect.runPromise(
        driver.generateDiffSummary({
          cwd: "/test",
          diffSummary: "1 file changed",
          diffPatch: "+ gemini support",
          modelSelection: {
            instanceId: ProviderInstanceId.make("gemini"),
            model: "gemini-3.6-flash",
          },
        }),
      );

      expect(result.summary).toBe("Updated documentation.");
      expect(result.keyChanges).toBe("- Added Gemini provider support.");
      expect(result.notesAndRisk).toBe("No breaking changes.");
      const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        generationConfig: { responseMimeType: string; responseSchema: Record<string, unknown> };
      };
      expect(request.generationConfig).toMatchObject({
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          required: ["summary", "keyChanges", "notesAndRisk"],
          properties: {
            summary: { type: "string" },
            keyChanges: { type: "string" },
            notesAndRisk: { type: "string" },
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
