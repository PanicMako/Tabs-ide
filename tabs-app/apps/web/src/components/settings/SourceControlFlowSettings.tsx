import { Duration } from "effect";
import type { PullRequestMergeMethod } from "@tabs/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./SettingsLayout";
import {
  MERGE_METHOD_LABELS,
  fetchIntervalChoices,
  fetchIntervalLabel,
  mergeMethodChoice,
  mergeMethodFromChoice,
  type MergeMethodChoice,
} from "./flowSettings.logic";

/** How Tabs keeps branches current and how it merges pull requests. */
export function SourceControlFlowSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const intervalMs = Duration.toMillis(settings.automaticGitFetchInterval);

  return (
    <SettingsSection
      title="Keeping branches current"
      description="How often Tabs checks for new commits, and how it merges your pull requests."
    >
      <SettingsRow
        title="Pull automatically"
        description="When a branch has new commits on the remote and nothing local in the way, bring them in for you."
        resetAction={
          settings.defaultAutoPull !== DEFAULT_UNIFIED_SETTINGS.defaultAutoPull ? (
            <SettingResetButton
              label="pull automatically"
              onClick={() =>
                updateSettings({ defaultAutoPull: DEFAULT_UNIFIED_SETTINGS.defaultAutoPull })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.defaultAutoPull}
            onCheckedChange={(checked) => updateSettings({ defaultAutoPull: Boolean(checked) })}
            aria-label="Pull automatically"
          />
        }
      />
      <SettingsRow
        title="Check for new commits"
        description="How often Tabs fetches from the remote in the background."
        control={
          <Select
            value={String(intervalMs)}
            onValueChange={(value) =>
              updateSettings({ automaticGitFetchInterval: Duration.millis(Number(value)) })
            }
          >
            <SelectTrigger className="w-44" aria-label="Fetch interval">
              <SelectValue>{fetchIntervalLabel(intervalMs)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {fetchIntervalChoices(intervalMs).map((ms) => (
                <SelectItem hideIndicator key={ms} value={String(ms)}>
                  {fetchIntervalLabel(ms)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Merge pull requests with"
        description="The method used when you merge from Tabs. Choose Ask each time to pick on every merge."
        control={
          <Select
            value={mergeMethodChoice(settings.pullRequestMergeMethod)}
            onValueChange={(value) =>
              updateSettings({
                pullRequestMergeMethod: mergeMethodFromChoice(value as MergeMethodChoice),
              })
            }
          >
            <SelectTrigger className="w-44" aria-label="Merge method">
              <SelectValue>
                {MERGE_METHOD_LABELS[mergeMethodChoice(settings.pullRequestMergeMethod)]}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(MERGE_METHOD_LABELS) as MergeMethodChoice[]).map((choice) => (
                <SelectItem hideIndicator key={choice} value={choice}>
                  {MERGE_METHOD_LABELS[choice]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Leave out agent credits"
        description="Remove the agent's co-author line from the commit message when a pull request is merged."
        resetAction={
          settings.removeAgentCreditsOnMerge !==
          DEFAULT_UNIFIED_SETTINGS.removeAgentCreditsOnMerge ? (
            <SettingResetButton
              label="agent credits"
              onClick={() =>
                updateSettings({
                  removeAgentCreditsOnMerge: DEFAULT_UNIFIED_SETTINGS.removeAgentCreditsOnMerge,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.removeAgentCreditsOnMerge}
            onCheckedChange={(checked) =>
              updateSettings({ removeAgentCreditsOnMerge: Boolean(checked) })
            }
            aria-label="Remove agent credits when merging"
          />
        }
      />
    </SettingsSection>
  );
}
