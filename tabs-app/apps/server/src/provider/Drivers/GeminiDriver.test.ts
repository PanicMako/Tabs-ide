import { describe, expect, it, vi } from "vitest";

import { discoverGeminiModels } from "./GeminiDriver.ts";

describe("discoverGeminiModels", () => {
  it("uses the authenticated runtime catalog instead of a hardcoded model list", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/account-model",
              displayName: "Account Model",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embedding-only",
              displayName: "Embedding Only",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(discoverGeminiModels("secret", fetchImpl)).resolves.toMatchObject({
      kind: "authenticated",
      models: [{ slug: "account-model", name: "Account Model" }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?key=secret",
    );
  });
});
