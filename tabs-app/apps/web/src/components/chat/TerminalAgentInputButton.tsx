import type {
  EnvironmentId,
  TerminalAgentInputRef,
  TerminalAgentInputReview,
  TerminalAgentInputReviewCommand,
  ThreadId,
} from "@tabs/contracts";
import { useState } from "react";
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
import { environmentApi } from "~/connection/environmentApiRegistry";
import { queueThreadContinuation } from "~/lib/queueThreadContinuation";

const resultMessages = {
  delivered: "Input reached the terminal. Check the terminal for the result.",
  declined: "You declined this request.",
  expired:
    "This request is no longer valid. The terminal was closed or restarted, or the request timed out, so the input was not sent.",
  uncertain: "Delivery could not be confirmed. Check the terminal before repeating the input.",
} as const;

/** Fallback when the request carries no title: "Terminal 2" from "terminal-2", else "Terminal". */
function terminalLabel(terminalId: string) {
  const number = /(\d+)$/.exec(terminalId)?.[1];
  return number && number !== "1" ? `Terminal ${number}` : "Terminal";
}

export function TerminalAgentInputButton({
  environmentId,
  threadId,
  request,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  request: TerminalAgentInputRef;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<TerminalAgentInputReview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { requestId } = request;

  async function send(action: TerminalAgentInputReviewCommand["action"]) {
    setBusy(true);
    setError("");
    try {
      const { terminal } = await environmentApi(environmentId);
      if (!terminal.reviewAgentInput) throw new Error("Terminal input review is unavailable here.");
      const result = await terminal.reviewAgentInput({ action, threadId, requestId });
      if (result.requestId !== requestId) throw new Error("This terminal input request changed.");
      if (result.status === "pending" && result.text === undefined) {
        throw new Error("The requested input is unavailable for review.");
      }
      setReview(result);
      if (action === "approve" && result.status === "delivered") {
        queueThreadContinuation({
          id: requestId,
          threadId,
          environmentId,
          text: `I approved your terminal input and it was delivered. Check the actual outcome before repeating it or reporting success, and ask me for a terminal excerpt if you need one.\n[tabs: request=${requestId}]`,
          failedTitle: "Terminal input was delivered",
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check this terminal request.");
    } finally {
      setBusy(false);
    }
  }

  const askAgain = () => {
    queueThreadContinuation({
      id: `${requestId}:again:${Date.now()}`,
      threadId,
      environmentId,
      text: `The terminal input you proposed was not sent because the request expired or the terminal changed. Please look at the terminal again and propose fresh input for me to approve.\n[tabs: request=${requestId}]`,
      failedTitle: "Your request to the agent",
    });
    setOpen(false);
  };
  const needsApproval = review?.status === "pending" && review.text !== undefined;
  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="mt-2"
        onClick={() => {
          setOpen(true);
          setReview(undefined);
          void send("review");
        }}
      >
        Review terminal input
      </Button>
      {open && (
        <Dialog open onOpenChange={(next) => !next && !busy && setOpen(false)}>
          <DialogPopup showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Review terminal input</DialogTitle>
              {review && (
                <DialogDescription title={`${review.terminalId} · ${review.instanceId}`}>
                  {(review as { terminalTitle?: string }).terminalTitle?.trim() ||
                    terminalLabel(review.terminalId)}{" "}
                  · {review.cwd}
                </DialogDescription>
              )}
            </DialogHeader>
            <DialogPanel>
              {needsApproval && (
                <>
                  <p className="mb-2 text-sm text-muted-foreground">
                    {review.pressEnter
                      ? "Tabs will send this text and press Enter in the selected terminal."
                      : "Tabs will send this text to the program running in the selected terminal."}
                  </p>
                  <pre
                    aria-label="Requested terminal input"
                    dir="ltr"
                    tabIndex={0}
                    className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] border border-border/60 p-2 font-mono text-xs"
                  >
                    {review.text}
                  </pre>
                </>
              )}
              {busy && !review && <p role="status">Checking terminal session…</p>}
              {review && review.status !== "pending" && (
                <p role="status">{resultMessages[review.status]}</p>
              )}
              {review?.status === "expired" && (
                <Button type="button" size="sm" className="mt-2" onClick={askAgain}>
                  Ask the agent again
                </Button>
              )}
              {error && <p role="alert">{error}</p>}
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                Close
              </Button>
              {needsApproval && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void send("decline")}
                  >
                    Decline
                  </Button>
                  <Button type="button" disabled={busy} onClick={() => void send("approve")}>
                    {review.pressEnter ? "Send input and press Enter" : "Send input"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      )}
    </>
  );
}
