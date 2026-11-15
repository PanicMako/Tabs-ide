// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off - real HTTP streaming boundary test.
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { it as effectIt } from "@effect/vitest";
import { expect, vi } from "vitest";
import {
  AuthSessionId,
  AuthOrchestrationOperateScope,
  type AuthEnvironmentScope,
  SPEECH_MAX_OPTIONS_BYTES,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentVoiceHttpApi,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as CloudSpeech from "./CloudSpeech.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as SpeechService from "./SpeechService.ts";
import { speechHttpApiLayer } from "./http.ts";

const decodeSessionId = Schema.decodeUnknownSync(AuthSessionId);

const principal = (...scopes: AuthEnvironmentScope[]) =>
  Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
    effect.pipe(
      Effect.provideService(EnvironmentAuthenticatedPrincipal, {
        sessionId: decodeSessionId("voice-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes: new Set(scopes),
      }),
    ),
  );

effectIt.live("rejects oversized chunked audio without invoking transcription", () =>
  Effect.gen(function* () {
    const transcribe = vi.fn(() => Effect.succeed("unexpected"));
    const routes = HttpApiBuilder.layer(
      HttpApi.make("environment").add(EnvironmentVoiceHttpApi),
    ).pipe(
      Layer.provide(speechHttpApiLayer),
      Layer.provide(Layer.mock(CloudSpeech.CloudSpeech)({})),
      Layer.provide(Layer.mock(TextGeneration.TextGeneration)({})),
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(NodeServices.layer),
      Layer.provide(principal(AuthOrchestrationOperateScope)),
      Layer.provide(
        Layer.succeed(SpeechService.SpeechService, {
          status: Effect.succeed({ supported: false as const, reason: "test" }),
          prepareModel: Effect.void,
          models: () => Effect.succeed({ models: [] }),
          downloadModel: () => Effect.succeed({ models: [] }),
          linkModels: () => Effect.succeed({ models: [] }),
          selectModel: () => Effect.succeed({ models: [] }),
          cancelDownload: () => Effect.succeed({ models: [] }),
          updateAcceleration: () => Effect.succeed({ supported: false as const, reason: "test" }),
          updateModelUnloadTimeout: () =>
            Effect.succeed({ supported: false as const, reason: "test" }),
          transcribe,
          startStream: () => Effect.die("not used"),
          removeModel: () => Effect.succeed({ models: [] }),
        }),
      ),
    );
    yield* Effect.gen(function* () {
      yield* Layer.build(HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }));
      const server = yield* HttpServer.HttpServer;
      const address = server.address as { readonly _tag: string; readonly port: number };
      const host = address._tag === "InetAddressV6" ? "[::1]" : "127.0.0.1";
      const url = `http://${host}:${address.port}/api/voice/transcribe`;
      yield* Effect.promise(() =>
        expect(
          // Refused either with 413 or by closing the socket mid-upload.
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new Uint8Array(SpeechService.MAX_SPEECH_BYTES + SPEECH_MAX_OPTIONS_BYTES + 4),
                );
                controller.enqueue(new Uint8Array(4));
                controller.close();
              },
            }),
            duplex: "half",
          }).then(
            (response) => response.status,
            () => "closed",
          ),
        ).resolves.toSatisfy((outcome) => outcome === 413 || outcome === "closed"),
      );
      expect(transcribe).not.toHaveBeenCalled();
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest));
  }),
);
