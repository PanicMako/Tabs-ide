import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface BrowserFindCounts {
  readonly matches: number;
  readonly activeMatch: number;
}

/** Text for the count beside the find box. */
export function findStatusLabel(query: string, counts: BrowserFindCounts | null): string {
  if (query.trim().length === 0 || counts === null) return "";
  return counts.matches === 0 ? "No matches" : `${counts.activeMatch} of ${counts.matches}`;
}

/**
 * Find in the page of a browser tab. It sits in its own row above the page
 * instead of floating over it, because the page is a native view that would
 * cover anything drawn on top.
 */
export function BrowserFindBar({
  find,
  onClose,
  focusTick,
}: {
  find: (
    text: string,
    direction: { forward: boolean; next: boolean },
  ) => Promise<BrowserFindCounts>;
  onClose: () => void;
  /** Changes each time the shortcut is pressed again, to put the cursor back in the box. */
  focusTick: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<BrowserFindCounts | null>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusTick]);

  useEffect(() => {
    let current = true;
    void find(query, { forward: true, next: false }).then((result) => {
      if (current) setCounts(result);
    });
    return () => {
      current = false;
    };
    // A new query starts a new search; the callback is stable enough for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const step = (forward: boolean) => {
    if (query.length === 0) return;
    void find(query, { forward, next: true }).then(setCounts);
  };

  return (
    <div
      role="search"
      aria-label="Find in page"
      className="flex items-center gap-1 border-b border-border bg-background px-2 py-1"
    >
      <input
        ref={input}
        type="search"
        aria-label="Find in page"
        placeholder="Find in page"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            step(!event.shiftKey);
          }
        }}
        className="h-7 min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
      />
      <span className="min-w-14 text-right text-xs text-muted-foreground" aria-live="polite">
        {findStatusLabel(query, counts)}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        className="companion-icon-button"
        onClick={() => step(false)}
      >
        <ChevronUpIcon size={14} />
      </button>
      <button
        type="button"
        aria-label="Next match"
        className="companion-icon-button"
        onClick={() => step(true)}
      >
        <ChevronDownIcon size={14} />
      </button>
      <button
        type="button"
        aria-label="Close find"
        className="companion-icon-button"
        onClick={onClose}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
