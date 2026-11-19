import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./SettingsLayout";
import { autoSettleChoices, autoSettleLabel } from "./flowSettings.logic";

/** When threads carry on by themselves and when they tidy themselves away. */
export function ThreadFlowSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const toggle = (
    key:
      | "autoResumeLimitedThreads"
      | "snoozeLimitedThreads"
      | "continueThreadsAfterServerUpdate"
      | "sidebarAutoSettleOnMerge",
    label: string,
  ) => (
    <Switch
      checked={settings[key]}
      onCheckedChange={(checked) => updateSettings({ [key]: Boolean(checked) })}
      aria-label={label}
    />
  );
  const reset = (
    key:
      | "autoResumeLimitedThreads"
      | "snoozeLimitedThreads"
      | "continueThreadsAfterServerUpdate"
      | "sidebarAutoSettleOnMerge"
      | "sidebarAutoSettleAfterDays"
      | "followUpBehavior",
    label: string,
  ) =>
    settings[key] !== DEFAULT_UNIFIED_SETTINGS[key] ? (
      <SettingResetButton
        label={label}
        onClick={() => updateSettings({ [key]: DEFAULT_UNIFIED_SETTINGS[key] })}
      />
    ) : null;

  return (
    <SettingsSection
      title="Threads on their own"
      description="What Tabs does for you when you are not looking: carrying on after a limit, and tidying finished threads."
    >
      <SettingsRow
        title="Resume after a usage limit"
        description="When a thread stops because you hit a usage limit, carry on by itself once the limit resets."
        resetAction={reset("autoResumeLimitedThreads", "resume after a limit")}
        control={toggle("autoResumeLimitedThreads", "Resume threads after a usage limit")}
      />
      <SettingsRow
        title="Snooze until the limit resets"
        description="Move a thread that hit a limit out of your way until the limit resets, then bring it back."
        resetAction={reset("snoozeLimitedThreads", "snooze until the limit resets")}
        control={toggle("snoozeLimitedThreads", "Snooze threads until their limit resets")}
      />
      <SettingsRow
        title="Carry on after Tabs updates"
        description="After Tabs restarts to update, pick interrupted threads back up where they stopped."
        resetAction={reset("continueThreadsAfterServerUpdate", "carry on after updates")}
        control={toggle("continueThreadsAfterServerUpdate", "Continue threads after an update")}
      />
      <SettingsRow
        title="Mark done when merged"
        description="When a thread's pull request is merged, mark the thread done."
        resetAction={reset("sidebarAutoSettleOnMerge", "mark done when merged")}
        control={toggle("sidebarAutoSettleOnMerge", "Mark threads done when merged")}
      />
      <SettingsRow
        title="Mark done when quiet"
        description="Tidy away a thread that has had no activity for a while. Pinned threads stay."
        resetAction={reset("sidebarAutoSettleAfterDays", "mark done when quiet")}
        control={
          <Select
            value={String(settings.sidebarAutoSettleAfterDays)}
            onValueChange={(value) =>
              updateSettings({
                sidebarAutoSettleAfterDays: value === "null" ? null : Number(value),
              })
            }
          >
            <SelectTrigger className="w-40" aria-label="Mark threads done after inactivity">
              <SelectValue>{autoSettleLabel(settings.sidebarAutoSettleAfterDays)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {autoSettleChoices(settings.sidebarAutoSettleAfterDays).map((days) => (
                <SelectItem hideIndicator key={String(days)} value={String(days)}>
                  {autoSettleLabel(days)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Enter while the agent is working"
        description="Queue sends your message when the agent finishes. Steer folds it into the run that is going now. Cmd/Ctrl+Shift+Enter does the other one."
        resetAction={reset("followUpBehavior", "Enter while the agent is working")}
        control={
          <Select
            value={settings.followUpBehavior}
            onValueChange={(value) =>
              updateSettings({ followUpBehavior: value === "steer" ? "steer" : "queue" })
            }
          >
            <SelectTrigger className="w-40" aria-label="Enter while the agent is working">
              <SelectValue>{settings.followUpBehavior === "steer" ? "Steer" : "Queue"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="queue">
                Queue
              </SelectItem>
              <SelectItem hideIndicator value="steer">
                Steer
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
