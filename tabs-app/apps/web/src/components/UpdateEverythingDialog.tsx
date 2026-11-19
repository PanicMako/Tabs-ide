import type { DesktopUpdateState } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { CheckIcon, CircleAlertIcon, LoaderIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { serverConfigAtom } from "~/state/settings";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import {
  buildUpdateEverythingItems,
  describeUpdateItem,
  runUpdateEverything,
  type UpdateItem,
  type UpdateItemResult,
} from "./updateEverything.logic";
import { useUpdateEverythingStore } from "./updateEverythingStore";

function useDesktopUpdateState(): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.getUpdateState !== "function") return;
    let disposed = false;
    const unsubscribe = bridge.onUpdateState?.((next) => {
      if (!disposed) setState(next);
    });
    void bridge
      .getUpdateState()
      .then((next) => {
        if (!disposed) setState((current) => current ?? next);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  return state;
}

function StatusMark({ result }: { result: UpdateItemResult | undefined }) {
  if (result?.status === "running")
    return <LoaderIcon aria-label="Updating" className="size-4 animate-spin" />;
  if (result?.status === "done") return <CheckIcon aria-label="Updated" className="size-4" />;
  if (result?.status === "failed" || result?.status === "skipped")
    return <CircleAlertIcon aria-label="Not updated" className="size-4" />;
  return null;
}

/** One place to bring Tabs and every provider CLI up to date, with what will change listed first. */
export function UpdateEverythingDialog() {
  const open = useUpdateEverythingStore((state) => state.open);
  const setOpen = useUpdateEverythingStore((state) => state.setOpen);
  const providers = useAtomValue(serverConfigAtom)?.providers ?? [];
  const desktop = useDesktopUpdateState();
  const items = useMemo(() => buildUpdateEverythingItems(desktop, providers), [desktop, providers]);
  const [results, setResults] = useState<ReadonlyMap<string, UpdateItemResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [listed, setListed] = useState<ReadonlyArray<UpdateItem>>([]);

  // Freeze the list once a run starts so rows do not vanish as each one finishes.
  const shown = running || results.size > 0 ? listed : items;
  const hasApp = shown.some((item) => item.kind === "app");

  const start = async () => {
    setListed(items);
    setRunning(true);
    try {
      const api = await environmentApi(null);
      await runUpdateEverything(
        items,
        {
          updateProvider: async (item) => {
            await api.server.updateProvider({
              provider: item.driver,
              instanceId: item.id as never,
            });
          },
          updateApp: async (item) => {
            const bridge = window.desktopBridge;
            if (!bridge) throw new Error("App updates are only available in the desktop app.");
            if (item.needsDownload) {
              const downloaded = await bridge.downloadUpdate();
              if (!downloaded.completed) {
                throw new Error(downloaded.state.message ?? "The download did not finish.");
              }
            }
            await bridge.installUpdate();
          },
        },
        (id, result) => setResults((current) => new Map(current).set(id, result)),
      );
    } finally {
      setRunning(false);
    }
  };

  const finished = results.size > 0 && !running;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return;
        setOpen(next);
        if (!next) setResults(new Map());
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {shown.length === 0 ? "Everything is up to date" : "Update everything"}
          </DialogTitle>
          <DialogDescription>
            {shown.length === 0
              ? "Tabs and every provider are on their latest version."
              : hasApp
                ? "Providers update first. Tabs restarts last, so save your work before you start."
                : "These providers have newer versions. Sessions already running keep their current version."}
          </DialogDescription>
        </DialogHeader>
        {shown.length > 0 && (
          <ul aria-label="Available updates" className="m-0 flex list-none flex-col p-0 px-6">
            {shown.map((item) => {
              const result = results.get(item.id);
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{item.label}</span>
                    {result?.message ? (
                      <span className="block text-xs text-muted-foreground">{result.message}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {describeUpdateItem(item)}
                  </span>
                  <span className="flex size-4 items-center justify-center">
                    <StatusMark result={result} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={running} onClick={() => setOpen(false)}>
            {finished ? "Close" : "Not now"}
          </Button>
          {shown.length > 0 && !finished && (
            <Button disabled={running} onClick={() => void start()}>
              {running
                ? "Updating…"
                : `Update ${items.length === 1 ? "now" : `all ${items.length}`}`}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
