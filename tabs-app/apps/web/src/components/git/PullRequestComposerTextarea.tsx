import type { PullRequestActor, PullRequestReferenceCandidate } from "@tabs/contracts";
import {
  debouncedPullRequestCompletionSearch,
  detectPullRequestComposerTrigger,
  insertPullRequestCompletion,
  pullRequestCompletionKey,
  pullRequestCompletions,
  type PullRequestCompletion,
  type PullRequestCompletionSupport,
  type PullRequestComposerTrigger,
} from "@tabs/shared/pullRequestComposerTrigger";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

const COMPLETION_LIMIT = 8;
const DEBOUNCE_MS = 200;

/**
 * A comment box that completes `@login` and `#123` as they are typed, from what the host offers.
 * The text stays plain: a completion only inserts the token, and anything may still be typed.
 */
export function PullRequestComposerTextarea({
  id,
  value,
  onValueChange,
  placeholder,
  className,
  support,
  searchMentions,
  searchReferences,
  disabled,
  rows,
}: {
  id?: string | undefined;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string | undefined;
  className?: string | undefined;
  /** What the host completes; with nothing, this is an ordinary text box. */
  support: PullRequestCompletionSupport;
  searchMentions?: ((query: string) => Promise<ReadonlyArray<PullRequestActor>>) | undefined;
  searchReferences?:
    | ((query: string, sigil: "#" | "!") => Promise<ReadonlyArray<PullRequestReferenceCandidate>>)
    | undefined;
  disabled?: boolean | undefined;
  rows?: number | undefined;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const listId = useId();
  const [cursor, setCursor] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [debouncedKey, setDebouncedKey] = useState<string | null>(null);
  const [options, setOptions] = useState<{
    authors: ReadonlyArray<PullRequestActor>;
    references: ReadonlyArray<PullRequestReferenceCandidate>;
  }>({ authors: [], references: [] });

  const detected = detectPullRequestComposerTrigger(value, cursor, support);
  const trigger: PullRequestComposerTrigger | null =
    detected !== null && detected.rangeStart !== dismissedAt ? detected : null;
  const key = pullRequestCompletionKey(trigger);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces the host search while typing
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKey(key), key === null ? 0 : DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [key]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the host's names for the typed sigil
  useEffect(() => {
    if (trigger === null) return;
    const query = debouncedPullRequestCompletionSearch(trigger, debouncedKey) ?? "";
    let stale = false;
    if (trigger.kind === "mention") {
      void searchMentions?.(query)
        .then((authors) => !stale && setOptions((current) => ({ ...current, authors })))
        .catch(() => undefined);
    } else {
      void searchReferences?.(query, trigger.sigil)
        .then((references) => !stale && setOptions((current) => ({ ...current, references })))
        .catch(() => undefined);
    }
    return () => {
      stale = true;
    };
    // The search follows the debounced key, not every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey]);

  const completions: ReadonlyArray<PullRequestCompletion> = pullRequestCompletions(
    trigger,
    options,
    COMPLETION_LIMIT,
  );
  const open = trigger !== null && completions.length > 0;

  const choose = (completion: PullRequestCompletion) => {
    if (trigger === null) return;
    const next = insertPullRequestCompletion(value, trigger, completion.token);
    onValueChange(next.text);
    setCursor(next.cursor);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + completions.length) % completions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const chosen = completions[Math.min(active, completions.length - 1)];
      if (chosen) choose(chosen);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissedAt(trigger?.rangeStart ?? null);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        id={id}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        role={open ? "combobox" : undefined}
        aria-expanded={open || undefined}
        aria-controls={open ? listId : undefined}
        aria-autocomplete={open ? "list" : undefined}
        onChange={(event) => {
          onValueChange(event.target.value);
          setCursor(event.target.selectionStart);
          setActive(0);
        }}
        onKeyUp={(event) => setCursor(event.currentTarget.selectionStart)}
        onClick={(event) => setCursor(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md"
        >
          {completions.map((completion, index) => (
            <li
              key={completion.token}
              role="option"
              aria-selected={index === active}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${
                index === active ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(completion);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {completion.kind === "mention" ? (
                <>
                  <span className="font-medium">@{completion.actor.login}</span>
                  {completion.actor.name ? (
                    <span className="truncate text-muted-foreground">{completion.actor.name}</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="font-medium">{completion.candidate.reference}</span>
                  <span className="truncate">{completion.candidate.title}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {completion.candidate.state}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
