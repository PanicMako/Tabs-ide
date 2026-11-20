import { useState } from "react";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import { SshHostsEditor } from "./SshHostsEditor";
import { configureDevices, inspectDevices, useDeviceStore } from "~/device/deviceStore";
import { deviceToolUpdatePolicy, deviceToolVersionLabels } from "~/device/deviceToolVersions";
import { useDeviceApi } from "~/device/useDeviceApi";
import type { SshDeviceHostConfig } from "@tabs/contracts";

export default function DeviceSettings() {
  const api = useDeviceApi(null);
  const state = useDeviceStore((s) => s.state);
  const error = useDeviceStore((s) => s.error);
  const enabled = !!state && state.hostStatus !== "disabled";
  const [checked, setChecked] = useState<Record<string, string | null>>({});

  const testConfigured = async (host: SshDeviceHostConfig) => {
    if (!api) return;
    setChecked((value) => ({ ...value, [host.id]: "Checking…" }));
    try {
      const config = host;
      const result = await api.testHost(config);
      const ready = result.platforms.filter((p) => p.available).length;
      setChecked((value) => ({
        ...value,
        [host.id]: `Connected. ${ready} platform(s) available.`,
      }));
    } catch (cause) {
      setChecked((value) => ({
        ...value,
        [host.id]: cause instanceof Error ? cause.message : "Connection failed.",
      }));
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Devices"
        description="Watch simulators and emulators next to a thread, on this machine or over SSH."
      />
      <SettingsSection
        title="Access"
        description="Watch simulators and emulators next to a thread."
      >
        <SettingsRow
          title="Use devices"
          description="Starts the device helper processes. Turn off to stop them; simulators and emulators keep running until powered off."
          control={
            <Switch
              checked={enabled}
              disabled={!api}
              aria-label="Use devices"
              onCheckedChange={(value) => api && void configureDevices(api, { enabled: value })}
            />
          }
        />
        <SettingsRow
          title="Agents can use devices"
          description="Lets agents started from now on drive devices through the device tools and agent-device CLI. Restart an existing agent session after turning this on. Your own Device panel is unaffected."
          control={
            <Switch
              checked={!!state?.agentAccessEnabled}
              disabled={!api || !enabled}
              aria-label="Agents can use devices"
              onCheckedChange={(value) =>
                api && void configureDevices(api, { agentAccessEnabled: value })
              }
            />
          }
        />
      </SettingsSection>
      <SettingsSection
        title="Device sources"
        description="This machine, plus any machine over SSH. SSH hosts need macOS or Linux and Node 22.12 or newer."
      >
        {(state?.hosts ?? [])
          .filter((host) => host.kind === "local")
          .map((host) => (
            <SettingsRow
              key={host.id}
              title={host.label}
              description={
                host.kind === "local"
                  ? `Devices on the machine running the environment server. ${host.platforms
                      .map(
                        (p) =>
                          `${p.platform === "ios" ? "iOS" : "Android"}: ${p.available ? "ready" : "not available"}`,
                      )
                      .join(" · ")}.`
                  : `Machine over SSH. ${checked[host.id] ?? "Not tested yet."}`
              }
            />
          ))}
        <SshHostsEditor onTest={(config) => void testConfigured(config)} status={checked} />
      </SettingsSection>
      <SettingsSection
        title="Tool versions"
        description={deviceToolUpdatePolicy(state?.hosts[0]?.tools)}
      >
        {(state?.hosts ?? []).map((host) => (
          <SettingsRow
            key={host.id}
            title={host.label}
            description={host.toolInspectionError ?? deviceToolVersionLabels(host.tools).join(" ")}
          />
        ))}
        <SettingsRow
          title="Check versions"
          description="Reads installed tool versions without installing or starting anything."
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!api}
              onClick={() => api && void inspectDevices(api)}
            >
              Check versions
            </Button>
          }
        />
      </SettingsSection>
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-card px-4 py-3 text-xs leading-relaxed text-destructive-foreground sm:px-5"
        >
          {error}
        </p>
      )}
    </div>
  );
}
