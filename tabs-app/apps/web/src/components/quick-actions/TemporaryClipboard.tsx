import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import {
  ClipboardIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type Clip = {
  id: string;
  text: string;
  type: "text" | "image";
  createdAt: number;
  pinned: boolean;
};
const SAVED_KEY = "tabs.quickClipboard.saved";
const HISTORY_KEY = "tabs.quickClipboard.history";
const DRAFT_KEY = "tabs.quickClipboard.draft";
function readClips(key: string, pinned: boolean): Clip[] {
  try {
    const value: unknown = JSON.parse(
      (pinned ? localStorage : sessionStorage).getItem(key) ?? "[]",
    );
    return Array.isArray(value)
      ? value
          .filter((item) => typeof item?.id === "string" && typeof item?.text === "string")
          .slice(0, 50)
          .map((item) => ({
            id: item.id,
            text: item.text,
            type: item.type === "image" ? "image" : "text",
            createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
            pinned,
          }))
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
  const [clips, setClips] = useState<Clip[]>(() =>
    [...readClips(SAVED_KEY, true), ...readClips(HISTORY_KEY, false)].sort(
      (a, b) => b.createdAt - a.createdAt,
    ),
  );
  const [query, setQuery] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(() => {
    try {
      return sessionStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [status, setStatus] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(clips.filter((clip) => clip.pinned)));
      sessionStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(clips.filter((clip) => !clip.pinned).slice(0, 25)),
      );
    } catch {
      setStatus("Storage is full. Your current items are still available in this window.");
    }
  }, [clips]);
  const add = (text: string, type: Clip["type"] = "text", pinned = false) => {
    if (!text.trim()) return;
    setClips((current) => {
      const existing = current.find((clip) => clip.text === text && clip.type === type);
      const next = {
        id: existing?.id ?? crypto.randomUUID(),
        text,
        type,
        createdAt: Date.now(),
        pinned: pinned || existing?.pinned || false,
      };
      return [next, ...current.filter((clip) => clip.id !== next.id)].filter(
        (clip, index, all) =>
          clip.pinned || all.slice(0, index + 1).filter((item) => !item.pinned).length <= 25,
      );
    });
    setStatus(pinned ? "Snippet saved on this device" : "Added to clipboard");
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (alive.current) {
        if (text) add(text.slice(0, 100000));
        else setStatus("Clipboard is empty. You can also paste an image with Command / Ctrl + V.");
      }
    } catch {
      if (alive.current) setStatus("Press Command / Ctrl + V here to paste, or choose New note.");
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    if ((event.target as Element).closest("textarea")) return;
    const image = [...event.clipboardData.items]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    const text = event.clipboardData.getData("text/plain");
    if (image) {
      event.preventDefault();
      if (image.size > 1024 * 1024) {
        setStatus("Choose an image smaller than 1 MB for this clipboard.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (alive.current && typeof reader.result === "string") add(reader.result, "image");
      };
      reader.onerror = () => {
        if (alive.current) setStatus("Could not paste that image.");
      };
      reader.readAsDataURL(image);
    } else if (text) {
      event.preventDefault();
      add(text.slice(0, 100000));
    }
  };
  const copy = async (clip: Clip) => {
    try {
      if (clip.type === "image") {
        const blob = await (await fetch(clip.text)).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      } else await navigator.clipboard.writeText(clip.text);
      setStatus("Copied to clipboard");
    } catch {
      setStatus("Could not copy. Open the item to select its text manually.");
    }
  };
  const visible = clips.filter(
    (clip) =>
      (!savedOnly || clip.pinned) &&
      (clip.type === "image"
        ? !query || "image".includes(query.toLowerCase())
        : clip.text.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl overflow-hidden" onPaste={onPaste}>
        <div className="border-b border-border p-5 pb-4">
          <div className="flex items-center gap-2">
            <ClipboardIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <DialogTitle>Clipboard</DialogTitle>
          </div>
          <DialogDescription className="mt-1">
            Paste text, links, or an image here. Pin anything you want to keep.
          </DialogDescription>
          <div className="mt-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                autoFocus
                aria-label="Search clipboard"
                placeholder="Search your clipboard…"
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => void paste()}>
              Paste
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="New note"
              onClick={() => setComposing((value) => !value)}
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>
          <div className="mt-3 flex gap-1" aria-label="Clipboard filter">
            {[false, true].map((saved) => (
              <button
                key={String(saved)}
                type="button"
                aria-pressed={savedOnly === saved}
                onClick={() => setSavedOnly(saved)}
                className={`rounded-md px-2.5 py-1 text-xs ${savedOnly === saved ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                {saved ? "Saved" : "Recent"}
              </button>
            ))}
          </div>
        </div>
        {composing && (
          <form
            className="space-y-3 border-b border-border bg-muted/20 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              add(draft, "text", true);
              setDraft("");
              setComposing(false);
              try {
                sessionStorage.removeItem(DRAFT_KEY);
              } catch {
                /* Draft remains in memory. */
              }
            }}
          >
            <Textarea
              autoFocus
              aria-label="Clipboard text"
              placeholder="Paste or write a note…"
              rows={4}
              maxLength={100000}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                try {
                  sessionStorage.setItem(DRAFT_KEY, event.target.value);
                } catch {
                  /* Draft remains in memory. */
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" type="button" onClick={() => setComposing(false)}>
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={!draft.trim()}>
                Save snippet
              </Button>
            </div>
          </form>
        )}
        <div
          className="max-h-[min(55dvh,440px)] min-h-44 overflow-y-auto p-2"
          aria-label="Clipboard items"
        >
          {visible.length ? (
            visible.map((clip) => (
              <div
                key={clip.id}
                className="group flex items-start gap-3 rounded-lg p-3 hover:bg-muted/60"
              >
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                  {clip.type === "image" ? (
                    <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  aria-label={
                    clip.type === "image" ? "Copy clipboard image" : "Open clipboard item"
                  }
                  onClick={() => {
                    if (clip.type === "text") {
                      setDraft(clip.text);
                      setComposing(true);
                    } else void copy(clip);
                  }}
                >
                  {clip.type === "image" ? (
                    <img
                      src={clip.text}
                      alt="Pasted clipboard image"
                      className="max-h-32 max-w-full rounded-md object-contain"
                    />
                  ) : (
                    <span className="line-clamp-2 whitespace-pre-wrap break-words text-sm">
                      {clip.text}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {clip.type === "image"
                      ? "Image"
                      : /^https?:\/\/\S+$/.test(clip.text)
                        ? "Link"
                        : "Text"}{" "}
                    ·{" "}
                    {clip.pinned
                      ? "Saved"
                      : new Date(clip.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </span>
                </button>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Copy clipboard item"
                    onClick={() => void copy(clip)}
                  >
                    <CopyIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={clip.pinned ? "Unpin clipboard item" : "Save clipboard item"}
                    aria-pressed={clip.pinned}
                    onClick={() =>
                      setClips((current) =>
                        current.map((item) =>
                          item.id === clip.id ? { ...item, pinned: !item.pinned } : item,
                        ),
                      )
                    }
                  >
                    <PinIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Remove clipboard item"
                    onClick={() =>
                      setClips((current) => current.filter((item) => item.id !== clip.id))
                    }
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-6 text-center">
              <ClipboardIcon className="size-7 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm">
                {query
                  ? "No matching items"
                  : savedOnly
                    ? "No saved snippets yet"
                    : "Your clipboard starts here"}
              </p>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                {query
                  ? "Try a different search."
                  : "Press Command / Ctrl + V, choose Paste, or add a note. Pin items to keep them on this device."}
              </p>
            </div>
          )}
        </div>
        <p role="status" className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          {status || "Recent items stay in this window. Saved items stay on this device."}
        </p>
      </DialogPopup>
    </Dialog>
  );
}
