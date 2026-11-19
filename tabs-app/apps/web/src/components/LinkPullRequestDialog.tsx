import { useState } from "react";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "../nativeApi";
import { linkPullRequestFromText } from "~/lib/linkPullRequest";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { toastManager } from "~/components/ui/toast";
import { useLinkPullRequestStore } from "./linkPullRequestStore";

/** Attach a pull request to a thread by pasting its link, for work that did not start in Tabs. */
export function LinkPullRequestDialog() {
  const target = useLinkPullRequestStore((state) => state.target);
  const close = useLinkPullRequestStore((state) => state.close);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dismiss = () => {
    setText("");
    setError(null);
    close();
  };

  const submit = async () => {
    if (!target || saving) return;
    const parsed = linkPullRequestFromText(text);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const api = readNativeApi();
    if (!api) {
      setError("Tabs is not connected yet. Try again in a moment.");
      return;
    }
    setSaving(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.pull-request.link",
        commandId: newCommandId(),
        threadId: target.threadId,
        host: parsed.host,
        repository: parsed.repository,
        number: parsed.number,
        url: parsed.url,
        source: "manual",
      });
      toastManager.add({
        type: "success",
        title: "Pull request linked",
        description: `#${parsed.number} · ${parsed.repository}`,
      });
      dismiss();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not link the pull request.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : dismiss())}>
      <DialogPopup className="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Link a pull request</DialogTitle>
            <DialogDescription>
              {target ? `Attach a pull request to "${target.title}". ` : ""}
              Open it in your browser, copy its address, and paste it here.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            <Input
              autoFocus
              aria-label="Pull request link"
              placeholder="https://github.com/owner/repo/pull/123"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={dismiss}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || text.trim().length === 0}>
              {saving ? "Linking…" : "Link pull request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
