import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogPopup } from "../ui/dialog";
import { Button } from "../ui/button";
import ChatMarkdown from "../ChatMarkdown";
import { Eye, Edit3 } from "lucide-react";

export function PullRequestEditForm({
  prNumber,
  title,
  setTitle,
  body,
  setBody,
  activeTab,
  setActiveTab,
  onSave,
  onCancel,
  isPending,
  cwd,
}: {
  prNumber: number;
  title: string;
  setTitle: (title: string) => void;
  body: string;
  setBody: (body: string) => void;
  activeTab: "write" | "preview";
  setActiveTab: (tab: "write" | "preview") => void;
  onSave: (title: string, body: string) => Promise<boolean | void>;
  onCancel: () => void;
  isPending: boolean;
  cwd?: string | null | undefined;
}) {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (title.trim() && !isPending) {
          void onSave(title.trim(), body);
        }
      }
    },
    [title, body, isPending, onSave],
  );

  return (
    <div className="space-y-4 p-5" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between pb-3 border-b border-border/60">
        <h3 className="text-base font-semibold text-foreground">Edit Pull Request #{prNumber}</h3>
      </div>

      <div className="space-y-4">
        {/* Title input */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="git-pr-edit-title"
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
            >
              Title
            </label>
            <span className="text-[11px] text-muted-foreground">{title.length} / 1000</span>
          </div>
          <input
            id="git-pr-edit-title"
            value={title}
            maxLength={1_000}
            autoFocus
            disabled={isPending}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Pull request title…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Description with Write & Preview tabs */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Description
            </span>
            <div
              className="tabs-segmented flex items-center"
              role="group"
              aria-label="Description editor mode"
            >
              <Button
                type="button"
                size="sm"
                variant={activeTab === "write" ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setActiveTab("write")}
                aria-pressed={activeTab === "write"}
              >
                <Edit3 className="size-3" />
                <span>Write</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "preview" ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setActiveTab("preview")}
                aria-pressed={activeTab === "preview"}
              >
                <Eye className="size-3" />
                <span>Preview</span>
              </Button>
            </div>
          </div>

          {activeTab === "write" ? (
            <textarea
              id="git-pr-edit-description"
              value={body}
              maxLength={100_000}
              rows={10}
              disabled={isPending}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Add description… (Markdown supported)"
              className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm font-mono text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <div className="min-h-[220px] max-h-[360px] overflow-y-auto rounded-md border border-border/70 bg-card p-3 text-sm">
              {body.trim() ? (
                <ChatMarkdown text={body} cwd={cwd ?? undefined} />
              ) : (
                <p className="text-xs italic text-muted-foreground">No description to preview.</p>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Tip: Press <kbd className="rounded border bg-muted px-1">⌘+Enter</kbd> or{" "}
            <kbd className="rounded border bg-muted px-1">Ctrl+Enter</kbd> to save.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!title.trim() || isPending}
          onClick={() => void onSave(title.trim(), body)}
        >
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

export function PullRequestEditDialog({
  open,
  onOpenChange,
  prNumber,
  initialTitle,
  initialBody,
  onSave,
  isPending,
  cwd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prNumber: number;
  initialTitle: string;
  initialBody: string;
  onSave: (title: string, body: string) => Promise<boolean | void>;
  isPending: boolean;
  cwd?: string | null | undefined;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setBody(initialBody);
      setActiveTab("write");
    }
  }, [open, initialTitle, initialBody]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="git-tool-v2 max-w-2xl p-0 overflow-hidden">
        <PullRequestEditForm
          prNumber={prNumber}
          title={title}
          setTitle={setTitle}
          body={body}
          setBody={setBody}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onSave={onSave}
          onCancel={() => onOpenChange(false)}
          isPending={isPending}
          cwd={cwd}
        />
      </DialogPopup>
    </Dialog>
  );
}
