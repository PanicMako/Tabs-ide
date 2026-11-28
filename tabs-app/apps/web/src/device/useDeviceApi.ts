import type { NativeApi } from "@tabs/contracts";
import { useEffect, useState } from "react";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { inspectDevices, startDeviceStateSubscription } from "./deviceStore";

export type DeviceApi = NativeApi["device"];

/**
 * Resolves the environment's device API and follows its state. Mounting only inspects
 * inventory; nothing is installed or started until the user acts.
 */
export function useDeviceApi(environmentId: string | null | undefined): DeviceApi | null {
  const [connection, setConnection] = useState<{ environmentId: string | null; api: DeviceApi }>();
  const id = environmentId ?? null;
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void environmentApi(id).then((native) => {
      if (cancelled || !native.device) return;
      setConnection({ environmentId: id, api: native.device });
      stop = startDeviceStateSubscription(native.device);
      void inspectDevices(native.device);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [id]);
  return connection?.environmentId === id ? connection.api : null;
}
