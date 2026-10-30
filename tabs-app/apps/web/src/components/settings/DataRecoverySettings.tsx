import { useCallback, useEffect, useState } from "react";
import type { DesktopBridge } from "@tabs/contracts";
import { useConfirm } from "../../hooks/useConfirm";
import { ScopedPortalContext } from "../../lib/scopedPortal";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type Inventory = Awaited<ReturnType<NonNullable<DesktopBridge["listDataBackups"]>>>;
const reasons: Record<string, string> = {
  initial: "Initial snapshot",
  daily: "Daily snapshot",
  manual: "Manual snapshot",
  "before-version-change": "Before update",
  "before-downgrade": "Before downgrade",
  "before-restore": "Before recovery",
};
function size(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DataRecoverySettings({ className }: { className?: string } = {}) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const bridge = window.desktopBridge;
  const refresh = useCallback(async () => {
    if (bridge?.listDataBackups) setInventory(await bridge.listDataBackups());
  }, [bridge]);
  useEffect(() => {
    void refresh().catch((error: unknown) => setError(String(error)));
  }, [refresh]);
  if (!bridge?.listDataBackups) return null;
  const run = async (action: () => Promise<unknown>) => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    }
  };
  return (
    <ScopedPortalContext.Provider value={portal ?? undefined}>
      <section
        ref={setPortal}
        aria-label="Backups and recovery"
        className={cn("space-y-3 px-4 py-4 sm:px-5 text-sm", className)}
      >
        <h3
          className="text-[14.5px] font-medium text-foreground tracking-[0.035em]"
          style={{
            fontFamily: "var(--font-row, var(--font-sans))",
            fontWeight: "var(--font-row-weight, 500)" as React.CSSProperties["fontWeight"],
            letterSpacing: "var(--font-row-tracking, 0.035em)",
          }}
        >
          Backups &amp; recovery
        </h3>
        <p
          className="text-xs text-muted-foreground/80 leading-relaxed font-normal"
          style={{
            fontFamily: "var(--font-supporting, var(--font-sans))",
            fontWeight: "var(--font-supporting-weight, 400)" as React.CSSProperties["fontWeight"],
          }}
        >
          Tabs snapshots local data before a new version opens it, and at most once a day on
          startup. Saved project records, chats, editor state, extensions and stored sessions are
          included. Project source files outside Tabs are not copied. Recovery requires a snapshot
          for the exact app version. Your newer data is backed up before restoring.
        </p>
        {inventory?.notice ? (
          <p role="status" className="text-xs">
            {inventory.notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive whitespace-pre-wrap">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (
                  !(await confirm(
                    "Restart Tabs to create a verified backup? Running terminals and agent work will stop. Saved data will remain.",
                  ))
                )
                  return;
                if (!(await bridge.restartForDataBackup?.()))
                  throw new Error("Tabs could not schedule the backup restart.");
              })
            }
          >
            Restart &amp; back up
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await bridge.openDataBackupFolder?.();
              })
            }
          >
            Open backup folder
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run(refresh)}>
            Refresh
          </Button>
        </div>
        {busy ? (
          <p role="status" className="text-xs text-muted-foreground">
            Preparing recovery…
          </p>
        ) : null}
        {!inventory ? (
          <p role="status" className="text-xs text-muted-foreground">
            Loading snapshots…
          </p>
        ) : inventory.backups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No complete snapshots yet. Create one with Restart &amp; back up.
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-border">
            {inventory.backups.map((backup) => (
              <li
                key={backup.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p>
                    {reasons[backup.reason] ?? "Snapshot"} ·{" "}
                    {new Date(backup.createdAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tabs {backup.version} · {size(backup.bytes)}
                    {backup.version !== inventory.version
                      ? ` · Requires Tabs ${backup.version}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || backup.version === "unknown"}
                    aria-label={`${backup.version === inventory.version ? "Restore" : "Prepare"} ${backup.id}`}
                    onClick={() =>
                      void run(async () => {
                        const switchVersion = backup.version !== inventory.version;
                        const message = switchVersion
                          ? `Prepare data for Tabs ${backup.version} and quit? Your current data will first be preserved in a before-recovery snapshot. After Tabs quits, install or open Tabs ${backup.version}. Opening the current version again will migrate the restored data forward. Running work will stop.`
                          : `Restore the snapshot from ${new Date(backup.createdAt).toLocaleString()} and restart? Chats, settings and extensions return to that point. Your current data will first be preserved in a before-recovery snapshot. Running work will stop.`;
                        if (!(await confirm(message))) return;
                        const accepted = switchVersion
                          ? await bridge.restartForDataBackup?.(backup.id, true)
                          : await bridge.restartForDataBackup?.(backup.id);
                        if (!accepted) throw new Error("Tabs could not schedule recovery.");
                      })
                    }
                  >
                    {backup.version === inventory.version ? "Restore" : "Prepare & quit"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Delete ${backup.id}`}
                    onClick={() =>
                      void run(async () => {
                        if (
                          !(await confirm(
                            "Delete this backup permanently? This removes only the selected snapshot, not current application data. It may be your only recovery point for that version.",
                          ))
                        )
                          return;
                        await bridge.deleteDataBackup?.(backup.id);
                        await refresh();
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {inventory?.directory ? (
          <p className="break-all text-xs text-muted-foreground">
            Stored locally: {inventory.directory}
          </p>
        ) : null}
        {confirmDialog}
      </section>
    </ScopedPortalContext.Provider>
  );
}
