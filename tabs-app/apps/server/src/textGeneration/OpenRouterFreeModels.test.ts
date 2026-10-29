import { expect, it, vi } from "vitest";
import {
  makeFreeStructuredModelSelector,
  selectFreeStructuredModels,
} from "./OpenRouterFreeModels";

const textModel = (id: string) => ({
  id,
  context_length: 65_536,
  supported_parameters: ["tools", "structured_outputs"],
  pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
});
it("excludes safety classifiers, paid models and models that cannot honor the schema", () => {
  expect(
    selectFreeStructuredModels({
      data: [
        textModel("vendor/chat:free"),
        textModel("vendor/safety-guard:free"),
        { ...textModel("vendor/paid:free"), pricing: { prompt: "0.001", completion: "0" } },
        { ...textModel("vendor/plain:free"), supported_parameters: ["response_format"] },
        { ...textModel("vendor/short:free"), context_length: 4096 },
        textModel("vendor/paid"),
        null,
      ],
    }),
  ).toEqual(["vendor/chat:free"]);
});
it("uses the account catalog, caches IDs and rotates on subsequent manual requests", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [textModel("vendor/a:free"), textModel("vendor/b:free")] }),
  });
  const choose = makeFreeStructuredModelSelector(
    "https://openrouter.test/api/v1",
    "test-key",
    fetchMock,
  );
  const signal = new AbortController().signal;
  expect(await choose(signal)).toBe("vendor/a:free");
  expect(await choose(signal)).toBe("vendor/b:free");
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://openrouter.test/api/v1/models/user", {
    headers: { Authorization: "Bearer test-key" },
    signal,
  });
});
it("fails closed when no compatible free model is available", async () => {
  const choose = makeFreeStructuredModelSelector(
    "https://openrouter.test/api/v1",
    "test-key",
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [textModel("vendor/paid")] }) }),
  );
  await expect(choose(new AbortController().signal)).rejects.toThrow(
    "No compatible free text models",
  );
});
