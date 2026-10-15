import { ProviderInstallState, type ProviderInstanceId } from "@tabs/contracts";
import { Schema } from "effect";
import { LoaderIcon, CheckCircle2Icon, AlertCircleIcon, DownloadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createWsNativeApi, getWsTransport } from "~/wsNativeApi";

export function ProviderInstallProgress({
  instanceId,
  onActiveChange,
  onComplete,
}: {
  instanceId: ProviderInstanceId;
  onActiveChange: (active: boolean) => void;
  onComplete: () => void;
}) {
  const [state, setState] = useState<ProviderInstallState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ onActiveChange, onComplete });
  callbacks.current = { onActiveChange, onComplete };
  useEffect(() => {
    let previousPhase: ProviderInstallState["phase"] | undefined;
    if (!getWsTransport()) createWsNativeApi();
    const transport = getWsTransport();
    if (!transport) {
      setError("Install progress is unavailable. Refresh providers to check the result.");
      return;
    }
    const stop = transport.subscribeRpc(
      "provider.install.subscribe",
      () => ({ instanceId }),
      Schema.decodeUnknownSync(ProviderInstallState),
      (next) => {
        setState(next);
        setError(null);
        const active = ["downloading", "extracting", "verifying"].includes(next.phase);
        callbacks.current.onActiveChange(active);
        if (next.phase === "succeeded" && previousPhase !== "succeeded")
          callbacks.current.onComplete();
        previousPhase = next.phase;
      },
      () => setError("Install progress is unavailable. Refresh providers to check the result."),
    );
    return () => {
      stop();
      callbacks.current.onActiveChange(false);
    };
  }, [instanceId]);

  if (error)
    return (
      <p role="status" className="px-5 py-3 text-xs text-destructive">
        {error}
      </p>
    );
  if (!state || state.phase === "idle") return null;
  const downloading = state.phase === "downloading";
  const active = downloading || state.phase === "extracting" || state.phase === "verifying";
  const total = state.totalBytes;
  const percent =
    total && total > 0 ? Math.min(100, Math.floor((state.downloadedBytes / total) * 100)) : null;
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  const label = {
    idle: "",
    downloading: "Downloading Antigravity runtime",
    extracting: "Extracting Antigravity runtime",
    verifying: "Verifying Antigravity installation",
    succeeded: "Antigravity installed",
    failed: "Antigravity installation failed",
    cancelled: "Antigravity installation cancelled",
  }[state.phase];
  return (
    <div className="border-t border-border/60 px-4 py-4 sm:px-5" aria-busy={active}>
      <div className="rounded-xl border border-border/60 bg-muted/15 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70">
            {state.phase === "succeeded" ? (
              <CheckCircle2Icon className="size-4 text-emerald-500" />
            ) : state.phase === "failed" ? (
              <AlertCircleIcon className="size-4 text-destructive" />
            ) : (
              <DownloadIcon className="size-4 text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Runtime setup
            </p>
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-xs font-medium"
            >
              {active ? <LoaderIcon className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {label}
              {downloading && percent !== null ? ` · ${percent}%` : ""}
            </div>
          </div>
        </div>
        {active ? (
          <div className="grid grid-cols-3 gap-2" aria-label="Installation steps">
            {["downloading", "extracting", "verifying"].map((phase, index) => (
              <div
                key={phase}
                className={`rounded-md px-2 py-1.5 text-center text-[11px] ${state.phase === phase ? "bg-primary/10 text-primary font-medium" : "bg-background/40 text-muted-foreground"}`}
              >
                {["Download", "Extract", "Verify"][index]}
              </div>
            ))}
          </div>
        ) : null}
        {downloading ? (
          <>
            <progress
              className="sr-only"
              aria-label="Antigravity download"
              max={total || 1}
              {...(total && total > 0 ? { value: Math.min(state.downloadedBytes, total) } : {})}
            />
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={`h-full rounded-full bg-primary transition-[width] duration-300 ${percent === null ? "animate-pulse motion-reduce:animate-none" : ""}`}
                style={{ width: percent === null ? "35%" : `${percent}%` }}
              />
            </div>
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              {mb(state.downloadedBytes)} MB{total ? ` of ${mb(total)} MB` : " downloaded"}
            </p>
          </>
        ) : null}
        {state.message ? (
          <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
        ) : null}
      </div>
    </div>
  );
}
