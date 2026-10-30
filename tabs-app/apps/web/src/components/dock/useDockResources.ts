import { useEffect, useRef, useState } from "react";
import type {
  EnvironmentApi,
  NativeApi,
  HostResourcesSnapshot,
  ResourceTelemetrySnapshot,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import { aggregateDockResources, appendDockSample, type DockResourceSample } from "./dockResources";

export type DockTelemetryApi = Pick<EnvironmentApi, "terminal"> &
  Partial<Pick<NativeApi, "server">>;
interface Resources {
  samples: Record<string, DockResourceSample>;
  history: Record<string, DockResourceSample[]>;
  state: "connecting" | "live" | "unavailable";
}
const EMPTY: Resources = { samples: {}, history: {}, state: "connecting" };

export function useDockResources(
  api: DockTelemetryApi | null,
  threadId: string | null,
  roots: Readonly<Record<string, number | null>>,
) {
  const [resources, setResources] = useState<Resources>(EMPTY);
  const rootKey = JSON.stringify(Object.entries(roots).sort(([a], [b]) => a.localeCompare(b)));
  const rootsRef = useRef(roots);
  useEffect(() => {
    rootsRef.current = roots;
  }, [rootKey]);
  const enabled = Object.values(roots).some((pid) => pid !== null);
  useEffect(() => {
    setResources(EMPTY);
    const server = api?.server;
    if (!enabled) return;
    if (!server) {
      setResources({ ...EMPTY, state: "unavailable" });
      return;
    }
    let alive = true;
    let host: HostResourcesSnapshot | null = null;
    let latest: ResourceTelemetrySnapshot | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const unavailable = () => {
      if (alive) setResources((previous) => ({ ...previous, samples: {}, state: "unavailable" }));
    };
    const accept = (snapshot: ResourceTelemetrySnapshot) => {
      if (!alive) return;
      latest = snapshot;
      const sampledAt = DateTime.toEpochMillis(snapshot.readAt);
      const maxAge = Math.max(10_000, snapshot.sampleIntervalMs * 3);
      clearTimeout(watchdog);
      if (snapshot.health.native.status !== "healthy" || Date.now() - sampledAt > maxAge) {
        unavailable();
        return;
      }
      watchdog = setTimeout(unavailable, maxAge);
      setResources((previous) => {
        const samples: Resources["samples"] = {};
        const history: Resources["history"] = {};
        for (const [id, pid] of Object.entries(rootsRef.current)) {
          const sample =
            pid === null ? null : aggregateDockResources(snapshot.processes, pid, host, sampledAt);
          if (!sample) {
            if (pid !== null)
              history[id] = (previous.history[id] ?? []).filter(
                (point) => point.sampledAt >= sampledAt - 60_000,
              );
            continue;
          }
          samples[id] = sample;
          history[id] = appendDockSample(previous.history[id] ?? [], sample);
        }
        return { samples, history, state: "live" };
      });
    };
    // Capacity belongs to the execution host, which may be a remote machine.
    void server
      .getHostResources?.()
      .then((value) => {
        if (!alive) return;
        host = value;
        if (latest) accept(latest);
      })
      .catch(() => {
        /* Bytes remain available when host capacity cannot be read. */
      });
    if (server.onResourceTelemetry) {
      watchdog = setTimeout(unavailable, 15_000);
      try {
        unsubscribe = server.onResourceTelemetry(accept);
      } catch {
        unavailable();
      }
    } else {
      // Older transports have no stream. Serialize reads so slow hosts cannot accumulate work.
      const read = async () => {
        try {
          accept(await server.getResourceTelemetry());
        } catch {
          unavailable();
        }
        if (alive) poll = setTimeout(() => void read(), 2000);
      };
      void read();
    }
    return () => {
      alive = false;
      unsubscribe?.();
      clearTimeout(watchdog);
      clearTimeout(poll);
    };
  }, [api, threadId, enabled]);
  // Hide a just-stopped/replaced terminal immediately, before the next telemetry tick.
  return {
    ...resources,
    samples: Object.fromEntries(
      Object.entries(resources.samples).filter(
        ([id, sample]) => roots[id] != null && sample.identity.startsWith(`${roots[id]}:`),
      ),
    ),
  };
}
