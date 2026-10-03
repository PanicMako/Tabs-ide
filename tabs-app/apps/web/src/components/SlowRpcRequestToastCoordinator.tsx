import { useEffect, useRef } from "react";

import { useSlowRpcRequests } from "../rpc/requestLatencyState";
import { toastManager } from "./ui/toast";

export function SlowRpcRequestToastCoordinator() {
  const requests = useSlowRpcRequests();
  const toastId = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const suppressedUntilClear = useRef(false);

  useEffect(() => {
    if (requests.length === 0) {
      if (toastId.current !== null) toastManager.close(toastId.current);
      toastId.current = null;
      suppressedUntilClear.current = false;
      return;
    }
    if (suppressedUntilClear.current) return;

    const thresholdSeconds = Math.round(
      Math.min(...requests.map((request) => request.thresholdMs)) / 1_000,
    );
    const nextToast = {
      type: "warning" as const,
      title: "Some requests are slow",
      description: `${requests.length} request${requests.length === 1 ? "" : "s"} waiting longer than ${thresholdSeconds}s: ${requests.map((request) => request.method).join(", ")}`,
      timeout: 0,
      data: {
        onClose: () => {
          suppressedUntilClear.current = true;
          toastId.current = null;
        },
      },
    };
    if (toastId.current === null) toastId.current = toastManager.add(nextToast);
    else toastManager.update(toastId.current, nextToast);
  }, [requests]);

  useEffect(
    () => () => {
      if (toastId.current !== null) toastManager.close(toastId.current);
    },
    [],
  );

  return null;
}
