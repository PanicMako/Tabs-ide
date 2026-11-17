import {
  BookmarkPlusIcon,
  CopyIcon,
  FileIcon,
  SearchIcon,
  Trash2Icon,
  Undo2Icon,
  PlusIcon,
  ChevronDownIcon,
  CheckIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { memo } from "react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { promptStashSnippet, promptStashText } from "~/promptStashStore";
import { formatRelativeTime } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CompanionEmpty } from "../agents/companion/CompanionChrome";
import { usePromptStash } from "./usePromptStash";
import { StashLedgerView } from "./StashLayouts";

export interface PromptStashPanelProps {
  activeThreadId?: ThreadId | null | undefined;
  currentEnvironmentId?: EnvironmentId | null | undefined;
  onLoadedIntoComposer?: (() => void) | undefined;
  /** "ledger" is the side panel's compact rows; without it the full panel shows. */
  variant?: "ledger" | undefined;
  className?: string | undefined;
}

export const PromptStashPanel = memo(function PromptStashPanel({
  activeThreadId,
  currentEnvironmentId,
  onLoadedIntoComposer,
  variant,
  className,
}: PromptStashPanelProps) {
  const stash = usePromptStash({ activeThreadId, currentEnvironmentId, onLoadedIntoComposer });
  const {
    entries,
    filteredEntries,
    searchQuery,
    setSearchQuery,
    selectedId,
    setSelectedId,
    saving,
    copiedId,
    hasStashableDraft,
    restore: handleRestore,
    stashCurrentDraft: handleStashCurrentDraft,
    copy: handleCopy,
    remove: handleDelete,
    clearAll: handleClearAll,
  } = stash;
  if (variant === "ledger") return <StashLedgerView stash={stash} className={className} />;

  return (
    <div className={cn("companion-stash flex h-full min-h-0 flex-col text-foreground", className)}>
      <div className="companion-toolbar stash-toolbar">
        <SearchIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Search saved drafts"
          placeholder="Find a draft…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="stash-search"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!activeThreadId || !hasStashableDraft || saving}
          onClick={() => void handleStashCurrentDraft()}
          title="Save the current draft"
          aria-label="Save current draft"
        >
          {saving ? (
            <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <BookmarkPlusIcon className="size-3.5" />
          )}{" "}
          Save
        </Button>
        {entries.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Clear saved drafts in this environment"
            title="Clear saved drafts in this environment"
            onClick={() => void handleClearAll()}
          >
            <Trash2Icon size={14} />
          </Button>
        )}
      </div>
      {!entries.length ? (
        <CompanionEmpty kind="stash" title="For later">
          Save a draft with its images and files. Bring it back when you’re ready.
        </CompanionEmpty>
      ) : (
        <div className="stash-drafts">
          {!filteredEntries.length && (
            <p role="status" className="companion-note">
              No drafts match “{searchQuery}”.
            </p>
          )}
          {filteredEntries.map((entry) => {
            const expanded = selectedId === entry.id;
            const { value, suffix } = formatRelativeTime(entry.createdAt);
            const missing = [
              ...(entry.droppedImageNames ?? []),
              ...(entry.unreadableImageNames ?? []),
            ];
            const pending = Boolean(entry.pendingImageCount);
            return (
              <article key={entry.id} className="stash-draft">
                <button
                  type="button"
                  className="stash-draft-heading"
                  aria-label={`Preview saved draft: ${promptStashSnippet(entry)}`}
                  aria-expanded={expanded}
                  onClick={() => setSelectedId(expanded ? null : entry.id)}
                >
                  <span className="stash-draft-title">{promptStashSnippet(entry)}</span>
                  <ChevronDownIcon
                    size={14}
                    className={expanded ? "rotate-180 shrink-0" : "shrink-0"}
                    aria-hidden="true"
                  />
                </button>
                <div className="stash-draft-meta">
                  <time dateTime={entry.createdAt}>
                    {value} {suffix ?? ""}
                  </time>
                  {entry.environmentId && entry.environmentId !== currentEnvironmentId && (
                    <span>Other environment</span>
                  )}
                </div>
                {expanded && promptStashText(entry) && (
                  <p className="stash-draft-text">{promptStashText(entry)}</p>
                )}
                {entry.attachments.length > 0 && (
                  <div className="stash-images">
                    {entry.attachments.slice(0, expanded ? undefined : 3).map((image) => (
                      <figure key={image.id}>
                        <img src={image.dataUrl} alt={image.name} />
                        <figcaption title={image.name}>{image.name}</figcaption>
                      </figure>
                    ))}
                    {!expanded && entry.attachments.length > 3 && (
                      <span>+{entry.attachments.length - 3}</span>
                    )}
                  </div>
                )}
                {(entry.files?.length ?? 0) > 0 && (
                  <div className="stash-files">
                    {entry.files!.map((file) => (
                      <span key={file.id} title={file.name}>
                        <FileIcon size={12} aria-hidden="true" />
                        {file.name}
                        {!file.dataUrl && " · reattach"}
                      </span>
                    ))}
                  </div>
                )}
                {pending && (
                  <p role="status" className="stash-draft-warning">
                    Saving {entry.pendingImageCount} images…
                  </p>
                )}
                {missing.length > 0 && (
                  <p className="stash-draft-warning">Images not saved: {missing.join(", ")}</p>
                )}
                <div className="stash-draft-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!activeThreadId || pending}
                    onClick={() => void handleRestore(entry)}
                  >
                    <Undo2Icon size={13} />
                    Restore
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!activeThreadId || pending}
                    onClick={() => void handleRestore(entry, "append")}
                    title="Add to the current draft without removing this saved copy"
                  >
                    <PlusIcon size={13} />
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7"
                    aria-label="Copy saved draft text"
                    onClick={() => void handleCopy(entry)}
                  >
                    {copiedId === entry.id ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    aria-label="Delete saved draft"
                    onClick={() => handleDelete(entry.id)}
                  >
                    <Trash2Icon size={13} />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
});
