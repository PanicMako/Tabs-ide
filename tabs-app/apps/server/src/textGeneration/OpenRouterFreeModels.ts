interface CatalogModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  supported_parameters?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown; request?: unknown };
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
}

/** Only general text models: tool support excludes classifiers and safety guards. */
export function selectFreeStructuredModels(payload: unknown): string[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("data" in payload) ||
    !Array.isArray(payload.data)
  )
    return [];
  return payload.data.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const model = value as CatalogModel;
    if (
      typeof model.id !== "string" ||
      !model.id.endsWith(":free") ||
      /guard|moderation|embed|rerank|safety|classifier/i.test(`${model.id} ${model.name ?? ""}`) ||
      Number(model.pricing?.prompt ?? -1) !== 0 ||
      Number(model.pricing?.completion ?? -1) !== 0 ||
      Number(model.pricing?.request ?? 0) !== 0 ||
      !Array.isArray(model.supported_parameters) ||
      !model.supported_parameters.includes("structured_outputs") ||
      !model.supported_parameters.includes("tools") ||
      !Array.isArray(model.architecture?.input_modalities) ||
      !model.architecture.input_modalities.includes("text") ||
      !Array.isArray(model.architecture?.output_modalities) ||
      !model.architecture.output_modalities.includes("text") ||
      typeof model.context_length !== "number" ||
      model.context_length < 32_768
    )
      return [];
    return [model.id];
  });
}

/** Cache only the account-filtered model IDs, never repository content. Rotate on manual retries. */
export function makeFreeStructuredModelSelector(
  baseUrl: string,
  apiKey: string,
  fetchImpl: (
    url: string,
    options: RequestInit,
  ) => Promise<Pick<Response, "ok" | "status" | "json">> = fetch,
) {
  let cached: { models: string[]; expires: number } | undefined;
  let next = 0;
  return async (signal: AbortSignal): Promise<string> => {
    if (!cached || cached.expires <= Date.now()) {
      const response = await fetchImpl(`${baseUrl}/models/user`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (!response.ok)
        throw new Error(
          `Unable to load your OpenRouter model catalog (HTTP ${response.status}). Check Settings > Providers > OpenRouter.`,
        );
      const models = selectFreeStructuredModels(await response.json());
      if (models.length === 0)
        throw new Error(
          "No compatible free text models are available for your OpenRouter account. Choose a model with structured output support in Settings > Providers > OpenRouter.",
        );
      cached = { models, expires: Date.now() + 5 * 60_000 };
    }
    const model = cached.models[next++ % cached.models.length];
    if (!model) throw new Error("No free text generation model is available.");
    return model;
  };
}
