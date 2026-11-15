import { cloudSpeechLanguages, effectiveSpeechLanguage } from "@tabs/shared/speech";
import {
  getCloudSpeechKeys,
  getEnvironmentSpeechStatus,
  getEnvironmentSpeechStreamUrl,
  openSpeechStream,
  throwIfVoiceTranscriptionAborted,
  transcribeCloudPcm,
  transcribeEnvironmentPcm,
  VoiceTranscriptionError,
  type VoiceTranscriptionOptions,
} from "@tabs/client-runtime/voice-input";
import type { PreparedConnection } from "@tabs/client-runtime/connection";
import type {
  CloudSpeechModelId,
  CloudSpeechProvider,
  SpeechStreamText,
  SpeechTranscriptionOptions,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { createBrowserPcmCapture } from "./browserPcmCapture";

const isVoiceTranscriptionError = Schema.is(VoiceTranscriptionError);

export function runSpeech<A, E>(
  effect: Effect.Effect<A, E>,
  options?: Effect.RunOptions,
): Promise<A> {
  return Effect.runPromise(effect, options);
}

export function createBrowserVoiceInputPlatform(input: {
  readonly prepared: PreparedConnection;
  /** Set to send audio to a cloud provider instead of this environment's model. */
  readonly getCloudProvider?: () => {
    readonly provider: CloudSpeechProvider;
    readonly model: CloudSpeechModelId | null;
  } | null;
  readonly getTranscriptionOptions: () => SpeechTranscriptionOptions;
  readonly getMicrophoneId: () => string | Promise<string>;
  readonly onLevel: (level: number) => void;
  readonly onDurationLimit: () => void;
  readonly onText: (text: SpeechStreamText) => void;
  readonly onError: (message: string) => void;
}) {
  const canSend = () => true;
  return createBrowserPcmCapture(input, async (options) => {
    const recordingOptions = input.getTranscriptionOptions();
    const cloud = input.getCloudProvider?.() ?? null;
    const transcribe = async (uri: string, { signal }: VoiceTranscriptionOptions) => {
      try {
        const response = await fetch(uri, { signal });
        const pcm = new Uint8Array(await response.arrayBuffer());
        const result = await runSpeech(
          cloud
            ? transcribeCloudPcm(
                input.prepared,
                cloud.provider,
                pcm,
                recordingOptions,
                canSend,
                cloud.model ?? undefined,
              )
            : transcribeEnvironmentPcm(input.prepared, pcm, recordingOptions, canSend),
          { signal },
        );
        throwIfVoiceTranscriptionAborted(signal);
        return result.text;
      } catch (cause) {
        throwIfVoiceTranscriptionAborted(signal);
        if (isVoiceTranscriptionError(cause)) throw cause;
        throw new VoiceTranscriptionError({
          code: "transcription-failed",
          message: "Voice transcription failed. Check Settings → Labs → Voice input.",
          cause,
        });
      }
    };
    if (cloud) {
      if (cloud.provider === "openrouter" && !cloud.model)
        throw new VoiceTranscriptionError({
          code: "unavailable",
          message: "Choose an OpenRouter model in Settings → Labs → Voice input.",
        });
      const keys = await runSpeech(getCloudSpeechKeys(input.prepared), options);
      throwIfVoiceTranscriptionAborted(options.signal);
      if (!keys[cloud.provider])
        throw new VoiceTranscriptionError({
          code: "unavailable",
          message: "Add your API key in Settings → Labs → Voice input.",
        });
      return {
        locale: effectiveSpeechLanguage(cloudSpeechLanguages, recordingOptions.speechLanguage),
        transcribe,
      };
    }
    const status = await runSpeech(getEnvironmentSpeechStatus(input.prepared), options);
    throwIfVoiceTranscriptionAborted(options.signal);
    if (!status.supported)
      throw new VoiceTranscriptionError({ code: "unavailable", message: status.reason });
    const language = status.languages
      ? effectiveSpeechLanguage(
          {
            languages: status.languages,
            supportsLanguageDetection: status.supportsLanguageDetection ?? false,
          },
          recordingOptions.speechLanguage,
        )
      : "auto";
    const locale =
      !status.supportsStreaming &&
      status.supportsTranslation &&
      recordingOptions.speechTranslateToEnglish
        ? "en"
        : language;
    if (!status.supportsStreaming && !status.supportsBufferedStreaming) {
      return { locale, transcribe };
    }
    const url = await runSpeech(getEnvironmentSpeechStreamUrl(input.prepared), options);
    return {
      locale,
      transcribe,
      streaming: openSpeechStream({
        url,
        canSend,
        options: recordingOptions,
        signal: options.signal,
        onText: input.onText,
        onError: (error) => input.onError(error.message),
      }),
    };
  });
}
