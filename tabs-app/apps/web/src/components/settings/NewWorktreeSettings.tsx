import { useEffect, useState } from "react";
import type { BranchNamingMode } from "@tabs/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow, SettingsSection } from "./SettingsLayout";
import {
  BRANCH_NAMING_LABELS,
  SUBMODULE_LABELS,
  branchNamingFields,
  submodulesChoice,
  submodulesFromChoice,
  type SubmodulesChoice,
} from "./worktreeSettings.logic";

/** How new worktrees start and what their branches are called. */
export function NewWorktreeSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const fields = branchNamingFields(settings.branchNamingMode);
  const [prefix, setPrefix] = useState(settings.branchNamePrefix);
  const [instructions, setInstructions] = useState(settings.branchNameInstructions);
  const [directory, setDirectory] = useState(settings.worktreesDirectory);
  useEffect(() => setDirectory(settings.worktreesDirectory), [settings.worktreesDirectory]);
  useEffect(() => setPrefix(settings.branchNamePrefix), [settings.branchNamePrefix]);
  useEffect(
    () => setInstructions(settings.branchNameInstructions),
    [settings.branchNameInstructions],
  );

  return (
    <SettingsSection
      title="New worktrees"
      description="What a fresh isolated checkout starts from, and how its branch is named."
    >
      <SettingsRow
        title="Start from the latest remote"
        description="Fetch the remote first, so a new worktree begins at the newest commit instead of your last local one."
        resetAction={
          settings.newWorktreesStartFromOrigin !==
          DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
            <SettingResetButton
              label="start from remote"
              onClick={() =>
                updateSettings({
                  newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.newWorktreesStartFromOrigin}
            onCheckedChange={(checked) =>
              updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
            }
            aria-label="Start new worktrees from the latest remote"
          />
        }
      />
      <SettingsRow
        title="Where worktrees live"
        description="The folder new worktrees are created in. Each one is a full checkout, so pick a folder with room. Leave it empty to use Tabs' own folder."
        control={
          <Input
            className="w-80"
            aria-label="Worktrees folder"
            placeholder="Default location"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            onBlur={() => {
              if (directory.trim() !== settings.worktreesDirectory) {
                updateSettings({ worktreesDirectory: directory.trim() });
              }
            }}
          />
        }
      />
      <SettingsRow
        title="Submodules"
        description="Whether a new worktree also fetches the repository's submodules."
        control={
          <Select
            value={submodulesChoice(settings.worktreeSubmodules)}
            onValueChange={(value) =>
              updateSettings({
                worktreeSubmodules: submodulesFromChoice(value as SubmodulesChoice),
              })
            }
          >
            <SelectTrigger className="w-52" aria-label="Submodules">
              <SelectValue>
                {SUBMODULE_LABELS[submodulesChoice(settings.worktreeSubmodules)]}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(SUBMODULE_LABELS) as SubmodulesChoice[]).map((choice) => (
                <SelectItem hideIndicator key={choice} value={choice}>
                  {SUBMODULE_LABELS[choice]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Branch names"
        description={BRANCH_NAMING_LABELS[settings.branchNamingMode].hint}
        control={
          <Select
            value={settings.branchNamingMode}
            onValueChange={(value) =>
              updateSettings({ branchNamingMode: value as BranchNamingMode })
            }
          >
            <SelectTrigger className="w-52" aria-label="Branch naming">
              <SelectValue>{BRANCH_NAMING_LABELS[settings.branchNamingMode].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(BRANCH_NAMING_LABELS) as BranchNamingMode[]).map((mode) => (
                <SelectItem hideIndicator key={mode} value={mode}>
                  {BRANCH_NAMING_LABELS[mode].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {fields.prefix ? (
        <SettingsRow
          title="Branch prefix"
          description="Added in front of every new branch name."
          control={
            <Input
              className="w-52"
              aria-label="Branch prefix"
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              onBlur={() => {
                if (prefix.trim() !== settings.branchNamePrefix) {
                  updateSettings({ branchNamePrefix: prefix.trim() });
                }
              }}
            />
          }
        />
      ) : null}
      {fields.instructions ? (
        <SettingsRow
          title="Naming instructions"
          description="How you want branches named. The model follows this for every new worktree."
          control={
            <Textarea
              className="w-80"
              aria-label="Branch naming instructions"
              rows={3}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              onBlur={() => {
                if (instructions.trim() !== settings.branchNameInstructions) {
                  updateSettings({ branchNameInstructions: instructions.trim() });
                }
              }}
            />
          }
        />
      ) : null}
    </SettingsSection>
  );
}
