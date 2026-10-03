import { OpenRouterSettings } from "@tabs/contracts";
import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import { discoverOpenRouterModels } from "./OpenRouterDriver.ts";

const settings = (apiKey: string) =>
  Schema.decodeSync(OpenRouterSettings)({ apiKey, baseUrl: "https://openrouter.test/api/v1" });

describe("discoverOpenRouterModels", () => {
  it("classifies an absent key as unauthenticated without making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(discoverOpenRouterModels(settings(""), fetchImpl)).resolves.toEqual({
      kind: "missing",
      models: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the live catalog for a valid key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "vendor/model", name: "Live Model" }] }), {
        status: 200,
      }),
    );
    const result = await discoverOpenRouterModels(settings("valid-key"), fetchImpl);
    expect(result).toMatchObject({
      kind: "authenticated",
      models: [{ slug: "vendor/model", name: "Live Model" }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.test/api/v1/models/user",
      expect.objectContaining({ headers: { Authorization: "Bearer valid-key" } }),
    );
  });

  it("omits models that explicitly do not support response_format", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "vendor/compatible",
              name: "Compatible",
              supported_parameters: ["response_format"],
            },
            {
              id: "vendor/incompatible",
              name: "Incompatible",
              supported_parameters: ["temperature"],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(discoverOpenRouterModels(settings("valid-key"), fetchImpl)).resolves.toMatchObject(
      {
        models: [{ slug: "vendor/compatible", name: "Compatible" }],
      },
    );
  });

  it("classifies a rejected key as unauthenticated", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(discoverOpenRouterModels(settings("invalid-key"), fetchImpl)).resolves.toEqual({
      kind: "rejected",
      status: 401,
      models: [],
    });
  });
});
