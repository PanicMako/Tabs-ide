import {
  downloadEnvironmentSpeechModel,
  getEnvironmentSpeechModels,
  getEnvironmentSpeechStatus,
  removeEnvironmentSpeechModel,
  selectEnvironmentSpeechModel,
  updateEnvironmentSpeechModelUnloadTimeout,
} from "@tabs/client-runtime/voice-input";
import type {
  EnvironmentSpeechModel,
  EnvironmentSpeechStatus,
  SpeechModelUnloadTimeout,
  VoiceShortcutMode,
} from "@tabs/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { runSpeech } from "../../speech/browserVoiceInput";
import { listBrowserMicrophones, type BrowserMicrophone } from "../../speech/browserMicrophones";
import { primaryVoiceConnection } from "../../speech/primaryVoiceConnection";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import { MicrophoneTest } from "./MicrophoneTest";
import { SpeechModelPicker } from "./SpeechModelPicker";
import { VoiceTranscriptionSettings } from "./VoiceTranscriptionSettings";

const SHORTCUT_MODES: ReadonlyArray<{ value: VoiceShortcutMode; label: string }> = [
  { value: "auto", label: "Tap or hold" },
  { value: "hold", label: "Hold to talk" },
  { value: "toggle", label: "Tap to toggle" },
];

const UNLOAD_TIMEOUTS: ReadonlyArray<{ value: SpeechModelUnloadTimeout; label: string }> = [
  { value: "immediately", label: "Right away" },
  { value: "min_2", label: "After 2 min" },
  { value: "min_5", label: "After 5 min" },
  { value: "min_10", label: "After 10 min" },
  { value: "min_15", label: "After 15 min" },
  { value: "hour_1", label: "After 1 hour" },
  { value: "never", label: "Never" },
];

function useSpeechCatalog() {
  const [status, setStatus] = useState<EnvironmentSpeechStatus | null>(null);
  const [models, setModels] = useState<ReadonlyArray<EnvironmentSpeechModel>>([]);
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const prepared = await primaryVoiceConnection();
    const [nextStatus, catalog] = await Promise.all([
      runSpeech(getEnvironmentSpeechStatus(prepared)),
      runSpeech(getEnvironmentSpeechModels(prepared)),
    ]);
    setStatus(nextStatus);
    setModels(catalog.models);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the environment's speech status and model catalog when the page opens
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the catalog only while a model is downloading so progress stays current
  useEffect(() => {
    if (!models.some((model) => model.state === "downloading")) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1_000);
    return () => window.clearInterval(timer);
  }, [models, refresh]);

  const run = useCallback(
    async (modelId: string, action: "download" | "select" | "remove") => {
      setBusyModelId(modelId);
      try {
        const prepared = await primaryVoiceConnection();
        const request =
          action === "download"
            ? downloadEnvironmentSpeechModel(prepared, modelId)
            : action === "select"
              ? selectEnvironmentSpeechModel(prepared, modelId)
              : removeEnvironmentSpeechModel(prepared, modelId);
        // Downloads block until finished, so refresh alongside to show progress.
        const pending = runSpeech(request);
        if (action === "download") void refresh().catch(() => undefined);
        await pending;
        await refresh();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Voice model",
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyModelId(null);
      }
    },
    [refresh],
  );

  return { status, models, busyModelId, run, refresh };
}

export default function VoiceSettings({ onBack }: { onBack?: () => void } = {}) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const catalog = useSpeechCatalog();
  const [microphones, setMicrophones] = useState<ReadonlyArray<BrowserMicrophone>>([]);
  const [customWords, setCustomWords] = useState(() => settings.speechCustomWords.join(", "));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lists the browser's audio inputs when the page opens
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void listBrowserMicrophones()
      .then(setMicrophones)
      .catch(() => undefined);
  }, []);

  const preferredMicrophone = settings.voiceMicrophones[0];
  const microphoneValue =
    preferredMicrophone?.kind === "device" ? preferredMicrophone.deviceId : "default";
  const status = catalog.status;

  return (
    <div className="flex flex-col gap-7">
      <SettingsSectionHeader
        title="Voice input"
        description="Dictate into the composer. Speech is transcribed on this device unless you choose a cloud provider below."
        preTitle={
          onBack ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onBack}
              aria-label="Back to Labs"
              className="size-8 shrink-0 rounded-full"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : undefined
        }
      />
      <VoiceTranscriptionSettings />
      <SettingsSection title="Dictation">
        <SettingsRow
          title="Microphone in the composer"
          description="Shows a microphone next to Attach images. The shortcut also starts dictation."
          control={
            <Switch
              aria-label="Voice input"
              checked={settings.voiceInputEnabled}
              onCheckedChange={(checked) => void updateSettings({ voiceInputEnabled: checked })}
            />
          }
        />
        <SettingsRow
          title="Shortcut"
          description="How the dictation shortcut behaves."
          control={
            <Select
              value={settings.voiceShortcutMode}
              onValueChange={(value) => {
                if (value) void updateSettings({ voiceShortcutMode: value as VoiceShortcutMode });
              }}
            >
              <SelectTrigger size="sm" aria-label="Shortcut mode" className="min-w-36">
                {SHORTCUT_MODES.find((mode) => mode.value === settings.voiceShortcutMode)?.label}
              </SelectTrigger>
              <SelectPopup align="end">
                {SHORTCUT_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Microphone"
          description="Labels appear after you allow microphone access once."
          control={
            <Select
              value={microphoneValue}
              onValueChange={(value) => {
                if (!value) return;
                const device = microphones.find((entry) => entry.deviceId === value);
                void updateSettings({
                  voiceMicrophones:
                    value === "default" || !device
                      ? [{ kind: "default" }]
                      : [
                          { kind: "device", deviceId: device.deviceId, label: device.label },
                          { kind: "default" },
                        ],
                });
              }}
            >
              <SelectTrigger size="sm" aria-label="Microphone" className="min-w-44 max-w-64">
                <span className="min-w-0 truncate">
                  {microphoneValue === "default"
                    ? "System default"
                    : (microphones.find((entry) => entry.deviceId === microphoneValue)?.label ??
                      (preferredMicrophone?.kind === "device" ? preferredMicrophone.label : "") ??
                      "Saved microphone")}
                </span>
              </SelectTrigger>
              <SelectPopup align="end">
                <SelectItem value="default">System default</SelectItem>
                {microphones
                  .filter((entry) => entry.deviceId && entry.deviceId !== "default")
                  .map((entry) => (
                    <SelectItem key={entry.deviceId} value={entry.deviceId}>
                      {entry.label}
                    </SelectItem>
                  ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Test your microphone"
          description="Records five seconds and plays them back. Nothing leaves this device."
          control={<MicrophoneTest microphoneId={microphoneValue} />}
        />
        <SettingsRow
          title="Clean up with AI"
          description="Your writing model fixes punctuation and recognition errors using the nearby draft. Sends the transcript and surrounding text to that model."
          control={
            <Switch
              aria-label="Clean up with AI"
              checked={settings.speechCleanupEnabled}
              onCheckedChange={(checked) => void updateSettings({ speechCleanupEnabled: checked })}
            />
          }
        />
        <SettingsRow
          title="Remove filler words"
          description="Drops um, uh and similar from transcripts."
          control={
            <Switch
              aria-label="Remove filler words"
              checked={settings.speechRemoveFillerWords}
              onCheckedChange={(checked) =>
                void updateSettings({ speechRemoveFillerWords: checked })
              }
            />
          }
        />
        <SettingsRow
          title="Skip silence"
          description="Trims pauses before transcribing, which is faster on long recordings."
          control={
            <Switch
              aria-label="Skip silence"
              checked={settings.speechSilenceFiltering}
              onCheckedChange={(checked) =>
                void updateSettings({ speechSilenceFiltering: checked })
              }
            />
          }
        />
        <SettingsRow
          title="Custom words"
          description="Names and terms to recognize, separated by commas."
        >
          <div className="px-3 pb-3">
            <Textarea
              aria-label="Custom words"
              placeholder="Tabs, Effect, OpenCode"
              value={customWords}
              onChange={(event) => setCustomWords(event.target.value)}
              onBlur={() =>
                void updateSettings({
                  speechCustomWords: customWords
                    .split(",")
                    .map((word) => word.trim())
                    .filter((word) => word.length > 0),
                })
              }
            />
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Speech model">
        {status && !status.supported ? (
          <SettingsRow title="Not available" description={status.reason} />
        ) : (
          <>
            <SpeechModelPicker
              models={catalog.models}
              language={settings.speechLanguage}
              busyModelId={catalog.busyModelId}
              onAction={(modelId, action) => void catalog.run(modelId, action)}
            />
            {status?.supported && (
              <SettingsRow
                title="Free memory"
                description="Unload the model when dictation has been idle for a while."
                control={
                  <Select
                    value={status.modelUnloadTimeout}
                    onValueChange={(value) => {
                      if (!value) return;
                      void primaryVoiceConnection()
                        .then((prepared) =>
                          runSpeech(
                            updateEnvironmentSpeechModelUnloadTimeout(
                              prepared,
                              value as SpeechModelUnloadTimeout,
                            ),
                          ),
                        )
                        .then(() => catalog.refresh())
                        .catch(() => undefined);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label="Unload model" className="min-w-32">
                      {UNLOAD_TIMEOUTS.find((entry) => entry.value === status.modelUnloadTimeout)
                        ?.label ?? "After 15 min"}
                    </SelectTrigger>
                    <SelectPopup align="end">
                      {UNLOAD_TIMEOUTS.map((entry) => (
                        <SelectItem key={entry.value} value={entry.value}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />
            )}
          </>
        )}
      </SettingsSection>
    </div>
  );
}
