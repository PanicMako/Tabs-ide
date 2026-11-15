import { encodeSpeechPcmRequest } from "@tabs/shared/speech";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { CloudSpeechError, SPEECH_STREAM_PATH } from "@tabs/contracts";
import * as Schema from "effect/Schema";
import type {
  CloudSpeechModelId,
  CloudSpeechProvider,
  SecretReference,
  SpeechAcceleration,
  SpeechModelUnloadTimeout,
  SpeechPostProcessingOptions,
  SpeechTranscriptionOptions,
} from "@tabs/contracts";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  remoteHttpClientLayer,
} from "../rpc/http.ts";
import { VoiceTranscriptionError } from "./transcription.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const isCloudSpeechError = Schema.is(CloudSpeechError);
const INFERENCE_OR_DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

type EnvironmentApiClient = Effect.Success<ReturnType<typeof makeEnvironmentHttpApiClient>>;
type AuthorizationHeaders = { readonly authorization?: string };

// The local environment authenticates with its session cookie; a paired one sends its bearer token.
// DPoP-bound relay connections need a per-request proof that dictation does not sign yet.
const authorizationHeaders = (
  prepared: PreparedConnection,
): Effect.Effect<AuthorizationHeaders, VoiceTranscriptionError> => {
  const authorization = prepared.httpAuthorization;
  if (authorization === null) return Effect.succeed({});
  if (authorization._tag === "Bearer") {
    return Effect.succeed({ authorization: `Bearer ${authorization.token}` });
  }
  return Effect.fail(
    new VoiceTranscriptionError({
      code: "unavailable",
      message: "Dictation is not available over this connection yet.",
    }),
  );
};

const request = <A, E>(input: {
  readonly prepared: PreparedConnection;
  readonly path: string;
  readonly timeoutMs?: number;
  readonly canSend?: () => boolean;
  readonly run: (input: {
    readonly client: EnvironmentApiClient;
    readonly headers: AuthorizationHeaders;
  }) => Effect.Effect<A, E>;
}) =>
  Effect.gen(function* () {
    const headers = yield* authorizationHeaders(input.prepared);
    const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
    return yield* executeEnvironmentHttpRequest(
      environmentEndpointUrl(input.prepared.httpBaseUrl, input.path),
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      Effect.suspend(() =>
        input.canSend?.() === false ? Effect.interrupt : input.run({ client, headers }),
      ),
    );
  }).pipe(Effect.provide(remoteHttpClientLayer(globalThis.fetch.bind(globalThis))));

export const getEnvironmentSpeechStatus = (prepared: PreparedConnection) =>
  request({
    prepared,
    path: "/api/voice/status",
    run: ({ client, headers }) => client.voice.status({ headers }),
  });

export const getEnvironmentSpeechStreamUrl = (prepared: PreparedConnection) =>
  request({
    prepared,
    path: "/api/auth/websocket-ticket",
    run: ({ client, headers }) => client.auth.webSocketTicket({ headers }),
  }).pipe(
    Effect.map(({ ticket }) => {
      const url = new URL(SPEECH_STREAM_PATH, prepared.httpBaseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("wsTicket", ticket);
      return url.toString();
    }),
  );

export const getEnvironmentSpeechModels = (
  prepared: PreparedConnection,
  includeBenchmarks = false,
) => {
  const query = includeBenchmarks ? { benchmarks: "1" as const } : {};
  return request({
    prepared,
    path: "/api/voice/models",
    run: ({ client, headers }) => client.voice.models({ headers, query }),
  });
};

export const downloadEnvironmentSpeechModel = (prepared: PreparedConnection, modelId: string) =>
  request({
    prepared,
    path: "/api/voice/models/download",
    timeoutMs: INFERENCE_OR_DOWNLOAD_TIMEOUT_MS,
    run: ({ client, headers }) => client.voice.downloadModel({ headers, payload: { modelId } }),
  });

export const selectEnvironmentSpeechModel = (prepared: PreparedConnection, modelId: string) =>
  request({
    prepared,
    path: "/api/voice/models/select",
    run: ({ client, headers }) => client.voice.selectModel({ headers, payload: { modelId } }),
  });

export const cancelEnvironmentSpeechModelDownload = (
  prepared: PreparedConnection,
  modelId: string,
) =>
  request({
    prepared,
    path: "/api/voice/models/cancel",
    run: ({ client, headers }) =>
      client.voice.cancelModelDownload({ headers, payload: { modelId } }),
  });

export const transcribeEnvironmentPcm = (
  prepared: PreparedConnection,
  pcm: Uint8Array,
  options: SpeechTranscriptionOptions,
  canSend: () => boolean,
) =>
  request({
    prepared,
    path: "/api/voice/transcribe",
    canSend,
    timeoutMs: INFERENCE_OR_DOWNLOAD_TIMEOUT_MS,
    run: ({ client, headers }) =>
      client.voice.transcribe({ headers, payload: encodeSpeechPcmRequest(pcm, options) }),
  });

export const updateEnvironmentSpeechAcceleration = (
  prepared: PreparedConnection,
  acceleration: SpeechAcceleration,
) =>
  request({
    prepared,
    path: "/api/voice/acceleration",
    run: ({ client, headers }) =>
      client.voice.updateAcceleration({ headers, payload: { acceleration } }),
  });

export const updateEnvironmentSpeechModelUnloadTimeout = (
  prepared: PreparedConnection,
  timeout: SpeechModelUnloadTimeout,
) =>
  request({
    prepared,
    path: "/api/voice/model-unload-timeout",
    run: ({ client, headers }) =>
      client.voice.updateModelUnloadTimeout({ headers, payload: { timeout } }),
  });

export const linkEnvironmentSpeechModels = (prepared: PreparedConnection, path: string) =>
  request({
    prepared,
    path: "/api/voice/models/link",
    // Hashing several multi-gigabyte files takes longer than an ordinary request.
    timeoutMs: INFERENCE_OR_DOWNLOAD_TIMEOUT_MS,
    run: ({ client, headers }) => client.voice.linkModels({ headers, payload: { path } }),
  });

export const removeEnvironmentSpeechModel = (prepared: PreparedConnection, modelId: string) =>
  request({
    prepared,
    path: "/api/voice/models/remove",
    run: ({ client, headers }) => client.voice.removeModel({ headers, payload: { modelId } }),
  });

export const getCloudSpeechKeys = (prepared: PreparedConnection) =>
  request({
    prepared,
    path: "/api/voice/cloud/keys",
    run: ({ client, headers }) => client.voice.cloudKeys({ headers }),
  });

export const getCloudSpeechModels = (prepared: PreparedConnection) =>
  request({
    prepared,
    path: "/api/voice/cloud/openrouter/models",
    run: ({ client, headers }) => client.voice.cloudModels({ headers }),
  });

/** Stores the key on the environment's keychain; null removes it. The key never comes back. */
export const setCloudSpeechKey = (
  prepared: PreparedConnection,
  provider: CloudSpeechProvider,
  key: string | SecretReference | null,
) =>
  request({
    prepared,
    path: `/api/voice/cloud/${provider}/key`,
    run: ({ client, headers }) =>
      client.voice.setCloudKey({
        headers,
        params: { provider },
        payload: { key: key === null || typeof key !== "string" ? key : Redacted.make(key) },
      }),
  });

export const transcribeCloudPcm = (
  prepared: PreparedConnection,
  provider: CloudSpeechProvider,
  pcm: Uint8Array,
  options: SpeechTranscriptionOptions,
  canSend: () => boolean,
  model?: CloudSpeechModelId,
) => {
  const query = model === undefined ? {} : { model };
  return request({
    prepared,
    path: `/api/voice/cloud/${provider}/transcribe`,
    canSend,
    timeoutMs: 130_000,
    run: ({ client, headers }) =>
      client.voice.transcribeCloud({
        headers,
        params: { provider },
        query,
        payload: encodeSpeechPcmRequest(pcm, options),
      }),
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "RemoteEnvironmentAuthFetchError" && isCloudSpeechError(error.cause)
        ? new VoiceTranscriptionError({
            code: "transcription-failed",
            message: error.cause.message,
          })
        : error,
    ),
  );
};

/** Asks the environment's writing model to clean a transcript; a separate opt-in from dictation. */
export const postProcessEnvironmentTranscript = (
  prepared: PreparedConnection,
  transcript: string,
  draft: {
    readonly text: string;
    readonly selection: { readonly start: number; readonly end: number };
  },
  options: SpeechPostProcessingOptions,
  canSend: () => boolean,
) =>
  request({
    prepared,
    path: "/api/voice/post-process",
    canSend,
    timeoutMs: INFERENCE_OR_DOWNLOAD_TIMEOUT_MS,
    run: ({ client, headers }) =>
      client.voice.postProcess({ headers, payload: { transcript, draft, options } }),
  });
