import {
  cancelEnvironmentSpeechModelDownload,
  downloadEnvironmentSpeechModel,
  getEnvironmentSpeechModels,
  getEnvironmentSpeechStatus,
  postProcessEnvironmentTranscript,
  selectEnvironmentSpeechModel,
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputState,
} from "@tabs/client-runtime/voice-input";
import type { PreparedConnection } from "@tabs/client-runtime/connection";
import type {
  EnvironmentSpeechModel,
  EnvironmentSpeechStatus,
  SpeechStreamText,
  SpeechTranscriptionOptions,
} from "@tabs/contracts";
import { chooseSetupSpeechModel, resolveSpeechVocabulary } from "@tabs/shared/speech";
import { useCallback, useEffect, useRef, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { useClientSettings, useServerSettings } from "../state/settings";
import { chooseRecordingMicrophone } from "./browserMicrophones";
import { createBrowserVoiceInputPlatform, runSpeech } from "./browserVoiceInput";
import { preferredSpeechLanguages } from "./preferredSpeechLanguages";
import { primaryVoiceConnection } from "./primaryVoiceConnection";

const IDLE: VoiceInputState = { phase: "idle", error: null, errorAction: null };
const PREPARING: VoiceInputState = { phase: "preparing", error: null, errorAction: null };

export type DictationSetup = {
  readonly open: boolean;
  readonly model: EnvironmentSpeechModel | null;
  readonly downloading: boolean;
  readonly error: string | null;
};

const CLOSED_SETUP: DictationSetup = { open: false, model: null, downloading: false, error: null };

type DraftInput = {
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
};

export type ComposerDictationInput = {
  /** Changing owner (thread, draft) abandons a recording so a late transcript cannot land elsewhere. */
  readonly ownerKey: string;
  readonly draftText: string;
  readonly projectName?: string | null;
  readonly disabled?: boolean;
  readonly readDraft: () => DraftInput;
  readonly commitDraft: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => void;
};

function microphoneSupported() {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioWorkletNode !== "undefined"
  );
}

/** On-device dictation into a composer draft, transcribed by this window's environment. */
export function useComposerDictation(input: ComposerDictationInput) {
  const clientSettings = useClientSettings();
  const projectWords = useServerSettings().speechProjectCustomWords;
  const [prepared, setPrepared] = useState<PreparedConnection | null>(null);
  const [state, setState] = useState<VoiceInputState>(IDLE);
  const [level, setLevel] = useState(0);
  const [preview, setPreview] = useState<SpeechStreamText | null>(null);
  const [setup, setSetup] = useState<DictationSetup>(CLOSED_SETUP);
  const [statusValue, setStatusValue] = useState<EnvironmentSpeechStatus | null>(null);

  const latest = useRef({ input, clientSettings, projectWords });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes committed props and settings to the asynchronous recording controller
  useEffect(() => {
    latest.current = { input, clientSettings, projectWords };
  });
  const revision = useRef({ ownerKey: input.ownerKey, text: input.draftText, value: 0 });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks draft revisions so a late transcript cannot overwrite an edited draft
  useEffect(() => {
    const current = revision.current;
    if (current.ownerKey !== input.ownerKey || current.text !== input.draftText) {
      revision.current = {
        ownerKey: input.ownerKey,
        text: input.draftText,
        value: current.value + 1,
      };
    }
  }, [input.ownerKey, input.draftText]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves the window's environment connection once for speech requests
  useEffect(() => {
    if (!microphoneSupported()) return;
    let disposed = false;
    void primaryVoiceConnection()
      .then((connection) => {
        if (!disposed) setPrepared(connection);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads whether this environment supports dictation so the mic is offered only where it works
  useEffect(() => {
    if (!prepared) return;
    let disposed = false;
    void runSpeech(getEnvironmentSpeechStatus(prepared))
      .then((value) => {
        if (!disposed) setStatusValue(value);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [prepared]);

  const controllerRef = useRef<VoiceInputController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the recording controller for the resolved environment connection
  useEffect(() => {
    if (!prepared) return;
    let disposed = false;
    const readDraft = (): VoiceDraftSnapshot => {
      const current = latest.current.input;
      const draft = current.readDraft();
      if (revision.current.ownerKey !== current.ownerKey || revision.current.text !== draft.text) {
        revision.current = {
          ownerKey: current.ownerKey,
          text: draft.text,
          value: revision.current.value + 1,
        };
      }
      return {
        ownerKey: current.ownerKey,
        text: draft.text,
        selection: draft.selection,
        revision: revision.current.value,
      };
    };
    let controller: VoiceInputController;
    const platform = createBrowserVoiceInputPlatform({
      prepared,
      getCloudProvider: () => {
        const settings = latest.current.clientSettings;
        return settings.voiceTranscriptionProvider === "local"
          ? null
          : { provider: settings.voiceTranscriptionProvider, model: settings.voiceCloudModel };
      },
      getTranscriptionOptions: (): SpeechTranscriptionOptions => {
        const { clientSettings: settings, projectWords: project, input: current } = latest.current;
        return {
          speechLanguage: settings.speechLanguage,
          speechTranslateToEnglish: settings.speechTranslateToEnglish,
          speechCustomWords: resolveSpeechVocabulary({
            personal: settings.speechCustomWords,
            project,
            hints: [current.projectName ?? ""],
          }),
          speechRemoveFillerWords: settings.speechRemoveFillerWords,
          speechSilenceFiltering: settings.speechSilenceFiltering,
        };
      },
      getMicrophoneId: chooseRecordingMicrophone,
      onLevel: setLevel,
      onDurationLimit: () => void controller.stop(),
      onText: (text) => {
        if (!disposed) setPreview(text);
      },
      onError: (message) => {
        if (!disposed) void controller.interruptRecording(message);
      },
    });
    controller = new VoiceInputController({
      retryFailedRecording: true,
      // Opt-in clean-up by the writing model; returning null inserts the raw transcript.
      postProcess: (transcript, { signal, draft }) => {
        const { clientSettings: settings, projectWords: project, input: current } = latest.current;
        if (!settings.speechCleanupEnabled || current.ownerKey !== draft.ownerKey) return null;
        const limit = 1_024;
        const start = Math.max(0, Math.min(draft.selection.start, draft.text.length));
        const end = Math.max(start, Math.min(draft.selection.end, draft.text.length));
        const before = draft.text.slice(Math.max(0, start - limit), start);
        const selected = draft.text.slice(start, Math.min(end, start + limit));
        return runSpeech(
          postProcessEnvironmentTranscript(
            prepared,
            transcript,
            {
              text: before + selected + draft.text.slice(end, end + limit),
              selection: { start: before.length, end: before.length + selected.length },
            },
            {
              speechCustomWords: resolveSpeechVocabulary({
                personal: settings.speechCustomWords,
                project,
                hints: [current.projectName ?? ""],
              }),
              speechPostProcessingPrompt: settings.speechPostProcessingPrompt,
            },
            () => !disposed,
          ),
          { signal },
        ).then((result) => result.text);
      },
      onPostProcessingError: () =>
        toastManager.add({
          type: "warning",
          title: "Transcript clean-up failed",
          description: "The original transcript was added.",
        }),
      recorder: platform.recorder,
      getTranscriber: () => platform.transcriber,
      requestPermission: async () => ({ granted: true, canAskAgain: true }),
      configureRecording: async () => undefined,
      releaseRecording: async () => platform.cancelRecording(),
      deleteRecording: platform.deleteRecording,
      readDraft,
      commitDraft: (text, selection) => {
        if (latest.current.input.disabled) return;
        latest.current.input.commitDraft(text, selection);
      },
      onStateChange: (value) => {
        if (disposed) return;
        setState(value);
        if (value.phase !== "recording" && value.phase !== "transcribing") setPreview(null);
      },
    });
    controllerRef.current = controller;
    return () => {
      disposed = true;
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [prepared]);

  const previousOwner = useRef(input.ownerKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- abandons the recording when the draft's owner changes or the editor is disabled
  useEffect(() => {
    if (previousOwner.current === input.ownerKey && !input.disabled) return;
    previousOwner.current = input.ownerKey;
    controllerRef.current?.ownerChanged();
    setSetup(CLOSED_SETUP);
  }, [input.ownerKey, input.disabled]);

  const openSetup = useCallback(async (connection: PreparedConnection, selectedModelId: string) => {
    setSetup({ ...CLOSED_SETUP, open: true });
    const catalog = await runSpeech(getEnvironmentSpeechModels(connection)).catch(() => null);
    const choice = chooseSetupSpeechModel(catalog?.models ?? [], {
      selectedModelId,
      intent: latest.current.clientSettings.speechLanguage,
      preferred: preferredSpeechLanguages(),
    });
    setSetup({
      open: true,
      model: choice?.model ?? null,
      downloading: false,
      error: choice
        ? null
        : catalog
          ? "No speech model matches your language. Pick one in Settings → Voice."
          : "Could not load speech models. Try again.",
    });
  }, []);

  const start = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || !prepared || latest.current.input.disabled) return;
    // A cloud provider needs no local model; the platform checks its key when recording starts.
    if (latest.current.clientSettings.voiceTranscriptionProvider !== "local") {
      setLevel(0);
      await controller.start();
      return;
    }
    setState(PREPARING);
    let status: EnvironmentSpeechStatus;
    try {
      status = await runSpeech(getEnvironmentSpeechStatus(prepared));
    } catch (error) {
      setState(IDLE);
      toastManager.add({
        type: "error",
        title: "Could not start voice input",
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    setStatusValue(status);
    setState(IDLE);
    if (!status.supported) {
      toastManager.add({
        type: "error",
        title: "Voice input is not available",
        description: status.reason,
      });
      return;
    }
    if (status.state === "missing-model") {
      await openSetup(prepared, status.modelId);
      return;
    }
    setLevel(0);
    await controller.start();
  }, [openSetup, prepared]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls download progress while the setup prompt owns an active model download
  useEffect(() => {
    const modelId = setup.model?.id;
    if (!setup.open || !setup.downloading || !prepared || !modelId) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      void runSpeech(getEnvironmentSpeechModels(prepared))
        .then((result) => {
          const model = result.models.find((candidate) => candidate.id === modelId);
          if (!disposed && model) setSetup((current) => ({ ...current, model }));
        })
        .catch(() => undefined);
    }, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [prepared, setup.downloading, setup.open, setup.model?.id]);

  const downloadModel = useCallback(async () => {
    const modelId = setup.model?.id;
    if (!prepared || !modelId || setup.downloading) return;
    setSetup((current) => ({ ...current, downloading: true, error: null }));
    try {
      const { models } = await runSpeech(downloadEnvironmentSpeechModel(prepared, modelId));
      // A download cancelled elsewhere still resolves, so select the model only once it landed.
      const installed = models.some(({ id, state: s }) => id === modelId && s === "installed");
      if (!installed) throw new Error("The model is not ready.");
      await runSpeech(selectEnvironmentSpeechModel(prepared, modelId));
      setSetup(CLOSED_SETUP);
      setLevel(0);
      await controllerRef.current?.start();
    } catch {
      setSetup((current) => ({
        ...current,
        downloading: false,
        error: "Could not download the speech model. Check your connection and try again.",
      }));
    }
  }, [prepared, setup.downloading, setup.model?.id]);

  const closeSetup = useCallback(() => {
    const modelId = setup.model?.id;
    if (prepared && modelId && setup.downloading) {
      void runSpeech(cancelEnvironmentSpeechModelDownload(prepared, modelId)).catch(
        () => undefined,
      );
    }
    setSetup(CLOSED_SETUP);
  }, [prepared, setup.downloading, setup.model?.id]);

  return {
    available:
      prepared !== null &&
      microphoneSupported() &&
      (clientSettings.voiceTranscriptionProvider !== "local" || statusValue?.supported === true),
    state,
    level,
    preview: state.phase === "recording" || state.phase === "transcribing" ? preview : null,
    blocksSubmission: voiceInputBlocksSubmission(state),
    setup: { ...setup, download: downloadModel, close: closeSetup },
    start,
    stop: useCallback(() => controllerRef.current?.stop() ?? Promise.resolve(), []),
    cancel: useCallback(() => {
      setSetup(CLOSED_SETUP);
      controllerRef.current?.cancel();
    }, []),
  };
}
