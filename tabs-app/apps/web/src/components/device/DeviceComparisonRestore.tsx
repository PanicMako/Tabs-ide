import { useLayoutEffect, useRef, useState } from "react";
import type {
  DeviceComparisonReport,
  DeviceComparisonViewRef,
  EnvironmentId,
  ThreadId,
} from "@tabs/contracts";
import { openLiveComparisonTarget } from "~/device/comparisonResult";
import { showCustomConfirm } from "~/lib/customConfirm";
import { reason, type Request } from "./deviceComparisonShared";

export function LiveComparisonTargetButton({
  environmentId,
  threadId,
  reference,
  target,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  reference: DeviceComparisonViewRef;
  target: NonNullable<DeviceComparisonReport["target"]>;
}) {
  const current = useRef(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  useLayoutEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);

  const open = async () => {
    setOpening(true);
    setError(undefined);
    try {
      await openLiveComparisonTarget(
        environmentId,
        threadId,
        reference,
        target,
        () => current.current,
      );
    } catch (cause) {
      if (current.current) setError(reason(cause));
    } finally {
      if (current.current) setOpening(false);
    }
  };
  return (
    <>
      <button type="button" className="dv-link" disabled={opening} onClick={() => void open()}>
        Open live {target.name}
      </button>
      {error && (
        <p className="dv-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function RestorePausedReplayButton({
  runId,
  target,
  disabled = false,
  restore,
}: {
  runId: string;
  target: NonNullable<DeviceComparisonReport["target"]>;
  disabled?: boolean;
  restore: (
    request: Extract<Request, { action: "restoreReplay" }>,
    isCurrent: () => boolean,
  ) => Promise<unknown>;
}) {
  const current = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useLayoutEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);

  const confirm = async () => {
    const { appId, name, hostId, deviceId } = target;
    setPending(true);
    setError(undefined);
    try {
      const approved = await showCustomConfirm(
        `Restore the saved replay in ${appId} on ${name}? Tabs will check the current screen before resuming.`,
      );
      if (approved && current.current) {
        await restore(
          {
            action: "restoreReplay",
            runId,
            appId,
            device: { hostId, deviceId },
          },
          () => current.current,
        );
      }
    } catch (cause) {
      if (current.current) setError(reason(cause));
    } finally {
      if (current.current) setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="sl-primary"
        disabled={disabled || pending}
        onClick={() => void confirm()}
      >
        Restore paused replay
      </button>
      {error && (
        <p className="dv-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
