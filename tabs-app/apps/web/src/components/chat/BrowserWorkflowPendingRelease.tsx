import type { BrowserWorkflowResultRef, EnvironmentId, ThreadId } from "@tabs/contracts";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { environmentApi } from "~/connection/environmentApiRegistry";

/**
 * When an Upload or Submit may have reached the site, only the user can say what
 * happened. Two plain buttons release the guard either way.
 */
export function BrowserWorkflowPendingRelease({
  environmentId,
  threadId,
  result,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  result: BrowserWorkflowResultRef;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"confirmNotSent" | "confirmSent">();
  if (done) {
    return (
      <span role="status" className="text-xs text-muted-foreground">
        {done === "confirmSent" ? "You confirmed it sent" : "You confirmed it did not send"}
      </span>
    );
  }
  const resolve = async (resolvePending: "confirmNotSent" | "confirmSent") => {
    setBusy(true);
    try {
      const api = await environmentApi(environmentId);
      await api.preview.getWorkflowResult({
        threadId,
        workflowId: result.workflowId,
        stage: result.stage,
        resolvePending,
      });
      setDone(resolvePending);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not record your answer",
        description: error instanceof Error ? error.message : "Nothing is waiting for your answer.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={() => void resolve("confirmNotSent")}
      >
        It didn&apos;t send
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={() => void resolve("confirmSent")}
      >
        It sent
      </Button>
    </>
  );
}
