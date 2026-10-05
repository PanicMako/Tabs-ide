import { useState } from "react";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../state/settings";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

export function UsageAnalyticsSettings() {
  const enabled = useSettings((settings) => settings.enableUsageAnalytics);
  const serverConfig = useServerConfig();
  const { updateSettings } = useUpdateSettings();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function changeEnabled(checked: boolean) {
    setSaving(true);
    setStatus("Saving analytics preference...");
    try {
      const saved = await updateSettings({ enableUsageAnalytics: checked });
      setStatus(saved ? "Analytics preference saved." : "Could not save analytics preference.");
    } catch {
      setStatus("Could not save analytics preference.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title="Privacy"
      description={
        <span id="usage-analytics-description">
          Help measure how many installations open Tabs and interact with the app each day. Uses a
          random installation ID, OS, architecture, app version, and app type. No names, provider
          logins, models, reasoning settings, prompts, code, or replay recordings. Changes apply
          without restarting. This controls Tabs analytics for this workspace server.
        </span>
      }
    >
      <SettingsRow
        title="Share basic usage analytics"
        description="Enabled by default. You can turn this off at any time."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={changeEnabled}
            disabled={saving || !serverConfig}
            aria-label="Share basic usage analytics"
            aria-describedby="usage-analytics-description"
            aria-busy={saving}
          />
        }
      />
      <p className="text-xs text-muted-foreground" role="status">
        {status}
      </p>
    </SettingsSection>
  );
}
