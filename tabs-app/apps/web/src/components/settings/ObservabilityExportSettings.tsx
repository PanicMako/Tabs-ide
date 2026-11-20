import { useState } from "react";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { DebouncedSettingsInput } from "./DebouncedSettingsInput";
import { SettingsRow, SettingsSection } from "./SettingsLayout";
import { OTLP_SIGNALS, otlpUrlProblem } from "./observabilityExport.logic";

/**
 * Where the server sends its traces, metrics and logs. The server reads these
 * when it starts, and an address set in its environment wins, so a change here
 * applies after a restart.
 */
export function ObservabilityExportSettings() {
  const saved = useSettings((settings) => settings.observability);
  const { updateSettings } = useUpdateSettings();
  const [problems, setProblems] = useState<Record<string, string | null>>({});

  return (
    <SettingsSection
      title="Export to a collector"
      description="Send what Tabs records to an OpenTelemetry collector over HTTP. Leave a field empty to keep that signal local. Restart Tabs after changing an address."
    >
      {OTLP_SIGNALS.map((entry) => (
        <SettingsRow
          key={entry.key}
          title={entry.title}
          description={problems[entry.key] ?? ""}
          control={
            <DebouncedSettingsInput
              className="w-72"
              aria-label={`${entry.title} endpoint`}
              placeholder={entry.placeholder}
              value={saved?.[entry.key] ?? ""}
              onPersist={(value) => {
                const problem = otlpUrlProblem(value);
                setProblems((current) => ({ ...current, [entry.key]: problem }));
                if (problem) return Promise.resolve(false);
                return updateSettings({ observability: { [entry.key]: value.trim() } });
              }}
            />
          }
        />
      ))}
    </SettingsSection>
  );
}
