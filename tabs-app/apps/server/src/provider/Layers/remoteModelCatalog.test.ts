import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { fetchRemoteModelCatalog } from "./remoteModelCatalog";

describe("Remote Model Catalog Registry Tests", () => {
  it("fetches and decodes remote catalog payload safely using Effect/Schema", async () => {
    const result = await Effect.runPromise(fetchRemoteModelCatalog());
    expect(result).toBeDefined();
    expect(typeof result.modelsByProvider).toBe("object");
  });

  it("handles offline network failure gracefully without throwing (fail closed)", async () => {
    // Override remote URL to an invalid endpoint
    const originalUrl = process.env.TABS_REMOTE_MODEL_CATALOG_URL;
    process.env.TABS_REMOTE_MODEL_CATALOG_URL =
      "https://invalid.domain.that.does.not.exist/catalog.json";

    const result = await Effect.runPromise(fetchRemoteModelCatalog());
    expect(result.modelsByProvider).toEqual({});

    process.env.TABS_REMOTE_MODEL_CATALOG_URL = originalUrl;
  });
});
