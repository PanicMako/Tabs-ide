import {
  getCloudSpeechKeys,
  getCloudSpeechModels,
  setCloudSpeechKey,
} from "@tabs/client-runtime/voice-input";
import { builtInSecretProviderDefinitions } from "@tabs/shared/secretProviders/registry";
import {
  CLOUD_SPEECH_LABELS,
  type CloudSpeechKeys,
  type CloudSpeechModel,
  type CloudSpeechModelId,
  type CloudSpeechProvider,
  type SecretReference,
  type SecretProviderId,
} from "@tabs/contracts";
import { useCallback, useEffect, useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { runSpeech } from "../../speech/browserVoiceInput";
import { primaryVoiceConnection } from "../../speech/primaryVoiceConnection";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

type Destination = "local" | CloudSpeechProvider;

const DESTINATIONS: ReadonlyArray<{ value: Destination; label: string }> = [
  { value: "local", label: "On this device" },
  { value: "openai", label: CLOUD_SPEECH_LABELS.openai },
  { value: "xai", label: CLOUD_SPEECH_LABELS.xai },
  { value: "openrouter", label: CLOUD_SPEECH_LABELS.openrouter },
];

/** Where dictated audio is transcribed: the on-device model or a cloud provider with your key. */
export function VoiceTranscriptionSettings() {
  const destination = useSettings((settings) => settings.voiceTranscriptionProvider);
  const cloudModel = useSettings((settings) => settings.voiceCloudModel);
  const { updateSettings } = useUpdateSettings();
  const [keys, setKeys] = useState<CloudSpeechKeys | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ReadonlyArray<CloudSpeechModel> | null>(null);

  const refreshKeys = useCallback(async () => {
    const prepared = await primaryVoiceConnection();
    setKeys(await runSpeech(getCloudSpeechKeys(prepared)));
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads which cloud keys this environment holds when the page opens
  useEffect(() => {
    void refreshKeys().catch(() => undefined);
  }, [refreshKeys]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads OpenRouter's public model catalog once OpenRouter is chosen
  useEffect(() => {
    if (destination !== "openrouter" || models !== null) return;
    let disposed = false;
    void primaryVoiceConnection()
      .then((prepared) => runSpeech(getCloudSpeechModels(prepared)))
      .then((result) => {
        if (!disposed) setModels(result.models);
      })
      .catch(() => {
        if (!disposed) setModels([]);
      });
    return () => {
      disposed = true;
    };
  }, [destination, models]);

  // A pasted reference such as op://vault/item/field is kept as a reference, so the key itself
  // stays in the secret provider; any other text is the key.
  const secretProviders = useSettings((settings) => settings.secretProviders) ?? {};
  const asReference = (value: string): SecretReference | null => {
    const entry = Object.entries(secretProviders).find(
      ([, config]) =>
        builtInSecretProviderDefinitions.find(config.kind)?.isReference(value) === true,
    );
    return entry ? { provider: entry[0] as SecretProviderId, reference: value } : null;
  };

  const saveKey = async (provider: CloudSpeechProvider, key: string | SecretReference | null) => {
    setSaving(true);
    try {
      const prepared = await primaryVoiceConnection();
      await runSpeech(setCloudSpeechKey(prepared, provider, key));
      setDraftKey("");
      await refreshKeys();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save the key",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const cloud = destination === "local" ? null : destination;
  const hasKey = cloud !== null && keys?.[cloud] === true;

  return (
    <SettingsSection title="Transcription">
      <SettingsRow
        title="Transcribe with"
        description={
          cloud
            ? `Recordings are sent to ${CLOUD_SPEECH_LABELS[cloud]} with your key. Each recording is uploaded when you stop.`
            : "Speech is transcribed by a model on this machine. Audio does not leave it."
        }
        control={
          <Select
            value={destination}
            onValueChange={(value) => {
              if (value) void updateSettings({ voiceTranscriptionProvider: value as Destination });
            }}
          >
            <SelectTrigger size="sm" aria-label="Transcribe with" className="min-w-44">
              {DESTINATIONS.find((entry) => entry.value === destination)?.label}
            </SelectTrigger>
            <SelectPopup align="end">
              {DESTINATIONS.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {cloud && (
        <SettingsRow
          title="API key"
          description={
            hasKey
              ? "Saved in this machine's keychain, or read from your secret provider. It is never shown again."
              : "Stored in this machine's keychain, never in settings files. A reference to a secret provider item works too."
          }
          control={
            hasKey ? (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void saveKey(cloud, null)}
              >
                Remove key
              </Button>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (draftKey.trim())
                    void saveKey(cloud, asReference(draftKey.trim()) ?? draftKey.trim());
                }}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  aria-label={`${CLOUD_SPEECH_LABELS[cloud]} API key`}
                  placeholder="Paste API key or op:// reference"
                  value={draftKey}
                  onChange={(event) => setDraftKey(event.target.value)}
                  className="w-52"
                />
                <Button size="sm" type="submit" disabled={saving || !draftKey.trim()}>
                  Save
                </Button>
              </form>
            )
          }
        />
      )}
      {cloud === "openrouter" && (
        <SettingsRow
          title="Model"
          description="OpenRouter has no default transcription model. Only zero-retention models are listed."
          control={
            <Select
              value={cloudModel ?? ""}
              onValueChange={(value) => {
                if (value) void updateSettings({ voiceCloudModel: value as CloudSpeechModelId });
              }}
            >
              <SelectTrigger size="sm" aria-label="OpenRouter model" className="min-w-52 max-w-72">
                {models === null
                  ? "Loading…"
                  : (models.find((model) => model.id === cloudModel)?.name ??
                    (models.length === 0 ? "No models available" : "Choose a model"))}
              </SelectTrigger>
              <SelectPopup align="end">
                {(models ?? []).map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      )}
    </SettingsSection>
  );
}
