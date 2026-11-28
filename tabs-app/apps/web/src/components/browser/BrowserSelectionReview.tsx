import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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

export type BrowserSelectionResult = { text: string } | { error: string };

export function BrowserSelectionReview({
  selection,
  origin,
  profile,
  returnFocus,
  onApprove,
  onClose,
}: {
  selection: Promise<BrowserSelectionResult>;
  origin: string;
  profile: string;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onApprove: (text: string, isOpen: () => boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [result, setResult] = useState<BrowserSelectionResult>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const open = useRef(true);
  useLayoutEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  useEffect(() => {
    void selection.then((next) => {
      if (open.current) setResult(next);
    });
  }, [selection]);

  function close() {
    open.current = false;
    onClose();
  }

  async function approve(text: string) {
    setChecking(true);
    try {
      await onApprove(text, () => open.current);
      if (open.current) close();
    } catch (failure) {
      if (!open.current) return;
      setChecking(false);
      setError(failure instanceof Error ? failure.message : "Could not add the browser excerpt.");
    }
  }

  const text = result && "text" in result ? result.text : undefined;
  const failure = error ?? (result && "error" in result ? result.error : undefined);
  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogPopup showCloseButton={false} finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Review browser selection</DialogTitle>
          <DialogDescription>
            {origin} · {profile} profile
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {!result && (
            <p role="status" className="text-sm">
              Reading selection…
            </p>
          )}
          {text !== undefined && (
            <>
              <p className="mb-2 text-sm text-muted-foreground">
                This excerpt will be shared with the agent when you send the draft.
              </p>
              <pre
                aria-label="Selected browser text"
                dir="auto"
                tabIndex={0}
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-border/60 p-2 text-sm"
              >
                {text}
              </pre>
            </>
          )}
          {failure && (
            <p role="alert" className="mt-2 text-sm">
              {failure}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={text === undefined || checking || Boolean(error)}
            onClick={() => text !== undefined && void approve(text)}
          >
            {checking ? "Checking page…" : "Add to draft"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
