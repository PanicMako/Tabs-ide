import type { DeviceServiceState, DeviceSession, ThreadId } from "@tabs/contracts";
import { useEffect, useRef, useState } from "react";
import { environmentApi } from "~/connection/environmentApiRegistry";
import {
  addSurfaceFileToDraft,
  attachSharedDevice,
  type SurfaceLocation,
} from "~/lib/threadSurfaceAttachment";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";

export function AttachRunningDeviceDialog({
  location,
  threads,
  isCurrent,
  onClose,
}: {
  location: SurfaceLocation;
  threads: ReadonlyMap<ThreadId, string>;
  isCurrent: () => boolean;
  onClose: () => void;
}) {
  const [inventory, setInventory] = useState<DeviceServiceState>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const { environmentId } = location;

  useEffect(() => {
    let disposed = false;
    active.current = true;
    void environmentApi(environmentId)
      .then(({ device }) => {
        if (!device) throw new Error("Device control is unavailable in this environment.");
        return device.list({ inspectOnly: true });
      })
      .then((inventory) => {
        if (!disposed) setInventory(inventory);
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : "Could not list open devices.");
      });
    return () => {
      disposed = true;
      active.current = false;
    };
  }, [environmentId]);

  const options = (inventory?.sessions ?? []).flatMap((session) => {
    if (!threads.has(session.threadId)) return [];
    const device = inventory?.devices.find(
      (device) =>
        device.booted &&
        device.hostId === session.hostId &&
        device.id === session.deviceId &&
        device.platform === session.platform,
    );
    if (!device) return [];
    const hostLabel = inventory?.hosts.find(({ id }) => id === session.hostId)?.label;
    const host =
      hostLabel && hostLabel !== session.hostId
        ? `${hostLabel} (${session.hostId})`
        : session.hostId;
    const conversation =
      session.threadId === location.threadId ? "This conversation" : threads.get(session.threadId);
    return [{ session, label: device.name, host, conversation }];
  });

  const attach = async (session: DeviceSession, label: string) => {
    const canAttach = () => active.current && isCurrent();
    if (pending || !canAttach()) return;
    setPending(true);
    setError(undefined);
    try {
      const file = await attachSharedDevice(
        location,
        session.threadId,
        {
          kind: "device",
          hostId: session.hostId,
          deviceId: session.deviceId,
          platform: session.platform,
        },
        label,
        canAttach,
      );
      if (!file || !canAttach()) return;
      addSurfaceFileToDraft(location, file);
      toastManager.add({
        type: "success",
        title: "Device attached to composer",
      });
      onClose();
    } catch (cause) {
      if (canAttach())
        setError(cause instanceof Error ? cause.message : "Could not attach this device.");
    } finally {
      if (canAttach()) setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          active.current = false;
          onClose();
        }
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Attach a running device</DialogTitle>
          <DialogDescription>
            Choose the device and host to use in this conversation.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-2">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!inventory && !error && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading open devices…
            </p>
          )}
          {inventory && options.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Open a running simulator or emulator in this project first.
            </p>
          )}
          {options.map(({ session, label, host, conversation }) => (
            <Button
              key={JSON.stringify([session.threadId, session.hostId, session.deviceId])}
              type="button"
              variant="outline"
              className="h-auto min-w-0 flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
              disabled={pending}
              onClick={() => void attach(session, label)}
            >
              <span>{label}</span>
              <span className="break-all text-xs font-normal text-muted-foreground">
                {host} · {session.deviceId}
              </span>
              <span className="text-xs font-normal text-muted-foreground">{conversation}</span>
            </Button>
          ))}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
