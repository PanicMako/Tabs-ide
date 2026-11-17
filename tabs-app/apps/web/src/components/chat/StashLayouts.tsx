import { useRef } from "react";
import { useStaggerIn } from "../agents/companion/designs/motion";
import {
  BookmarkPlusIcon,
  CheckIcon,
  CopyIcon,
  FileIcon,
  ImageIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  PencilIcon,
} from "lucide-react";
import { promptStashSnippet, promptStashText, type PromptStashEntry } from "~/promptStashStore";
import { formatRelativeTime } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { CompanionEmpty } from "../agents/companion/CompanionChrome";
import type { PromptStashController } from "./usePromptStash";
import { MessageEditor } from "./MessageEditor";

function when(entry: PromptStashEntry) {
  const { value, suffix } = formatRelativeTime(entry.createdAt);
  return `${value}${suffix ? ` ${suffix}` : ""}`;
}

function Toolbar({ stash }: { stash: PromptStashController }) {
  return (
    <div className="sl-toolbar">
      <label className="sl-search">
        <SearchIcon aria-hidden="true" size={14} />
        <input
          type="search"
          aria-label="Search saved drafts"
          placeholder={`Search ${stash.entries.length || ""} saved drafts`.replace("  ", " ")}
          value={stash.searchQuery}
          onChange={(event) => stash.setSearchQuery(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="sl-primary"
        disabled={!stash.activeThreadId || !stash.hasStashableDraft || stash.saving}
        title={stash.hasStashableDraft ? "Save the composer's draft here" : "The composer is empty"}
        onClick={() => void stash.stashCurrentDraft()}
      >
        {stash.saving ? (
          <LoaderCircleIcon aria-hidden="true" size={14} className="animate-spin" />
        ) : (
          <BookmarkPlusIcon aria-hidden="true" size={14} />
        )}
        Save draft
      </button>
      {stash.entries.length > 0 && (
        <button
          type="button"
          className="cd-icon"
          aria-label="Clear saved drafts in this environment"
          title="Clear saved drafts in this environment"
          onClick={() => void stash.clearAll()}
        >
          <Trash2Icon aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  );
}

function Attachments({ entry, limit }: { entry: PromptStashEntry; limit?: number }) {
  const images = entry.attachments.slice(0, limit);
  if (!images.length && !entry.files?.length) return null;
  return (
    <div className="sl-attachments">
      {images.map((image) => (
        <img
          key={image.id}
          src={image.dataUrl}
          alt={image.name}
          title={image.name}
          data-shape="tile"
        />
      ))}
      {limit !== undefined && entry.attachments.length > limit && (
        <span className="sl-more">+{entry.attachments.length - limit}</span>
      )}
      {entry.files?.map((file) => (
        <span key={file.id} className="sl-file" title={file.name}>
          <FileIcon aria-hidden="true" size={11} />
          {file.name}
          {!file.dataUrl && " · reattach"}
        </span>
      ))}
    </div>
  );
}

function Warnings({ entry }: { entry: PromptStashEntry }) {
  const missing = [...(entry.droppedImageNames ?? []), ...(entry.unreadableImageNames ?? [])];
  return (
    <>
      {!!entry.pendingImageCount && (
        <p role="status" className="sl-warning">
          Saving {entry.pendingImageCount} images…
        </p>
      )}
      {missing.length > 0 && <p className="sl-warning">Images not saved: {missing.join(", ")}</p>}
    </>
  );
}

const MOVE_TITLE =
  "Put this draft in the composer, replacing what is there, and take it off this list";
const ADD_TITLE = "Add this draft below what is already in the composer and keep it saved here";

function EditButton({ entry, stash }: { entry: PromptStashEntry; stash: PromptStashController }) {
  return (
    <button
      type="button"
      className="cd-icon"
      aria-label="Edit saved draft"
      title="Edit"
      aria-pressed={stash.editingId === entry.id}
      onClick={() => {
        stash.setSelectedId(entry.id);
        stash.setEditingId(stash.editingId === entry.id ? null : entry.id);
      }}
    >
      <PencilIcon aria-hidden="true" size={13} />
    </button>
  );
}

/** Edits a saved draft's text and images in place. */
function DraftEditor({ entry, stash }: { entry: PromptStashEntry; stash: PromptStashController }) {
  return (
    <MessageEditor
      label="Saved draft text"
      initialText={entry.prompt}
      images={entry.attachments.map((image) => ({
        id: image.id,
        name: image.name,
        src: image.dataUrl,
      }))}
      onSave={(edit) => stash.edit(entry.id, edit)}
      onCancel={() => stash.setEditingId(null)}
    />
  );
}

function Counts({ entry }: { entry: PromptStashEntry }) {
  return (
    <>
      {entry.attachments.length > 0 && (
        <span className="sl-count">
          <ImageIcon aria-hidden="true" size={11} />
          {entry.attachments.length}
        </span>
      )}
      {(entry.files?.length ?? 0) > 0 && (
        <span className="sl-count">
          <FileIcon aria-hidden="true" size={11} />
          {entry.files!.length}
        </span>
      )}
    </>
  );
}

/** Small thumbnails that sit in a row, ahead of the text. */
export function RowThumbs({
  images,
}: {
  images: ReadonlyArray<{ id: string; name: string; src: string }>;
}) {
  if (!images.length) return null;
  return (
    <span className="ql-thumbs" aria-label={`${images.length} images`}>
      {images.slice(0, 3).map((image) => (
        <img key={image.id} src={image.src} alt="" title={image.name} data-shape="tile" />
      ))}
      {images.length > 3 && <span className="ql-thumbs-more">+{images.length - 3}</span>}
    </span>
  );
}

/** C · Ledger. One row per draft, like the queue's ledger: images, the text, when it was saved. */
function LedgerView({ stash }: { stash: PromptStashController }) {
  return (
    <div className="ql-ledger sl-ledger" role="table" aria-label="Saved drafts">
      <div className="ql-ledger-head" role="row">
        <span role="columnheader">Draft</span>
        <span role="columnheader">Saved</span>
        <span role="columnheader">
          <span className="sr-only">Actions</span>
        </span>
      </div>
      {stash.filteredEntries.map((entry) => {
        const open = stash.selectedId === entry.id;
        const blocked = !stash.activeThreadId || Boolean(entry.pendingImageCount);
        return (
          <div key={entry.id} className="ql-ledger-row" role="row" data-open={open}>
            <div role="cell" className="ql-ledger-cell">
              <RowThumbs
                images={entry.attachments.map((image) => ({
                  id: image.id,
                  name: image.name,
                  src: image.dataUrl,
                }))}
              />
              <button
                type="button"
                className="ql-ledger-text"
                data-open={open}
                aria-expanded={open}
                onClick={() => stash.setSelectedId(open ? null : entry.id)}
              >
                {open
                  ? promptStashText(entry) || promptStashSnippet(entry)
                  : promptStashSnippet(entry)}
              </button>
              {(entry.files?.length ?? 0) > 0 && <Counts entry={{ ...entry, attachments: [] }} />}
            </div>
            <span role="cell">
              <time className="ql-time" dateTime={entry.createdAt}>
                {when(entry)}
              </time>
            </span>
            <span role="cell" className="ql-actions">
              <button
                type="button"
                className="ql-text-action"
                disabled={blocked}
                title={MOVE_TITLE}
                onClick={() => void stash.restore(entry)}
              >
                Move to composer
              </button>
              <button
                type="button"
                className="cd-icon"
                aria-label="Add to current draft"
                title={ADD_TITLE}
                disabled={blocked}
                onClick={() => void stash.restore(entry, "append")}
              >
                <PlusIcon aria-hidden="true" size={13} />
              </button>
              <EditButton entry={entry} stash={stash} />
              <button
                type="button"
                className="cd-icon"
                aria-label="Copy saved draft text"
                title="Copy text"
                onClick={() => void stash.copy(entry)}
              >
                {stash.copiedId === entry.id ? (
                  <CheckIcon aria-hidden="true" size={13} />
                ) : (
                  <CopyIcon aria-hidden="true" size={13} />
                )}
              </button>
              <button
                type="button"
                className="cd-icon sl-danger"
                aria-label="Delete saved draft"
                title="Delete"
                onClick={() => stash.remove(entry.id)}
              >
                <Trash2Icon aria-hidden="true" size={13} />
              </button>
            </span>
            {stash.editingId === entry.id ? (
              <div className="ql-ledger-extra" role="cell">
                <DraftEditor entry={entry} stash={stash} />
              </div>
            ) : open &&
              (entry.files?.length ||
                entry.pendingImageCount ||
                entry.droppedImageNames?.length) ? (
              <div className="ql-ledger-extra" role="cell">
                <Attachments entry={{ ...entry, attachments: [] }} />
                <Warnings entry={entry} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The side panel's stash: a search, then one ledger row per saved draft. */
export function StashLedgerView({
  stash,
  className,
}: {
  stash: PromptStashController;
  className?: string | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  useStaggerIn(root, ".ql-ledger-row", "mount", { y: 8 });
  return (
    <div ref={root} className={cn("companion-stash sl-root", className)}>
      <Toolbar stash={stash} />
      {!stash.entries.length ? (
        <CompanionEmpty kind="stash" title="Nothing saved yet">
          Save a draft with its images and files, then bring it back when you’re ready.
        </CompanionEmpty>
      ) : !stash.filteredEntries.length ? (
        <p role="status" className="sl-none">
          No drafts match “{stash.searchQuery}”.
        </p>
      ) : (
        <LedgerView stash={stash} />
      )}
    </div>
  );
}
