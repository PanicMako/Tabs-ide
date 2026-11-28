import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { formatTerminalContextLabel, type TerminalContextSelection } from "~/lib/terminalContext";

export interface TerminalSelectionReviewRequest {
  selection: TerminalContextSelection & { source: NonNullable<TerminalContextSelection["source"]> };
  approve: (isOpen: () => boolean) => Promise<boolean>;
}

export function TerminalSelectionReview({
  request,
  onClose,
}: {
  request: TerminalSelectionReviewRequest;
  onClose: () => void;
}) {
  const { selection } = request;
  const open = useRef(true);
  const [checking, setChecking] = useState(false);
  const [stale, setStale] = useState(false);

  useLayoutEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  function close() {
    open.current = false;
    onClose();
  }

  async function approve() {
    setChecking(true);
    const approved = await request.approve(() => open.current);
    if (!open.current) return;
    if (approved) {
      close();
    } else {
      setChecking(false);
      setStale(true);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogPopup showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Review terminal selection</DialogTitle>
          <DialogDescription>
            {formatTerminalContextLabel(selection)} · Session{" "}
            {selection.source.instanceId.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <p className="mb-2 text-sm text-muted-foreground">
            This excerpt will be shared with the agent when you send the draft. Cancel and select a
            smaller excerpt if it contains credentials or private text.
          </p>
          <pre
            aria-label="Selected terminal text"
            dir="ltr"
            tabIndex={0}
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-border/60 p-2 font-mono text-xs"
          >
            {selection.text}
          </pre>
          {stale && (
            <p role="alert" className="mt-2 text-sm">
              The terminal session changed or became unavailable. Select the output again.
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="button" disabled={checking || stale} onClick={() => void approve()}>
            {checking ? "Checking session…" : "Add to draft"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
