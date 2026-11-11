import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import {
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  LinkIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Dialog, DialogPopup, DialogTitle, DialogDescription, DialogClose } from "../ui/dialog";
import { Button } from "../ui/button";
import { TabsMascot } from "../TabsMascot";
import "./temporary-clipboard.css";

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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
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
      setCopiedId(clip.id);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 1_400);
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
      <DialogPopup className="tc-popup" showCloseButton={false} onPaste={onPaste}>
        <DialogTitle className="sr-only">Clipboard</DialogTitle>
        <DialogDescription className="sr-only">
          Paste text, links, or an image here. Pin anything you want to keep.
        </DialogDescription>
        <div className="tc-omnibar">
          <SearchIcon className="tc-omnibar-icon" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            aria-label="Search clipboard"
            placeholder="Search your clipboard…"
            className="tc-omnibar-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="tc-omnibar-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="tc-paste-btn"
            aria-label="Paste"
            onClick={() => void paste()}
          >
            <ClipboardIcon className="size-3.5" aria-hidden="true" />
            <span>Paste</span>
          </button>
        </div>

        {composing && (
          <form
            className="tc-compose-panel"
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
            <textarea
              autoFocus
              aria-label="Clipboard text"
              placeholder="Write a note…"
              className="tc-compose-textarea"
              rows={3}
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
            <div className="tc-compose-footer">
              <Button size="sm" variant="ghost" type="button" onClick={() => setComposing(false)}>
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={!draft.trim()}>
                Save snippet
              </Button>
            </div>
          </form>
        )}

        <p className="tc-section-title">
          {savedOnly ? "Saved" : "Recent"}
          {visible.length > 0 && <span>{visible.length}</span>}
        </p>
        <div className="tc-list" aria-label="Clipboard items">
          {visible.length ? (
            visible.map((clip) => {
              const isLink = clip.type === "text" && /^https?:\/\/\S+$/.test(clip.text);
              return (
                <div key={clip.id} className="tc-clip-card">
                  <div className="tc-clip-icon-box" aria-hidden="true">
                    {clip.type === "image" ? (
                      <ImageIcon className="size-3.5" />
                    ) : isLink ? (
                      <LinkIcon className="size-3.5" />
                    ) : (
                      <FileTextIcon className="size-3.5" />
                    )}
                  </div>
                  <button
                    type="button"
                    className="tc-clip-content-btn"
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
                        className="max-h-28 max-w-full rounded-md object-contain"
                      />
                    ) : (
                      <span className="tc-clip-text">{clip.text}</span>
                    )}
                    <div className="tc-clip-meta">
                      <span>
                        {new Date(clip.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {clip.pinned && <span className="tc-pinned-tag">★ Saved</span>}
                    </div>
                  </button>
                  <div className="tc-clip-actions">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Copy clipboard item"
                      onClick={() => void copy(clip)}
                    >
                      {copiedId === clip.id ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        <CopyIcon className="size-3.5" />
                      )}
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
              );
            })
          ) : (
            <div className="tc-empty">
              <TabsMascot mode="intro" eyeColor="var(--popover)" className="tc-empty-mascot" />
              <p className="tc-empty-title">
                {query
                  ? "No matching items"
                  : savedOnly
                    ? "No saved snippets yet"
                    : "Your clipboard starts here"}
              </p>
              <p className="tc-empty-description">
                {query ? "Try a different search." : "Paste text or images to keep them handy."}
              </p>
            </div>
          )}
        </div>

        <div className="tc-footer">
          <div className="tc-chips" role="group" aria-label="Clipboard filter">
            {[false, true].map((saved) => (
              <button
                key={String(saved)}
                type="button"
                aria-pressed={savedOnly === saved}
                onClick={() => setSavedOnly(saved)}
                className="tc-chip"
              >
                {saved ? "Saved" : "Recent"}
              </button>
            ))}
            <button
              type="button"
              className="tc-chip"
              aria-label="New note"
              aria-pressed={composing}
              onClick={() => setComposing((value) => !value)}
            >
              <PlusIcon className="size-3" aria-hidden="true" />
              Note
            </button>
          </div>
          <p role="status" className="tc-status-text">
            {status}
          </p>
          <DialogClose className="tc-close-hint" aria-label="Close">
            <kbd>esc</kbd>
            <span>to close</span>
          </DialogClose>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
