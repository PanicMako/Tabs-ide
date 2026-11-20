import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./SettingsLayout";

/** Formatting keys in the message box. The draft stays plain Markdown either way. */
export function ComposerFormattingSettings() {
  const enabled = useSettings((settings) => settings.composerRichTextEnabled);
  const { updateSettings } = useUpdateSettings();
  return (
    <SettingsSection
      title="Message box"
      description="Keys for writing Markdown without typing the symbols."
    >
      <SettingsRow
        title="Formatting shortcuts"
        description="Cmd/Ctrl+B makes the selection bold, Cmd/Ctrl+I italic and Cmd/Ctrl+E inline code. Press it again on formatted text to take the formatting off."
        resetAction={
          enabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
            <SettingResetButton
              label="formatting shortcuts"
              onClick={() =>
                updateSettings({
                  composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              updateSettings({ composerRichTextEnabled: Boolean(checked) })
            }
            aria-label="Formatting shortcuts in the message box"
          />
        }
      />
    </SettingsSection>
  );
}
