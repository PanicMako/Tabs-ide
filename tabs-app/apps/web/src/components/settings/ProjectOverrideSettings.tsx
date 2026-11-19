import type { ProjectId } from "@tabs/contracts";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./SettingsLayout";
import {
  OVERRIDE_CHOICES,
  overrideChoiceLabel,
  overrideChoiceOf,
  overridePatchValue,
  type OverrideChoice,
} from "./projectOverrides.logic";

function OverrideSelect({
  label,
  choice,
  globalValue,
  onChange,
}: {
  label: string;
  choice: OverrideChoice;
  globalValue: boolean;
  onChange: (choice: OverrideChoice) => void;
}) {
  return (
    <Select value={choice} onValueChange={(value) => onChange(value as OverrideChoice)}>
      <SelectTrigger className="w-60" aria-label={label}>
        <SelectValue>{overrideChoiceLabel(choice, globalValue)}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {OVERRIDE_CHOICES.map((option) => (
          <SelectItem hideIndicator key={option} value={option}>
            {overrideChoiceLabel(option, globalValue)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** Settings that follow the global choice unless this project says otherwise. */
export function ProjectOverrideSettings({ projectId }: { projectId: ProjectId }) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  return (
    <SettingsSection
      title="This project"
      description="Choose a different answer for this project only. Everything else follows the global setting."
    >
      <SettingsRow
        title="Pull automatically"
        description="Bring in new commits from the remote for this project's branches."
        control={
          <OverrideSelect
            label="Pull automatically in this project"
            choice={overrideChoiceOf(settings.projectAutoPullOverrides[projectId])}
            globalValue={settings.defaultAutoPull}
            onChange={(choice) =>
              updateSettings({
                projectAutoPullOverrides: { [projectId]: overridePatchValue(choice) },
              })
            }
          />
        }
      />
      <SettingsRow
        title="Let agents use the browser"
        description="Allow or block agents from using a Tabs browser tab in this project."
        control={
          <OverrideSelect
            label="Agent browser access in this project"
            choice={overrideChoiceOf(settings.projectAgentBrowserAccessOverrides[projectId])}
            globalValue={settings.enableAgentBrowserAccess}
            onChange={(choice) =>
              updateSettings({
                projectAgentBrowserAccessOverrides: { [projectId]: overridePatchValue(choice) },
              })
            }
          />
        }
      />
    </SettingsSection>
  );
}
