import { useState } from "react";
import { CopyIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

type Snippet = { id: string; text: string };
const SAVED_KEY = "tabs.quickClipboard.saved";
const DRAFT_KEY = "tabs.quickClipboard.draft";
function readSaved(): Snippet[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (entry): entry is Snippet =>
              typeof entry?.id === "string" && typeof entry?.text === "string",
          )
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
export function TemporaryClipboard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [saved, setSaved] = useState(readSaved);
  const [status, setStatus] = useState("");
  const persist = (next: Snippet[]) => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      setSaved(next);
      setStatus("Saved on this device");
    } catch {
      setStatus("Could not save. Device storage may be full.");
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied");
    } catch {
      setStatus("Could not copy. Select and copy the text manually.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <div className="space-y-4 p-5">
          <div className="space-y-1">
            <DialogTitle>Temporary clipboard</DialogTitle>
            <DialogDescription>
              A scratch pad for text. Save snippets to keep them on this device.
            </DialogDescription>
          </div>
          <Textarea
            aria-label="Clipboard text"
            placeholder="Paste or type something to keep handy…"
            value={text}
            maxLength={100000}
            rows={7}
            onChange={(event) => {
              setText(event.target.value);
              try {
                sessionStorage.setItem(DRAFT_KEY, event.target.value);
              } catch {
                /* The in-memory draft remains usable. */
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!text.trim()} onClick={() => void copy(text)}>
              <CopyIcon className="size-3.5" />
              Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!text.trim() || saved.length >= 50}
              onClick={() => persist([{ id: crypto.randomUUID(), text }, ...saved])}
            >
              <SaveIcon className="size-3.5" />
              Save snippet
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!text}
              onClick={() => {
                setText("");
                try {
                  sessionStorage.removeItem(DRAFT_KEY);
                } catch {
                  /* Draft is cleared in memory. */
                }
              }}
            >
              Clear draft
            </Button>
          </div>
          <p role="status" className="min-h-4 text-xs text-muted-foreground">
            {status || "Draft stays for this window. Saved snippets stay until you remove them."}
          </p>
          {saved.length > 0 && (
            <div
              className="max-h-56 space-y-2 overflow-y-auto border-t border-border pt-3"
              aria-label="Saved snippets"
            >
              {saved.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 rounded-lg border border-border p-3"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 whitespace-pre-wrap break-words text-left text-xs text-foreground hover:text-primary"
                    aria-label="Load saved snippet"
                    onClick={() => {
                      setText(entry.text);
                      try {
                        sessionStorage.setItem(DRAFT_KEY, entry.text);
                      } catch {
                        /* Draft remains in memory. */
                      }
                    }}
                  >
                    {entry.text.length > 300 ? `${entry.text.slice(0, 300)}…` : entry.text}
                  </button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Copy saved snippet"
                    onClick={() => void copy(entry.text)}
                  >
                    <CopyIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Remove saved snippet"
                    onClick={() => persist(saved.filter((item) => item.id !== entry.id))}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
