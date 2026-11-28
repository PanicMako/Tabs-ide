import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Switch } from "~/components/ui/switch";
import { useStaggerIn } from "~/components/agents/companion/designs/motion";
import { readDeviceDetail, runDeviceAction } from "~/device/deviceStore";
import {
  supportsLiquidGlass,
  supportsOrientation,
  supportsPush,
  visibleToolToggles,
} from "~/device/deviceTools";
import type { DeviceApi } from "~/device/useDeviceApi";
import type {
  DeviceActionInput,
  DeviceDetail,
  DevicePermission,
  DevicePlatform,
  DeviceTextSize,
} from "@tabs/contracts";
import "./device.css";

type DeviceActionBody = DeviceActionInput extends infer A
  ? A extends unknown
    ? Omit<A, "hostId" | "deviceId">
    : never
  : never;

const TEXT_SIZES: DeviceTextSize[] = ["small", "default", "large", "extra-large"];
const PERMISSIONS: DevicePermission[] = [
  "camera",
  "microphone",
  "photos",
  "location",
  "notifications",
];

function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: ReadonlyArray<T>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="dv-field">
      <span>{label}</span>
      <div className="dv-seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {option.replace(/[-_]/g, " ")}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dv-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

/** Tools for the open device. Every control reflects the value read back after a change. */
export function DeviceToolsDrawer({
  api,
  hostId,
  deviceId,
  platform,
  open,
  onClose,
}: {
  api: DeviceApi;
  hostId: string;
  deviceId: string;
  platform: DevicePlatform;
  open: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState("");
  const [coords, setCoords] = useState({ latitude: "", longitude: "" });
  const root = useRef<HTMLElement>(null);
  useStaggerIn(root, ".dv-section", open ? "open" : "closed", {
    y: 10,
    stagger: 0.05,
  });

  // Read when opened, so a closed drawer costs nothing.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void readDeviceDetail(api, { hostId, deviceId }).then((next) => {
      if (!cancelled && next) setDetail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open, api, hostId, deviceId]);

  const act = useCallback(
    async (action: Record<string, unknown>) => {
      setBusy(true);
      const next = await runDeviceAction(api, {
        hostId,
        deviceId,
        ...action,
      } as never);
      if (next) setDetail(next);
      setBusy(false);
    },
    [api, hostId, deviceId],
  );
  const run = (body: DeviceActionBody) => void act(body);

  const settings = detail?.settings;
  const toggles = visibleToolToggles(platform, detail);
  const lat = Number(coords.latitude);
  const lon = Number(coords.longitude);
  const coordsValid =
    coords.latitude !== "" &&
    coords.longitude !== "" &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;
  const app = detail?.foregroundApp;

  return (
    <aside
      ref={root}
      className="dv-tools"
      data-open={open}
      aria-label="Device tools"
      aria-busy={busy}
      aria-hidden={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="dv-head">
        <h3 className="dv-tools-title">Tools</h3>
        <button
          type="button"
          className="cd-icon rounded-full"
          aria-label="Close tools"
          title="Close tools"
          tabIndex={open ? 0 : -1}
          onClick={onClose}
        >
          <XIcon size={14} />
        </button>
      </div>
      <div className="dv-app">
        <span className="dv-muted">Foreground app</span>
        <strong>{app ? (app.name ?? app.id) : "Nothing reported yet"}</strong>
        {app?.version && <span className="dv-muted">Version {app.version}</span>}
      </div>
      <Section title="Display">
        {settings?.appearance && (
          <Segmented
            label="Appearance"
            value={settings.appearance}
            options={["light", "dark"] as const}
            disabled={busy}
            onChange={(value) => run({ type: "setAppearance", value })}
          />
        )}
        {settings?.textSize && (
          <Segmented
            label="Text size"
            value={settings.textSize}
            options={TEXT_SIZES}
            disabled={busy}
            onChange={(value) => run({ type: "setTextSize", value })}
          />
        )}
        {supportsLiquidGlass(detail) && (
          <Segmented
            label="Liquid Glass"
            value={settings?.liquidGlass}
            options={["clear", "tinted"] as const}
            disabled={busy}
            onChange={(value) => run({ type: "setLiquidGlass", value })}
          />
        )}
        {platform === "ios" && settings?.colorFilter !== undefined && (
          <Segmented
            label="Color filter"
            value={settings.colorFilter}
            options={["none", "grayscale", "red-green", "green-red", "blue-yellow"] as const}
            disabled={busy}
            onChange={(value) => run({ type: "setColorFilter", value })}
          />
        )}
        {supportsOrientation(platform) && (
          <Segmented
            label="Orientation"
            value={undefined}
            options={["portrait", "landscape_left", "landscape_right"] as const}
            disabled={busy}
            onChange={(value) => run({ type: "setOrientation", value })}
          />
        )}
      </Section>
      {toggles.length > 0 && (
        <Section title="Accessibility">
          {toggles.map((toggle) => (
            <label key={toggle.setting} className="dv-field">
              <span>{toggle.label}</span>
              <Switch
                checked={settings?.[toggle.setting] === true}
                disabled={busy}
                onCheckedChange={(value) =>
                  run({ type: "setToggle", setting: toggle.setting, value })
                }
              />
            </label>
          ))}
        </Section>
      )}
      <Section title="Fake location">
        <div className="dv-pair">
          <input
            aria-label="Latitude"
            placeholder="Latitude"
            inputMode="decimal"
            className="dv-input"
            value={coords.latitude}
            onChange={(e) => setCoords({ ...coords, latitude: e.target.value })}
          />
          <input
            aria-label="Longitude"
            placeholder="Longitude"
            inputMode="decimal"
            className="dv-input"
            value={coords.longitude}
            onChange={(e) => setCoords({ ...coords, longitude: e.target.value })}
          />
        </div>
        <div className="dv-actions">
          <button
            type="button"
            className="sl-primary rounded-full"
            disabled={busy || !coordsValid}
            onClick={() => run({ type: "setLocation", latitude: lat, longitude: lon })}
          >
            Set location
          </button>
          <button
            type="button"
            className="sl-secondary rounded-full"
            disabled={busy || !settings?.location}
            onClick={() => run({ type: "clearLocation" })}
          >
            Clear
          </button>
        </div>
        {settings?.location && (
          <span className="dv-muted">
            Now {settings.location.latitude}, {settings.location.longitude}
          </span>
        )}
      </Section>
      <Section title="App permissions">
        <input
          aria-label="App id"
          placeholder="App id, e.g. com.example.app"
          className="dv-input"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        />
        {PERMISSIONS.map((permission) => (
          <div key={permission} className="dv-field">
            <span className="capitalize">{permission}</span>
            <div className="dv-actions">
              <button
                type="button"
                className="sl-secondary rounded-full"
                disabled={busy || !appId.trim()}
                aria-label={`Grant ${permission}`}
                onClick={() =>
                  run({
                    type: "setPermission",
                    appId: appId.trim(),
                    permission,
                    decision: "grant",
                  })
                }
              >
                Grant
              </button>
              <button
                type="button"
                className="sl-secondary rounded-full"
                disabled={busy || !appId.trim()}
                aria-label={`Revoke ${permission}`}
                onClick={() =>
                  run({
                    type: "setPermission",
                    appId: appId.trim(),
                    permission,
                    decision: "revoke",
                  })
                }
              >
                Revoke
              </button>
            </div>
          </div>
        ))}
      </Section>
      {supportsPush(platform) && (
        <Section title="Notifications">
          <button
            type="button"
            className="sl-secondary w-fit rounded-full"
            disabled={busy || !appId.trim()}
            onClick={() =>
              run({
                type: "sendPush",
                appId: appId.trim(),
                payload: "Test notification",
              })
            }
          >
            Send a test push to the app id above
          </button>
        </Section>
      )}
    </aside>
  );
}
