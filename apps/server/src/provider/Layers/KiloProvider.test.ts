import { describe, expect, it } from "vitest";

import type { OpenCodeInventory } from "../opencodeRuntime.ts";
import { flattenKiloModels } from "./KiloProvider.ts";

describe("flattenKiloModels", () => {
  it("keeps free and paid account-scoped Kilo models and excludes other upstreams", () => {
    const inventory = {
      providerList: {
        connected: ["kilo", "anthropic", "openrouter"],
        all: [
          {
            id: "kilo",
            name: "Kilo",
            models: {
              auto: {
                id: "kilo-auto/free",
                name: "Kilo Auto Free",
                isFree: true,
              },
              paid: {
                id: "paid-model",
                name: "Paid Router Model",
                isFree: false,
              },
            },
          },
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              opus: { id: "claude-opus", name: "Claude Opus" },
            },
          },
          {
            id: "openrouter",
            name: "OpenRouter",
            models: {
              routed: { id: "vendor/model", name: "Routed Model" },
            },
          },
        ],
      },
      agents: [],
    } as unknown as OpenCodeInventory;

    expect(flattenKiloModels(inventory).map((model) => model.slug)).toEqual([
      "kilo/kilo-auto/free",
      "kilo/paid-model",
    ]);
  });
});
