import { RefreshCwIcon } from "lucide-react";
import { useRef } from "react";
import { useStaggerIn } from "~/components/agents/companion/designs/motion";
import { groupDevicesByHost, isDeviceBooting } from "~/device/deviceLogic";
import { refreshDevices, useDeviceStore } from "~/device/deviceStore";
import type { DeviceApi } from "~/device/useDeviceApi";
import type { DeviceSummary } from "@tabs/contracts";
import "./device.css";

/** Ledger of devices: running first with Open, stopped ones with Start, grouped by host. */
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
  const root = useRef<HTMLDivElement>(null);
  const groups = groupDevicesByHost(state);
  const count = groups.reduce((total, group) => total + group.devices.length, 0);
  useStaggerIn(root, ".dv-row", String(count), { y: 12, stagger: 0.04 });
  return (
    <div className="dv-page" role="region" aria-label="Choose a device" ref={root}>
      <div className="dv-head">
        <div>
          <h2 className="dv-title">Pick a device</h2>
          <p className="dv-lede">
            {state?.hostStatus === "installing"
              ? "Installing device tools. This takes a minute."
              : "Open a running one, or start one. It keeps running if you close this tab."}
          </p>
        </div>
        <button
          type="button"
          className="cd-icon rounded-full"
          aria-label="Refresh devices"
          title="Refresh devices"
          disabled={refreshing}
          onClick={() => void refreshDevices(api)}
        >
          <RefreshCwIcon size={14} />
        </button>
      </div>
      {count === 0 ? (
        <div className="dv-ledger dv-empty">
          <strong>{refreshing ? "Looking for devices…" : "No simulators or emulators yet"}</strong>
          <span className="dv-muted">
            Create one in Xcode (Window → Devices and Simulators) or Android Studio (Device
            Manager), then refresh.
          </span>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.hostId} className="dv-ledger" aria-label={group.label}>
            <div className="dv-ledger-head">
              <span>{group.label}</span>
              <span>{group.devices.length}</span>
            </div>
            {group.devices.map((device) => {
              const booting = isDeviceBooting(state, device);
              return (
                <div key={`${device.hostId}:${device.id}`} className="dv-row">
                  <span className="dv-index">{device.platform === "ios" ? "iOS" : "And"}</span>
                  <div className="dv-row-main">
                    <span className="dv-name">{device.name}</span>
                    <span className="dv-state" data-running={device.booted}>
                      {booting ? "Starting" : device.booted ? "Running" : "Stopped"} ·{" "}
                      {device.version}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={
                      device.booted ? "sl-primary rounded-full" : "sl-secondary rounded-full"
                    }
                    disabled={booting}
                    aria-label={`${device.booted ? "Open" : "Start"} ${device.name}`}
                    onClick={() => onChoose(device)}
                  >
                    {booting ? "Starting…" : device.booted ? "Open" : "Start"}
                  </button>
                </div>
              );
            })}
          </section>
        ))
      )}
      {error && (
        <p role="alert" className="dv-error">
          {error}
        </p>
      )}
    </div>
  );
}
