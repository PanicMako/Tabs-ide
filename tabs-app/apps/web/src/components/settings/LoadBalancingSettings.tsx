import { useEffect, useMemo, useState } from "react";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import {
  connectedEnvironmentIds,
  environmentConfig,
  onEnvironmentApiRegistryEvent,
} from "~/connection/environmentApiRegistry";
import { weightFor } from "~/lib/loadBalancing";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

/** Spread new conversations across the machines you have connected. */
export function LoadBalancingSettings() {
  const enabled = useSettings((settings) => settings.loadBalancingEnabled);
  const weights = useSettings((settings) => settings.loadBalancingWeights) as Record<
    string,
    number
  >;
  const { updateSettings } = useUpdateSettings();
  const [revision, setRevision] = useState(0);
  useEffect(() => onEnvironmentApiRegistryEvent(() => setRevision((value) => value + 1)), []);
  const machines = useMemo(
    () =>
      connectedEnvironmentIds().map((id) => ({
        id,
        label: environmentConfig(id)?.environment.label ?? id,
      })),
    // The registry changes without a prop changing, so `revision` stands in for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision],
  );
  if (machines.length < 2) return null;

  return (
    <SettingsSection
      title="Spread new conversations"
      description="When a new conversation starts on a project that exists on more than one machine, pick the machine for you in proportion to these weights. You can still choose a machine yourself in the composer."
    >
      <SettingsRow
        title="Choose the machine for me"
        description="Only new conversations with no attachments, branch or worktree chosen yet."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              updateSettings({ loadBalancingEnabled: Boolean(checked) })
            }
            aria-label="Choose the machine for new conversations"
          />
        }
      />
      {enabled
        ? machines.map((machine) => (
            <SettingsRow
              key={machine.id}
              title={machine.label}
              description="0 keeps this machine out of the rotation, 100 is the most."
              control={
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-20"
                  aria-label={`Weight for ${machine.label}`}
                  value={weightFor(weights, machine.id)}
                  onChange={(event) => {
                    const next = Math.min(100, Math.max(0, Math.round(Number(event.target.value))));
                    if (Number.isFinite(next))
                      void updateSettings({
                        loadBalancingWeights: { ...weights, [machine.id]: next },
                      });
                  }}
                />
              }
            />
          ))
        : null}
    </SettingsSection>
  );
}
