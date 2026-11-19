import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./SettingsLayout";

const SOUND_LABELS = { "soft-pop": "Soft pop", "camera-shutter": "Camera shutter" } as const;

/** What happens when you take a screenshot straight into a thread. */
export function SnapShotSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const resetFor = (key: "snapShotFlash" | "snapShotPlaySound", label: string) =>
    settings[key] !== DEFAULT_UNIFIED_SETTINGS[key] ? (
      <SettingResetButton
        label={label}
        onClick={() => updateSettings({ [key]: DEFAULT_UNIFIED_SETTINGS[key] })}
      />
    ) : null;
  return (
    <SettingsSection
      title="Screenshots into a thread"
      description="Press Cmd/Ctrl+Alt+Shift+S in a thread, or use “Capture screen to composer” in the command palette, to attach what is on your screen."
    >
      <SettingsRow
        title="Flash on capture"
        description="Briefly flash the screen so you know it worked. Skipped when your system asks for reduced motion."
        resetAction={resetFor("snapShotFlash", "flash on capture")}
        control={
          <Switch
            checked={settings.snapShotFlash}
            onCheckedChange={(checked) => updateSettings({ snapShotFlash: Boolean(checked) })}
            aria-label="Flash the screen when a screenshot is taken"
          />
        }
      />
      <SettingsRow
        title="Play a sound"
        description="A short sound when a screenshot is taken."
        resetAction={resetFor("snapShotPlaySound", "play a sound")}
        control={
          <Switch
            checked={settings.snapShotPlaySound}
            onCheckedChange={(checked) => updateSettings({ snapShotPlaySound: Boolean(checked) })}
            aria-label="Play a sound when a screenshot is taken"
          />
        }
      />
      {settings.snapShotPlaySound ? (
        <SettingsRow
          title="Sound"
          description="Which sound to play."
          control={
            <Select
              value={settings.snapShotSound}
              onValueChange={(value) =>
                updateSettings({ snapShotSound: value as keyof typeof SOUND_LABELS })
              }
            >
              <SelectTrigger className="w-44" aria-label="Screenshot sound">
                <SelectValue>{SOUND_LABELS[settings.snapShotSound]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {(Object.keys(SOUND_LABELS) as Array<keyof typeof SOUND_LABELS>).map((key) => (
                  <SelectItem hideIndicator key={key} value={key}>
                    {SOUND_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
    </SettingsSection>
  );
}
