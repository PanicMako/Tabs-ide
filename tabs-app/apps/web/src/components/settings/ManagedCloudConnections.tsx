import { UserButton, useAuth, useClerk } from "@clerk/react";
import type { EnvironmentId } from "@tabs/contracts";
import type {
  RelayClientEnvironmentRecord,
  RelayEnvironmentStatusResponse,
} from "@tabs/contracts/relay";
import { CloudIcon, LoaderCircleIcon, LogInIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { deregisterManagedRelayEnvironment, listManagedRelayEnvironments } from "~/cloud/runtime";
import { registerRelayConnection, removeManualConnection } from "~/connection/manualConnections";
import { connectEnvironmentApi } from "~/connection/environmentApiRegistry";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";

interface CloudRow {
  readonly environment: RelayClientEnvironmentRecord;
  readonly status: RelayEnvironmentStatusResponse | null;
}

export function ManagedCloudConnections() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [rows, setRows] = useState<ReadonlyArray<CloudRow>>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<EnvironmentId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await listManagedRelayEnvironments());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isLoaded)
    return (
      <p className="px-5 py-4 text-xs text-muted-foreground" role="status">
        Loading account…
      </p>
    );
  if (!isSignedIn) {
    return (
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <CloudIcon className="size-4" />
            Tabs Connect
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in to discover environments linked to your account.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => clerk.openSignIn()}>
          <LogInIcon className="size-4" /> Sign in
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <UserButton />
          <div>
            <p className="text-[13px] font-semibold">Tabs Connect</p>
            <p className="text-xs text-muted-foreground">Account-linked environments</p>
          </div>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh Tabs Connect environments"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-4" />
          )}
        </Button>
      </div>
      {error ? (
        <p className="border-t border-border/60 px-5 py-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="border-t border-border/60 px-5 py-4 text-xs text-muted-foreground">
          No linked environments.
        </p>
      ) : null}
      {rows.map(({ environment, status }) => (
        <div
          key={environment.environmentId}
          className="flex items-center justify-between gap-4 border-t border-border/60 px-5 py-4"
        >
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{environment.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {status?.status === "online"
                ? "Online"
                : status?.status === "offline"
                  ? "Offline"
                  : "Status unavailable"}{" "}
              · {environment.endpoint.providerKind.replaceAll("_", " ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busyId !== null || status?.status !== "online"}
              onClick={async () => {
                setBusyId(environment.environmentId);
                try {
                  await registerRelayConnection({
                    environmentId: environment.environmentId,
                    label: environment.label,
                  });
                  await connectEnvironmentApi(environment.environmentId);
                  toastManager.add({
                    type: "success",
                    title: "Environment connected",
                    description: `${environment.label} is ready through Tabs Connect.`,
                  });
                } catch (cause) {
                  await removeManualConnection(environment.environmentId).catch(() => undefined);
                  toastManager.add({
                    type: "error",
                    title: "Could not connect environment",
                    description: cause instanceof Error ? cause.message : String(cause),
                  });
                } finally {
                  setBusyId(null);
                }
              }}
            >
              {busyId === environment.environmentId ? "Connecting…" : "Connect"}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Deregister ${environment.label}`}
              disabled={busyId !== null}
              onClick={async () => {
                setBusyId(environment.environmentId);
                try {
                  await deregisterManagedRelayEnvironment(environment.environmentId);
                  await removeManualConnection(environment.environmentId);
                  await refresh();
                } catch (cause) {
                  toastManager.add({
                    type: "error",
                    title: "Could not deregister environment",
                    description: cause instanceof Error ? cause.message : String(cause),
                  });
                } finally {
                  setBusyId(null);
                }
              }}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
