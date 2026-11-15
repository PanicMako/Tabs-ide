import {
  CloudSpeechApiKey,
  CloudSpeechError,
  CloudSpeechModel,
  CloudSpeechModelId,
  type CloudSpeechKeys,
  type CloudSpeechProvider,
  EnvironmentSpeechTranscriptionResult,
  type SpeechTranscriptionOptions,
} from "@tabs/contracts";
import type { SecretReference } from "@tabs/contracts";
import { cloudSpeechLanguages, effectiveSpeechLanguage } from "@tabs/shared/speech";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  deleteProviderSecret,
  getProviderSecret,
  setProviderSecret,
  type ProviderSecretName,
} from "../provider/ProviderSecretStore.ts";
import {
  encodeStoredReference,
  parseStoredReference as parseSharedStoredReference,
} from "@tabs/shared/secretProviders/storedReference";
import { SecretResolver } from "../secrets/SecretResolverCore.ts";
import { applySpeechAliases } from "./customWords.ts";
import { removeSpeechFillerWords } from "./fillerWords.ts";
import { decodeSpeechPcm, SpeechInvalidAudioError } from "./SpeechService.ts";

const endpoints = {
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-transcribe" },
  xai: { url: "https://api.x.ai/v1/stt", model: "grok-voice-transcribe-2.0" },
  openrouter: { url: "https://openrouter.ai/api/v1/audio/transcriptions" },
};
const OPENROUTER_CATALOG_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=transcription&zdr=true";
const isApiKey = Schema.is(CloudSpeechApiKey);
const isModelId = Schema.is(CloudSpeechModelId);
const OpenRouterCatalog = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) })),
});

function wave(samples: Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const tag = (at: number, value: string) =>
    new Uint8Array(buffer, at, 4).set(new TextEncoder().encode(value));
  tag(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, buffer.byteLength - 44, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

function audioBody(
  provider: "openai" | "xai",
  audio: ArrayBuffer,
  language: string,
  options: SpeechTranscriptionOptions,
) {
  const form = new FormData();
  form.set("model", endpoints[provider].model);
  if (language !== "auto") form.set(provider === "openai" ? "languages[]" : "language", language);
  for (const { term } of options.speechCustomWords) {
    if (provider === "openai" && /[<>\r\n]/.test(term)) continue;
    form.append(provider === "openai" ? "keywords[]" : "keyterm", term);
  }
  if (provider === "xai") {
    if (language !== "auto") form.set("format", "true");
    form.set(
      "filler_words",
      String(!options.speechRemoveFillerWords || Boolean(options.speechCorrectionWord)),
    );
    if (!options.speechSilenceFiltering) form.set("vad_threshold", "0");
  }
  // xAI ignores options that follow the file part.
  form.set("file", new Blob([audio], { type: "audio/wav" }), "dictation.wav");
  return HttpClientRequest.bodyFormData(form);
}

function openRouterBody(model: string, audio: ArrayBuffer, language: string) {
  return HttpClientRequest.bodyJsonUnsafe({
    model,
    input_audio: { data: Buffer.from(audio).toString("base64"), format: "wav" },
    ...(language !== "auto" ? { language } : {}),
    provider: { zdr: true },
  });
}

/** Cloud keys live in the OS keychain next to other provider credentials, never in settings. */
const KEY_NAMES: Record<CloudSpeechProvider, ProviderSecretName> = {
  openai: "voice.openai-api-key",
  xai: "voice.xai-api-key",
  openrouter: "voice.openrouter-api-key",
};

export const parseStoredReference = parseSharedStoredReference;

export class CloudSpeechKeyStoreError extends Schema.TaggedError<CloudSpeechKeyStoreError>()(
  "CloudSpeechKeyStoreError",
  { provider: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not update the ${this.provider} voice key in the system keychain.`;
  }
}

export class CloudSpeech extends Context.Service<
  CloudSpeech,
  {
    readonly configured: Effect.Effect<CloudSpeechKeys>;
    /** OpenRouter's public transcription catalog, cached briefly on this server. */
    readonly models: Effect.Effect<ReadonlyArray<CloudSpeechModel>, CloudSpeechError>;
    readonly setKey: (
      provider: CloudSpeechProvider,
      key: Redacted.Redacted<string> | SecretReference | null,
    ) => Effect.Effect<void, CloudSpeechKeyStoreError>;
    readonly transcribe: (
      provider: CloudSpeechProvider,
      pcm: Uint8Array,
      options: SpeechTranscriptionOptions,
      model?: string | undefined,
    ) => Effect.Effect<string, CloudSpeechError | SpeechInvalidAudioError>;
  }
>()("tabs/speech/CloudSpeech") {}

export const layer = Layer.effect(
  CloudSpeech,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const resolver = yield* Effect.serviceOption(SecretResolver);
    // A reference is kept in the keychain slot as JSON behind a marker; the secret it names stays
    // with its provider and is read when the key is used.
    const readKey = (provider: CloudSpeechProvider) =>
      Effect.promise(() => getProviderSecret(KEY_NAMES[provider])).pipe(
        Effect.flatMap((stored) => {
          const reference = parseStoredReference(stored);
          if (reference === null) return Effect.succeed(stored);
          return resolver._tag === "Some"
            ? resolver.value.read([reference]).pipe(Effect.map(([value]) => value))
            : Effect.succeed(undefined);
        }),
      );
    // Whether a key is set must not run a secret provider, so it looks only at what is stored.
    const hasKey = (provider: CloudSpeechProvider) =>
      Effect.promise(() => getProviderSecret(KEY_NAMES[provider]));
    const configured = Effect.all({
      openai: hasKey("openai"),
      xai: hasKey("xai"),
      openrouter: hasKey("openrouter"),
    }).pipe(
      Effect.map(({ openai, xai, openrouter }) => ({
        openai: Boolean(openai),
        xai: Boolean(xai),
        openrouter: Boolean(openrouter),
      })),
    );
    // Audio and credentials never follow a redirect to another host.
    const execute = (request: HttpClientRequest.HttpClientRequest) =>
      http.execute(request).pipe(Effect.provideService(HttpClient.TracerPropagationEnabled, false));
    const fetchCatalog = Effect.fn("CloudSpeech.catalog")(function* () {
      const unavailable = () =>
        new CloudSpeechError({ provider: "openrouter", reason: "unavailable" });
      const response = yield* execute(HttpClientRequest.get(OPENROUTER_CATALOG_URL)).pipe(
        Effect.mapError(unavailable),
      );
      if (response.status < 200 || response.status >= 300) return yield* unavailable();
      const { data } = yield* HttpClientResponse.schemaBodyJson(OpenRouterCatalog)(response).pipe(
        Effect.mapError(unavailable),
      );
      return data.flatMap(({ id, name }) =>
        isModelId(id) ? [{ id, name: name?.trim() || id }] : [],
      );
    });
    // The catalog is public, so the cache holds no credential or consent state.
    const models = yield* Effect.cachedWithTTL(
      fetchCatalog().pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () =>
            Effect.fail(new CloudSpeechError({ provider: "openrouter", reason: "unavailable" })),
        }),
      ),
      "10 minutes",
    );
    const setKey = Effect.fn("CloudSpeech.setKey")(function* (
      provider: CloudSpeechProvider,
      key: Redacted.Redacted<string> | SecretReference | null,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          key === null
            ? deleteProviderSecret(KEY_NAMES[provider])
            : Redacted.isRedacted(key)
              ? setProviderSecret(KEY_NAMES[provider], Redacted.value(key))
              : setProviderSecret(KEY_NAMES[provider], encodeStoredReference(key)),
        catch: (cause) => new CloudSpeechKeyStoreError({ provider, cause }),
      });
    });
    const transcribe = Effect.fn("CloudSpeech.transcribe")(
      function* (
        provider: CloudSpeechProvider,
        pcm: Uint8Array,
        options: SpeechTranscriptionOptions,
        model?: string,
      ) {
        const source = yield* readKey(provider);
        if (!source) return yield* new CloudSpeechError({ provider, reason: "missing-key" });
        if (provider === "openrouter" && (!model || !isModelId(model)))
          return yield* new CloudSpeechError({ provider, reason: "model-unavailable" });
        const samples = yield* Effect.try({
          try: () => decodeSpeechPcm(pcm),
          catch: () =>
            new SpeechInvalidAudioError({
              byteLength: pcm.byteLength,
              message: "Invalid PCM audio.",
            }),
        });
        const language = effectiveSpeechLanguage(cloudSpeechLanguages, options.speechLanguage);
        if (provider === "openrouter" && !(yield* models).some((entry) => entry.id === model))
          return yield* new CloudSpeechError({ provider, reason: "model-unavailable" });
        const unreadable = () => new CloudSpeechError({ provider, reason: "unreadable-key" });
        const key = source;
        if (!isApiKey(key)) return yield* unreadable();
        const audio = wave(samples);
        const request = HttpClientRequest.post(endpoints[provider].url).pipe(
          HttpClientRequest.bearerToken(Redacted.make(key)),
          provider === "openrouter"
            ? openRouterBody(model!, audio, language)
            : audioBody(provider, audio, language, options),
        );
        const unavailable = () => new CloudSpeechError({ provider, reason: "unavailable" });
        // A catalog fetch may have outlived the credential it started with.
        const current = yield* readKey(provider);
        if (!current || current !== source)
          return yield* new CloudSpeechError({
            provider,
            reason: current ? "key-changed" : "missing-key",
          });
        const response = yield* execute(request).pipe(Effect.mapError(unavailable));
        if (response.status < 200 || response.status >= 300)
          return yield* new CloudSpeechError({
            provider,
            reason:
              response.status === 429
                ? "rate-limit"
                : [401, 402, 403].includes(response.status)
                  ? "rejected-key"
                  : response.status === 404 && provider === "openrouter"
                    ? "model-unavailable"
                    : "unavailable",
          });
        const { text } = yield* HttpClientResponse.schemaBodyJson(
          EnvironmentSpeechTranscriptionResult,
        )(response).pipe(Effect.mapError(unavailable));
        const corrected = applySpeechAliases(text, options.speechCustomWords);
        return (
          options.speechRemoveFillerWords
            ? removeSpeechFillerWords(corrected, language, options.speechCorrectionWord)
            : corrected
        ).trim();
      },
      (effect, provider) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: "2 minutes",
            orElse: () => Effect.fail(new CloudSpeechError({ provider, reason: "unavailable" })),
          }),
        ),
    );
    return CloudSpeech.of({ configured, models, setKey, transcribe });
  }),
);
