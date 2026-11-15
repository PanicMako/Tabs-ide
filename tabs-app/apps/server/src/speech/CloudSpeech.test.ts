import { assert, it } from "@effect/vitest";
import { DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { vi } from "vitest";

const keychain = vi.hoisted(() => new Map<string, string>());
vi.mock("../provider/ProviderSecretStore.ts", () => ({
  getProviderSecret: async (name: string) => keychain.get(name) ?? null,
  setProviderSecret: async (name: string, value: string) => void keychain.set(name, value),
  deleteProviderSecret: async (name: string) => void keychain.delete(name),
}));

import { SecretResolver } from "../secrets/SecretResolverCore.ts";
import * as CloudSpeech from "./CloudSpeech.ts";

const pcm = new Uint8Array(new Float32Array(1_600).buffer);

const makeCloud = (status: number, body: unknown) => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request);
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return {
    requests,
    layer: CloudSpeech.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client))),
  };
};

it.effect("refuses to upload audio without a stored key", () => {
  keychain.clear();
  const { requests, layer } = makeCloud(200, { text: "unused" });
  return Effect.gen(function* () {
    const cloud = yield* CloudSpeech.CloudSpeech;
    const error = yield* cloud
      .transcribe("openai", pcm, DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS)
      .pipe(Effect.flip);
    assert.equal(error._tag, "CloudSpeechError");
    assert.equal((error as { reason?: string }).reason, "missing-key");
    assert.equal(requests.length, 0);
    assert.deepEqual(yield* cloud.configured, { openai: false, xai: false, openrouter: false });
  }).pipe(Effect.provide(layer));
});

it.effect("stores the key in the keychain and sends it only as a bearer token", () => {
  keychain.clear();
  const { requests, layer } = makeCloud(200, { text: "  hello world  " });
  return Effect.gen(function* () {
    const cloud = yield* CloudSpeech.CloudSpeech;
    yield* cloud.setKey("openai", Redacted.make("sk-test-key-1234567890"));
    assert.equal(keychain.get("voice.openai-api-key"), "sk-test-key-1234567890");
    assert.deepEqual(yield* cloud.configured, { openai: true, xai: false, openrouter: false });
    const text = yield* cloud.transcribe("openai", pcm, DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS);
    assert.equal(text, "hello world");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(requests[0]!.headers.authorization, "Bearer sk-test-key-1234567890");
    yield* cloud.setKey("openai", null);
    assert.isFalse(keychain.has("voice.openai-api-key"));
  }).pipe(Effect.provide(layer));
});

it.effect("reports a rejected key without echoing the provider body", () => {
  keychain.clear();
  keychain.set("voice.xai-api-key", "xai-test-key-1234567890");
  const { layer } = makeCloud(401, { error: "bad key" });
  return Effect.gen(function* () {
    const cloud = yield* CloudSpeech.CloudSpeech;
    const error = yield* cloud
      .transcribe("xai", pcm, DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS)
      .pipe(Effect.flip);
    assert.equal((error as { reason?: string }).reason, "rejected-key");
  }).pipe(Effect.provide(layer));
});

it.effect("keeps a secret reference in the keychain and reads the key from its provider", () => {
  keychain.clear();
  const { requests, layer } = makeCloud(200, { text: "hello" });
  const reads: Array<string> = [];
  const resolver = Layer.succeed(
    SecretResolver,
    SecretResolver.of({
      read: (references) =>
        Effect.sync(() =>
          references.map((reference) => {
            reads.push(reference.reference);
            return "sk-from-provider-1234567890";
          }),
        ),
      invalidate: () => Effect.void,
      label: (provider) => Effect.succeed(provider),
    }),
  );
  return Effect.gen(function* () {
    const cloud = yield* CloudSpeech.CloudSpeech;
    yield* cloud.setKey("openai", {
      provider: "op" as never,
      reference: "op://vault/voice/key",
    });
    // The keychain holds the reference, never the key.
    assert.notInclude(keychain.get("voice.openai-api-key") ?? "", "sk-");
    assert.deepEqual(CloudSpeech.parseStoredReference(keychain.get("voice.openai-api-key")), {
      provider: "op",
      reference: "op://vault/voice/key",
    });
    assert.deepEqual(yield* cloud.configured, { openai: true, xai: false, openrouter: false });
    assert.equal(reads.length, 0);
    const text = yield* cloud.transcribe("openai", pcm, DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS);
    assert.equal(text, "hello");
    assert.equal(requests[0]?.headers.authorization, "Bearer sk-from-provider-1234567890");
    assert.isAbove(reads.length, 0);
  }).pipe(Effect.provide(Layer.provideMerge(layer, resolver)));
});
