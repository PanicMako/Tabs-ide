import type { ResolvedKeybindingsConfig } from "@tabs/contracts";
import { LoaderIcon, MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { useComposerDictation, type ComposerDictationInput } from "~/speech/useComposerDictation";
import { useDictationShortcut } from "~/speech/useDictationShortcut";
import { cn } from "~/lib/utils";
import { useClientSettings } from "~/state/settings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

type ComposerDictationButtonProps = ComposerDictationInput & {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly terminalOpen: boolean;
};

/** Labs: the composer microphone, mounted only once Voice input is switched on. */
export function ComposerDictationButton(props: ComposerDictationButtonProps) {
  const enabled = useClientSettings().voiceInputEnabled;
  return enabled ? <ComposerDictation {...props} /> : null;
}

function ComposerDictation(props: ComposerDictationButtonProps) {
  const dictation = useComposerDictation(props);
  const shortcut = useDictationShortcut({
    keybindings: props.keybindings,
    speech: dictation,
    disabled: props.disabled ?? false,
    terminalOpen: props.terminalOpen,
    modelPickerOpen: false,
  });

  const lastError = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- surfaces each new recording failure once as a toast
  useEffect(() => {
    const error = dictation.state.phase === "error" ? dictation.state.error : null;
    if (error && error !== lastError.current) {
      toastManager.add({ type: "error", title: "Voice input", description: error });
    }
    lastError.current = error;
  }, [dictation.state]);

  if (!dictation.available && !dictation.setup.open) return null;

  const { phase } = dictation.state;
  const recording = phase === "recording";
  const busy = phase === "preparing" || phase === "transcribing" || phase === "post-processing";
  const label = recording
    ? "Stop dictation"
    : busy
      ? "Transcribing"
      : `Dictate${shortcut ? ` (${shortcut})` : ""}`;
  const setup = dictation.setup;
  const model = setup.model;
  const progress =
    model && model.size > 0 && model.downloaded !== undefined
      ? Math.min(100, Math.round((model.downloaded / model.size) * 100))
      : null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "relative shrink-0 px-2 sm:px-2.5",
                recording
                  ? "text-destructive"
                  : "text-muted-foreground/70 hover:text-foreground/80",
              )}
              disabled={props.disabled || busy}
              aria-label={label}
              aria-pressed={recording}
              onClick={() => void (recording ? dictation.stop() : dictation.start())}
            >
              {busy ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : recording ? (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute inset-1 rounded-full bg-destructive/15"
                    style={{ transform: `scale(${0.75 + Math.min(1, dictation.level) * 0.35})` }}
                  />
                  <SquareIcon className="relative size-3.5 fill-current" />
                </>
              ) : (
                <MicIcon className="size-4" />
              )}
            </Button>
          }
        />
        <TooltipPopup side="top" className="max-w-72">
          {recording && dictation.preview
            ? `${dictation.preview.committed}${dictation.preview.tentative}`.trim() || label
            : label}
        </TooltipPopup>
      </Tooltip>
      <Dialog open={setup.open} onOpenChange={(open) => !open && setup.close()}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set up voice input</DialogTitle>
            <DialogDescription>
              Dictation runs on this device. It needs a speech model the first time.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3 text-sm">
            {model ? (
              <div className="rounded-md border border-border/70 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{model.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(model.size)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{model.description}</p>
                {setup.downloading && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width] duration-300"
                      style={{ width: `${progress ?? 0}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              !setup.error && <p className="text-muted-foreground">Loading speech models…</p>
            )}
            {setup.error && <p className="text-destructive">{setup.error}</p>}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={setup.close}>
              {setup.downloading ? "Cancel download" : "Not now"}
            </Button>
            <Button
              type="button"
              disabled={!model || setup.downloading}
              onClick={() => void setup.download()}
            >
              {setup.downloading
                ? progress === null
                  ? "Downloading…"
                  : `Downloading ${progress}%`
                : "Download and start"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
