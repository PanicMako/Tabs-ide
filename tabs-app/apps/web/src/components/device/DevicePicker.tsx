import { RefreshCwIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { groupDevicesByHost, isDeviceBooting } from "~/device/deviceLogic";
import { refreshDevices, useDeviceStore } from "~/device/deviceStore";
import type { DeviceApi } from "~/device/useDeviceApi";
import type { DeviceSummary } from "@tabs/contracts";

/** Running devices first, Start beside stopped ones, grouped by host when there are several. */
export function DevicePicker({
  api,
  onChoose,
}: {
  api: DeviceApi;
  onChoose: (device: DeviceSummary) => void;
}) {
  const state = useDeviceStore((s) => s.state);
  const refreshing = useDeviceStore((s) => s.refreshing);
  const error = useDeviceStore((s) => s.error);
  const groups = groupDevicesByHost(state);
  const showHosts = (state?.hosts.length ?? 0) > 1;
  return (
    <div className="device-picker" role="region" aria-label="Choose a device">
      <div className="device-picker-head">
        <h2 className="device-title">Devices</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh devices"
          disabled={refreshing}
          onClick={() => void refreshDevices(api)}
        >
          <RefreshCwIcon size={14} />
        </Button>
      </div>
      {state?.hostStatus === "installing" && (
        <p className="device-muted">Installing device tools. This can take a minute.</p>
      )}
      {groups.length === 0 && (
        <p className="device-muted">
          {refreshing
            ? "Looking for devices…"
            : "No simulators or emulators found. Create one in Xcode or Android Studio, then refresh."}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.hostId} aria-label={group.label}>
          {showHosts && <h3 className="device-host">{group.label}</h3>}
          <ul className="device-list">
            {group.devices.map((device) => {
              const booting = isDeviceBooting(state, device);
              return (
                <li key={`${device.hostId}:${device.id}`} className="device-list-row">
                  <div className="device-list-name">
                    <span>{device.name}</span>
                    <span className="device-muted">
                      {device.platform === "ios" ? "iOS" : "Android"} · {device.version}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={device.booted ? "default" : "outline"}
                    disabled={booting}
                    onClick={() => onChoose(device)}
                  >
                    {booting ? "Starting…" : device.booted ? "Open" : "Start"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {error && (
        <p role="alert" className="device-error">
          {error}
        </p>
      )}
    </div>
  );
}
