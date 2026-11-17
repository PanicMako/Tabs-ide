import { useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
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

const TEXT_SIZES: DeviceTextSize[] = ["small", "default", "large", "extra-large"];
const PERMISSIONS: DevicePermission[] = [
  "camera",
  "microphone",
  "photos",
  "location",
  "notifications",
];

type ActionBody<T extends DeviceActionInput["type"]> = Omit<
  Extract<DeviceActionInput, { type: T }>,
  "hostId" | "deviceId"
>;

/** Tools for the open device. Every control reflects the value read back after a change. */
export function DeviceToolsDrawer({
  api,
  hostId,
  deviceId,
  platform,
}: {
  api: DeviceApi;
  hostId: string;
  deviceId: string;
  platform: DevicePlatform;
}) {
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState("");
  const [coords, setCoords] = useState({ latitude: "", longitude: "" });

  useEffect(() => {
    let cancelled = false;
    void readDeviceDetail(api, { hostId, deviceId }).then((next) => {
      if (!cancelled && next) setDetail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [api, hostId, deviceId]);

  const act = useCallback(
    async (action: Record<string, unknown>) => {
      setBusy(true);
      const next = await runDeviceAction(api, { hostId, deviceId, ...action } as never);
      if (next) setDetail(next);
      setBusy(false);
    },
    [api, hostId, deviceId],
  );
  const run = <T extends DeviceActionInput["type"]>(body: ActionBody<T> & { type: T }) =>
    void act(body);

  const settings = detail?.settings;
  const toggles = visibleToolToggles(platform, detail);
  const lat = Number(coords.latitude);
  const lon = Number(coords.longitude);
  const coordsValid =
    coords.latitude !== "" &&
    coords.longitude !== "" &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;

  return (
    <aside className="device-tools" aria-label="Device tools" aria-busy={busy}>
      <h3 className="device-title">Tools</h3>
      <p className="device-muted">
        Foreground app:{" "}
        {detail?.foregroundApp ? (detail.foregroundApp.name ?? detail.foregroundApp.id) : "unknown"}
      </p>
      {settings?.appearance && (
        <div className="device-row">
          <span>Appearance</span>
          {(["light", "dark"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={settings.appearance === value ? "default" : "outline"}
              disabled={busy}
              onClick={() => run({ type: "setAppearance", value })}
            >
              {value}
            </Button>
          ))}
        </div>
      )}
      {settings?.textSize && (
        <div className="device-row">
          <span>Text size</span>
          {TEXT_SIZES.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={settings.textSize === value ? "default" : "outline"}
              disabled={busy}
              onClick={() => run({ type: "setTextSize", value })}
            >
              {value}
            </Button>
          ))}
        </div>
      )}
      {toggles.map((toggle) => (
        <label key={toggle.setting} className="device-row">
          <Switch
            checked={settings?.[toggle.setting] === true}
            disabled={busy}
            onCheckedChange={(value) => run({ type: "setToggle", setting: toggle.setting, value })}
          />
          <span>{toggle.label}</span>
        </label>
      ))}
      {supportsLiquidGlass(detail) && (
        <div className="device-row">
          <span>Liquid Glass</span>
          {(["clear", "tinted"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={settings?.liquidGlass === value ? "default" : "outline"}
              disabled={busy}
              onClick={() => run({ type: "setLiquidGlass", value })}
            >
              {value}
            </Button>
          ))}
        </div>
      )}
      {platform === "ios" && settings?.colorFilter !== undefined && (
        <div className="device-row">
          <span>Color filter</span>
          {(["none", "grayscale", "red-green", "green-red", "blue-yellow"] as const).map(
            (value) => (
              <Button
                key={value}
                size="sm"
                variant={settings.colorFilter === value ? "default" : "outline"}
                disabled={busy}
                onClick={() => run({ type: "setColorFilter", value })}
              >
                {value}
              </Button>
            ),
          )}
        </div>
      )}
      {supportsOrientation(platform) && (
        <div className="device-row">
          <span>Orientation</span>
          {(["portrait", "landscape_left", "landscape_right"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run({ type: "setOrientation", value })}
            >
              {value.replace("_", " ")}
            </Button>
          ))}
        </div>
      )}
      <fieldset className="device-fieldset">
        <legend>Fake location</legend>
        <div className="device-row">
          <input
            aria-label="Latitude"
            inputMode="decimal"
            className="device-input"
            value={coords.latitude}
            onChange={(e) => setCoords({ ...coords, latitude: e.target.value })}
          />
          <input
            aria-label="Longitude"
            inputMode="decimal"
            className="device-input"
            value={coords.longitude}
            onChange={(e) => setCoords({ ...coords, longitude: e.target.value })}
          />
          <Button
            size="sm"
            disabled={busy || !coordsValid}
            onClick={() => run({ type: "setLocation", latitude: lat, longitude: lon })}
          >
            Set
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !settings?.location}
            onClick={() => run({ type: "clearLocation" })}
          >
            Clear
          </Button>
        </div>
        {settings?.location && (
          <p className="device-muted">
            Now {settings.location.latitude}, {settings.location.longitude}
          </p>
        )}
      </fieldset>
      <fieldset className="device-fieldset">
        <legend>App permissions</legend>
        <input
          aria-label="App id"
          placeholder="com.example.app"
          className="device-input"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        />
        {PERMISSIONS.map((permission) => (
          <div key={permission} className="device-row">
            <span>{permission}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !appId.trim()}
              onClick={() =>
                run({ type: "setPermission", appId: appId.trim(), permission, decision: "grant" })
              }
            >
              Grant
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !appId.trim()}
              onClick={() =>
                run({ type: "setPermission", appId: appId.trim(), permission, decision: "revoke" })
              }
            >
              Revoke
            </Button>
          </div>
        ))}
      </fieldset>
      {supportsPush(platform) && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !appId.trim()}
          onClick={() =>
            run({ type: "sendPush", appId: appId.trim(), payload: "Test notification" })
          }
        >
          Send test push to app
        </Button>
      )}
    </aside>
  );
}
