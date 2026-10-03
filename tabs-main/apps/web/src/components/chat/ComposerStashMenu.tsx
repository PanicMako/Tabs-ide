import { BookmarkIcon, FileIcon, FileTextIcon, Trash2Icon, XIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@tabs/contracts";
import { formatRelativeTime } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { promptStashSnippet, type PromptStashEntry } from "~/promptStashStore";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";

export interface ComposerStashMenuProps {
  entries: ReadonlyArray<PromptStashEntry>;
  isOpen: boolean;
  currentEnvironmentId?: EnvironmentId | null | undefined;
  stashShortcutLabel?: string | null | undefined;
  onRestore: (entry: PromptStashEntry) => void;
  onDelete: (entry: PromptStashEntry) => void;
  onClearAll?: (() => void) | undefined;
  onClose: () => void;
  className?: string | undefined;
}

export const ComposerStashMenu = memo(function ComposerStashMenu({
  entries,
  isOpen,
  currentEnvironmentId,
  stashShortcutLabel,
  onRestore,
  onDelete,
  onClearAll,
  onClose,
  className,
}: ComposerStashMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(entries[0]?.id ?? null);

  useEffect(() => {
    if (entries.length > 0 && (!highlightedId || !entries.some((e) => e.id === highlightedId))) {
      setHighlightedId(entries[0]?.id ?? null);
    }
  }, [entries, highlightedId]);

  const highlightedEntry = entries.find((entry) => entry.id === highlightedId) ?? entries[0];

  // Outside click listener
  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (event: PointerEvent) => {
      const container = containerRef.current;
      if (
        (container && event.composedPath().includes(container)) ||
        (event.target instanceof Element &&
          event.target.closest('[data-prompt-stash-badge="true"]'))
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", handleOutside, true);
    return () => document.removeEventListener("pointerdown", handleOutside, true);
  }, [isOpen, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (entries.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = entries.findIndex((entry) => entry.id === highlightedEntry?.id);
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const normalizedIndex = currentIndex >= 0 ? currentIndex : offset === 1 ? -1 : 0;
        const nextIndex = (normalizedIndex + offset + entries.length) % entries.length;
        const nextEntry = entries[nextIndex];
        if (nextEntry) {
          setHighlightedId(nextEntry.id);
          const nextButton = containerRef.current?.querySelector<HTMLButtonElement>(
            `[data-stash-restore="${nextEntry.id}"]`,
          );
          nextButton?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

      if (event.key === "Enter") {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("button[data-stash-delete]")
        ) {
          return;
        }
        if (!highlightedEntry) return;
        event.preventDefault();
        event.stopPropagation();
        onRestore(highlightedEntry);
        return;
      }

      if (event.key === "Backspace" && (event.metaKey || event.ctrlKey)) {
        if (!highlightedEntry) return;
        event.preventDefault();
        event.stopPropagation();
        onDelete(highlightedEntry);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, entries, highlightedEntry, onClose, onDelete, onRestore]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Stashed Prompts"
      data-composer-stash-drawer="true"
      className={cn(
        "absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-border/80 bg-popover/95 text-popover-foreground shadow-xl backdrop-blur-md",
        "animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <BookmarkIcon className="size-3.5 text-foreground" />
          <span>Stashed Prompts</span>
          <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] tabular-nums text-muted-foreground">
            {entries.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {entries.length > 1 && onClearAll && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <Trash2Icon className="mr-1 size-3" />
              Clear all
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close stash menu"
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="max-h-72 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Nothing stashed yet.
            {stashShortcutLabel ? (
              <span className="mt-1 block text-[11px]">
                Press{" "}
                <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[10px]">
                  {stashShortcutLabel}
                </kbd>{" "}
                with a prompt in the composer to stash it.
              </span>
            ) : null}
          </div>
        ) : (
          <ul
            role="list"
            aria-label="Stashed prompts list"
            className="divide-y divide-border/40 p-1"
          >
            {entries.map((entry) => {
              const isHighlighted = highlightedEntry?.id === entry.id;
              const { value: timeVal, suffix: timeSuffix } = formatRelativeTime(entry.createdAt);
              const isDifferentEnvironment =
                entry.environmentId &&
                currentEnvironmentId &&
                entry.environmentId !== currentEnvironmentId;

              return (
                <li
                  key={entry.id}
                  data-stash-entry={entry.id}
                  data-highlighted={isHighlighted || undefined}
                  onMouseMove={() => {
                    if (highlightedId !== entry.id) setHighlightedId(entry.id);
                  }}
                  className={cn(
                    "group relative flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 transition-colors",
                    isHighlighted ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
                  )}
                >
                  <button
                    type="button"
                    data-stash-restore={entry.id}
                    onClick={() => onRestore(entry)}
                    aria-label={`Restore stashed prompt: ${promptStashSnippet(entry)}`}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left outline-none cursor-pointer"
                  >
                    <FileTextIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-xs font-normal leading-relaxed text-foreground">
                        {promptStashSnippet(entry)}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>
                          {timeVal} {timeSuffix ?? ""}
                        </span>
                        {isDifferentEnvironment && (
                          <span className="rounded bg-muted px-1 text-[9px] font-mono text-muted-foreground">
                            {entry.environmentId}
                          </span>
                        )}
                        {entry.attachments.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            · {entry.attachments.length} image
                            {entry.attachments.length === 1 ? "" : "s"}
                          </span>
                        )}
                        {(entry.files?.length ?? 0) > 0 && (
                          <span className="flex items-center gap-0.5">
                            · <FileIcon className="size-2.5" />
                            {entry.files!.length}
                          </span>
                        )}
                        {(entry.droppedImageNames?.length ?? 0) > 0 && (
                          <span className="text-warning-foreground">
                            · {entry.droppedImageNames!.length} dropped
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5 pl-2">
                    {entry.attachments.length > 0 && (
                      <div className="flex -space-x-1">
                        {entry.attachments.slice(0, 3).map((att) => (
                          <img
                            key={att.id}
                            src={att.dataUrl}
                            alt=""
                            aria-hidden
                            className="size-5 rounded border border-border/80 object-cover"
                          />
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-stash-delete="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(entry);
                      }}
                      aria-label="Delete stashed prompt"
                      className="size-6 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
});
