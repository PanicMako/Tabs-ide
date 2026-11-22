import { useState } from "react";
import { PlusIcon, TrashIcon } from "lucide-react";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { NotchAvatar } from "../teammates/NotchAvatar";
import { normalizeTeammateName } from "../teammates/teammates.logic";
import {
  openNewTeammate,
  openTeammatesPanel,
  useTeammatesUiStore,
} from "../teammates/teammatesStore";
import { useTeammateManagement, useTeammatesData } from "../teammates/useTeammates";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

function TeammateNameRow({ id, name }: { id: string; name: string }) {
  const { update } = useTeammateManagement();
  const [value, setValue] = useState(name);
  return (
    <Input
      className="w-44"
      aria-label={`Name of ${name}`}
      maxLength={64}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const next = normalizeTeammateName(value, name);
        if (next) void update(id as never, { name: next });
        else setValue(name);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/** Manage teammates: the list, the default one, and whether the corner avatar shows. */
export default function TeammatesSettings() {
  const enabled = useSettings((settings) => settings.teammatesEnabled);
  const { updateSettings } = useUpdateSettings();
  const { teammates, pinned } = useTeammatesData();
  const { remove, confirmDialog } = useTeammateManagement();
  const cornerHidden = useTeammatesUiStore((state) => state.cornerHidden);
  const setCornerHidden = useTeammatesUiStore((state) => state.setCornerHidden);
  const setPinned = useTeammatesUiStore((state) => state.setPinnedTeammateId);

  return (
    <>
      <SettingsSection
        title="Teammates"
        description="Long-lived AI teammates with a name, a personality and a memory. They chat with you, hand code work to normal threads and suggest what to do next."
      >
        <SettingsRow
          title="Teammates"
          description="Turns the Notch feature on. Also available in Labs."
          control={
            <Switch
              aria-label="Teammates"
              checked={enabled}
              onCheckedChange={(checked) => void updateSettings({ teammatesEnabled: checked })}
            />
          }
        />
        {enabled ? (
          <>
            <SettingsRow
              title="Show the corner avatar"
              description="A small avatar you can drag anywhere in the window. Hover it for a quick ask, click it to open Teammates."
              control={
                <Switch
                  aria-label="Show the corner avatar"
                  checked={!cornerHidden}
                  onCheckedChange={(checked) => setCornerHidden(!checked)}
                />
              }
            />
            {teammates.length > 1 && pinned ? (
              <SettingsRow
                title="Teammate on the avatar"
                description="Which teammate the floating avatar shows."
                control={
                  <Select value={pinned.id} onValueChange={(value) => setPinned(String(value))}>
                    <SelectTrigger className="w-44" aria-label="Teammate on the avatar">
                      <SelectValue>{pinned.name}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {teammates.map((teammate) => (
                        <SelectItem hideIndicator key={teammate.id} value={teammate.id}>
                          {teammate.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>
      {enabled ? (
        <SettingsSection title="Your teammates" description="Rename, add or remove teammates.">
          {teammates.map((teammate) => (
            <SettingsRow
              key={teammate.id}
              title={teammate.name}
              description={teammate.paused ? "Paused" : "Active"}
              titleAccessory={<NotchAvatar className="size-5" finish={teammate.finish} />}
              control={
                <div className="flex items-center gap-2">
                  <TeammateNameRow id={teammate.id} name={teammate.name} />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Delete ${teammate.name}`}
                    onClick={() => void remove(teammate)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              }
            />
          ))}
          <SettingsRow
            title="Add a teammate"
            description="Pick a starting point, a name and a finish."
            control={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openTeammatesPanel()}>
                  Open Teammates
                </Button>
                <Button size="sm" onClick={openNewTeammate}>
                  <PlusIcon /> New teammate
                </Button>
              </div>
            }
          />
        </SettingsSection>
      ) : null}
      {confirmDialog}
    </>
  );
}
