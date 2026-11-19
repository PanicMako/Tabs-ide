import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  clearFindHighlights,
  findTextRanges,
  nextMatchIndex,
  paintFindHighlights,
} from "~/lib/chatFind";

/** Find in the conversation: highlights every match, Enter for the next one, Escape to close. */
export function ChatFindBar({
  root,
  focusTick,
  onClose,
}: {
  root: RefObject<HTMLElement | null>;
  /** Changes each time the shortcut is pressed again, to put the cursor back in the box. */
  focusTick: number;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(-1);
  const ranges = useRef<Range[]>([]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusTick]);

  useEffect(() => () => clearFindHighlights(), []);

  const search = useCallback(
    (text: string, keepIndex: number) => {
      const element = root.current;
      ranges.current = element ? findTextRanges(element, text) : [];
      const next =
        ranges.current.length === 0
          ? -1
          : Math.min(Math.max(keepIndex, 0), ranges.current.length - 1);
      setCount(ranges.current.length);
      setIndex(next);
      if (ranges.current.length === 0) clearFindHighlights();
      else paintFindHighlights(ranges.current, next);
    },
    [root],
  );

  useEffect(() => {
    search(query, 0);
  }, [query, search]);

  const step = (direction: 1 | -1) => {
    // Messages may have arrived since the last search, so look again before moving.
    const before = ranges.current.length;
    search(query, index);
    if (ranges.current.length === 0) return;
    const from =
      ranges.current.length === before ? index : Math.min(index, ranges.current.length - 1);
    const next = nextMatchIndex(ranges.current.length, from, direction);
    setIndex(next);
    paintFindHighlights(ranges.current, next);
  };

  const status =
    query.trim().length === 0 ? "" : count === 0 ? "No matches" : `${index + 1} of ${count}`;

  return (
    <div
      role="search"
      aria-label="Conversation search"
      className="absolute top-2 right-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-popover px-2 py-1 text-popover-foreground shadow-md"
    >
      <input
        ref={input}
        type="search"
        aria-label="Find in conversation"
        placeholder="Find in conversation"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }
        }}
        className="h-7 w-48 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
      />
      <span
        role="status"
        aria-live="polite"
        className="min-w-16 text-right text-[11px] text-muted-foreground"
      >
        {status}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        disabled={count === 0}
        onClick={() => step(-1)}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <ChevronUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        disabled={count === 0}
        onClick={() => step(1)}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <ChevronDownIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Close find"
        onClick={onClose}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
