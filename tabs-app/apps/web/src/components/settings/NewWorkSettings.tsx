import { useEffect, useState } from "react";
import type { RuntimeMode } from "@tabs/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./SettingsLayout";

/** What a new thread may do before it asks you, and where adding a project starts looking. */
export function NewWorkSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const [folder, setFolder] = useState(settings.addProjectBaseDirectory);
  useEffect(() => setFolder(settings.addProjectBaseDirectory), [settings.addProjectBaseDirectory]);

  return (
    <SettingsSection
      title="Starting new work"
      description="Defaults for the threads and projects you start. You can still change a thread's access from its composer."
    >
      <SettingsRow
        title="New threads can"
        description={runtimeModeConfig[settings.defaultRuntimeMode].description}
        resetAction={
          settings.defaultRuntimeMode !== DEFAULT_UNIFIED_SETTINGS.defaultRuntimeMode ? (
            <SettingResetButton
              label="default access"
              onClick={() =>
                updateSettings({ defaultRuntimeMode: DEFAULT_UNIFIED_SETTINGS.defaultRuntimeMode })
              }
            />
          ) : null
        }
        control={
          <Select
            value={settings.defaultRuntimeMode}
            onValueChange={(value) => updateSettings({ defaultRuntimeMode: value as RuntimeMode })}
          >
            <SelectTrigger className="w-52" aria-label="Default access for new threads">
              <SelectValue>{runtimeModeConfig[settings.defaultRuntimeMode].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {runtimeModeOptions.map((mode) => (
                <SelectItem hideIndicator key={mode} value={mode}>
                  {runtimeModeConfig[mode].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Add projects from"
        description="The folder the project picker opens in. Leave it empty to start wherever your system does."
        control={
          <Input
            className="w-80"
            aria-label="Folder the project picker opens in"
            placeholder="Default location"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            onBlur={() => {
              if (folder.trim() !== settings.addProjectBaseDirectory) {
                updateSettings({ addProjectBaseDirectory: folder.trim() });
              }
            }}
          />
        }
      />
    </SettingsSection>
  );
}
