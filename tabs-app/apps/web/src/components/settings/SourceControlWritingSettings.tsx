import { useEffect, useMemo, useState } from "react";
import type { ServerProvider } from "@tabs/contracts";
import { createModelSelection } from "@tabs/shared/model";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { useServerConfig } from "~/state/settings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { SettingsProviderModelPicker } from "../chat/SettingsProviderModelPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow, SettingsSection } from "./SettingsLayout";
import { WRITING_STYLE_LABELS, type WritingStyleMode } from "./flowSettings.logic";

const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

/** How commit messages and pull request text are written, and by which model. */
export function SourceControlWritingSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverProviders = useServerConfig()?.providers ?? NO_PROVIDERS;
  const style = settings.sourceControlWritingStyle;
  const [instructions, setInstructions] = useState(style.customInstructions);
  useEffect(() => setInstructions(style.customInstructions), [style.customInstructions]);

  const writer =
    settings.sourceControlWriterModelSelection ?? settings.textGenerationModelSelection;
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );
  const optionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(
        settings,
        serverProviders,
        writer?.instanceId ?? null,
        writer?.model ?? null,
      ),
    [settings, serverProviders, writer?.instanceId, writer?.model],
  );
  const setStyle = (patch: Partial<typeof style>) =>
    updateSettings({ sourceControlWritingStyle: { ...style, ...patch } });

  return (
    <SettingsSection
      title="Commit and pull request writing"
      description="How Tabs words commit messages and pull request descriptions, and which model writes them."
    >
      <SettingsRow
        title="Writing style"
        description={WRITING_STYLE_LABELS[style.mode].hint}
        control={
          <Select
            value={style.mode}
            onValueChange={(value) => setStyle({ mode: value as WritingStyleMode })}
          >
            <SelectTrigger className="w-52" aria-label="Writing style">
              <SelectValue>{WRITING_STYLE_LABELS[style.mode].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(WRITING_STYLE_LABELS) as WritingStyleMode[]).map((mode) => (
                <SelectItem hideIndicator key={mode} value={mode}>
                  {WRITING_STYLE_LABELS[mode].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {style.mode === "custom" ? (
        <SettingsRow
          title="Writing instructions"
          description="Followed for every commit message and pull request."
          control={
            <Textarea
              className="w-80"
              rows={3}
              aria-label="Writing instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              onBlur={() => {
                if (instructions.trim() !== style.customInstructions) {
                  setStyle({ customInstructions: instructions.trim() });
                }
              }}
            />
          }
        />
      ) : null}
      <SettingsRow
        title="Follow pull request templates"
        description="When the repository has a pull request template, fill it in instead of writing free text."
        control={
          <Switch
            checked={style.followChangeRequestTemplates}
            onCheckedChange={(checked) =>
              setStyle({ followChangeRequestTemplates: Boolean(checked) })
            }
            aria-label="Follow pull request templates"
          />
        }
      />
      <SettingsRow
        title="Writer model"
        description={
          settings.sourceControlWriterModelSelection
            ? "A model chosen just for commits and pull requests."
            : "Uses the text generation model from General. Pick one here to use a different model for commits and pull requests."
        }
        resetAction={
          settings.sourceControlWriterModelSelection ? (
            <SettingResetButton
              label="writer model"
              onClick={() => updateSettings({ sourceControlWriterModelSelection: null })}
            />
          ) : null
        }
        control={
          writer ? (
            <SettingsProviderModelPicker
              activeInstanceId={writer.instanceId}
              model={writer.model}
              instanceEntries={entries}
              modelOptionsByInstance={optionsByInstance}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0"
              onInstanceModelChange={(instanceId, model) =>
                updateSettings({
                  sourceControlWriterModelSelection: createModelSelection(instanceId, model),
                })
              }
            />
          ) : null
        }
      />
    </SettingsSection>
  );
}
