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
import { memo, useMemo, useState, useCallback, useRef } from "react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import {
  usePromptStashStore,
  partitionStashAttachments,
  promptStashSnippet,
  type PromptStashEntry,
} from "~/promptStashStore";
import { hydrateImagesFromPersisted, useComposerDraftStore } from "~/composerDraftStore";
import {
  useComposerDraft,
  createScopedComposerDraftActions,
  composerDraftActions,
  scopedComposerThreadId,
} from "~/state/composerDrafts";
import { readFileAsDataUrl } from "~/components/ChatView.logic";
import { formatRelativeTime } from "~/timestampFormat";
import { cn, randomUUID } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { CompanionEmpty } from "../agents/companion/CompanionChrome";
import { showCustomConfirm } from "~/lib/customConfirm";
import { appendTerminalContextsToPrompt } from "~/lib/terminalContext";
import { appendPreviewAnnotationPrompt } from "~/lib/previewAnnotation";
import { appendReviewCommentsToPrompt } from "~/reviewCommentContext";

export interface PromptStashPanelProps {
  activeThreadId?: ThreadId | null | undefined;
  currentEnvironmentId?: EnvironmentId | null | undefined;
  onLoadedIntoComposer?: (() => void) | undefined;
  className?: string | undefined;
}

export const PromptStashPanel = memo(function PromptStashPanel({
  activeThreadId,
  currentEnvironmentId,
  onLoadedIntoComposer,
  className,
}: PromptStashPanelProps) {
  const entries = usePromptStashStore((state) => state.entries);
  const takeStash = usePromptStashStore((state) => state.take);
  const stashEntry = usePromptStashStore((state) => state.stashEntry);
  const removeStash = usePromptStashStore((state) => state.remove);
  const clearStash = usePromptStashStore((state) => state.clear);

  const fallbackThreadId = activeThreadId ?? ("" as ThreadId);
  const currentDraft = useComposerDraft(fallbackThreadId, currentEnvironmentId);
  const existingDraftPrompt = currentDraft?.prompt ?? "";
  const existingDraftImages = currentDraft?.images ?? [];
  const hasStashableDraft =
    existingDraftPrompt.trim().length > 0 ||
    existingDraftImages.length > 0 ||
    (currentDraft?.files.length ?? 0) > 0 ||
    (currentDraft?.terminalContexts.length ?? 0) > 0 ||
    (currentDraft?.previewAnnotations.length ?? 0) > 0 ||
    (currentDraft?.reviewComments.length ?? 0) > 0;

  const draftActions = useMemo(
    () =>
      currentEnvironmentId
        ? createScopedComposerDraftActions(currentEnvironmentId)
        : composerDraftActions,
    [currentEnvironmentId],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (entry) =>
        entry.prompt.toLowerCase().includes(q) ||
        entry.attachments.some((image) => image.name.toLowerCase().includes(q)) ||
        entry.files?.some((file) => file.name.toLowerCase().includes(q)) ||
        (entry.environmentId && entry.environmentId.toLowerCase().includes(q)),
    );
  }, [entries, searchQuery]);

  const handleRestore = useCallback(
    async (entry: PromptStashEntry, mode: "replace" | "append" = "replace") => {
      if (!activeThreadId) {
        toastManager.add({
          type: "warning",
          title: "No active thread",
          description: "Select or open a thread to load this stashed prompt into.",
        });
        return;
      }

      if (entry.pendingImageCount) return;
      if (
        entry.environmentId &&
        currentEnvironmentId &&
        entry.environmentId !== currentEnvironmentId
      ) {
        toastManager.add({ type: "warning", title: "Open this draft’s environment to restore it" });
        return;
      }
      if (
        mode === "replace" &&
        (existingDraftPrompt.trim() ||
          existingDraftImages.length ||
          currentDraft?.files.length ||
          currentDraft?.terminalContexts.length ||
          currentDraft?.previewAnnotations.length ||
          currentDraft?.reviewComments.length) &&
        !(await showCustomConfirm(
          "Replace the current composer draft with this saved prompt? Use Add to keep both.",
        ))
      )
        return;
      if (entry.files?.some((file) => !file.dataUrl)) {
        toastManager.add({
          type: "warning",
          title: "Reattach saved file references",
          description: entry
            .files!.filter((file) => !file.dataUrl)
            .map((file) => file.name)
            .join(", "),
        });
      }
      const restoredImages = hydrateImagesFromPersisted(entry.attachments);
      if (restoredImages.length !== entry.attachments.length) {
        toastManager.add({
          type: "error",
          title: "A saved image could not be read",
          description:
            "The saved draft is kept. Copy its text and reattach the image in the composer.",
        });
        return;
      }
      const restoredFiles = hydrateImagesFromPersisted(
        (entry.files ?? []).flatMap((file) =>
          file.dataUrl ? [{ ...file, dataUrl: file.dataUrl }] : [],
        ),
      ).map((file) => ({ ...file, type: "file" as const }));
      if (restoredFiles.length !== (entry.files ?? []).filter((file) => file.dataUrl).length) {
        toastManager.add({
          type: "error",
          title: "A saved file could not be read",
          description:
            "The saved draft is kept. Copy its text and reattach the file in the composer.",
        });
        return;
      }
      if (mode === "replace") {
        draftActions.clearComposerContent(activeThreadId);
        draftActions.setPrompt(activeThreadId, entry.prompt);
        if (entry.attachments.length > 0) {
          const restored = restoredImages;
          if (restored.length > 0) {
            draftActions.addImages(activeThreadId, restored);
          }
        }
        // Take from stash (pops it from stash after loading)
        takeStash(entry.id);
        toastManager.add({
          type: "success",
          title: "Draft restored",
        });
      } else {
        const nextPrompt = existingDraftPrompt.trim()
          ? `${existingDraftPrompt.trim()}\n\n${entry.prompt}`
          : entry.prompt;
        draftActions.setPrompt(activeThreadId, nextPrompt);
        if (entry.attachments.length > 0) {
          const restored = restoredImages;
          if (restored.length > 0) {
            draftActions.addImages(activeThreadId, restored);
          }
        }
        toastManager.add({
          type: "success",
          title: "Added to draft",
        });
      }

      if (restoredFiles.length) draftActions.addFiles(activeThreadId, restoredFiles);
      onLoadedIntoComposer?.();
    },
    [
      activeThreadId,
      draftActions,
      existingDraftPrompt,
      onLoadedIntoComposer,
      takeStash,
      existingDraftImages.length,
      currentDraft,
      currentEnvironmentId,
    ],
  );

  const handleStashCurrentDraft = useCallback(async () => {
    if (!activeThreadId || !hasStashableDraft || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const draftKey = currentEnvironmentId
      ? scopedComposerThreadId(currentEnvironmentId, activeThreadId)
      : activeThreadId;
    const originalDraft = useComposerDraftStore.getState().draftsByThreadId[draftKey];
    try {
      const persistedImages = await Promise.all(
        existingDraftImages.map(async (img) => ({
          id: img.id,
          name: img.name,
          mimeType: img.mimeType,
          sizeBytes: img.sizeBytes,
          dataUrl: await readFileAsDataUrl(img.file),
        })),
      );

      if (partitionStashAttachments(persistedImages).droppedNames.length)
        throw new Error(
          "Images are too large to stash. Your draft is unchanged; use smaller images before saving.",
        );
      const persistedFiles = await Promise.all(
        (currentDraft?.files ?? []).map(async (file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          dataUrl: await readFileAsDataUrl(file.file),
        })),
      );
      const result = stashEntry({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        prompt: appendReviewCommentsToPrompt(
          (currentDraft?.previewAnnotations ?? []).reduce(
            (text, annotation) => appendPreviewAnnotationPrompt(text, annotation),
            appendTerminalContextsToPrompt(
              existingDraftPrompt,
              currentDraft?.terminalContexts ?? [],
            ),
          ),
          currentDraft?.reviewComments ?? [],
        ),
        ...(currentEnvironmentId ? { environmentId: currentEnvironmentId } : {}),
        ...(activeThreadId ? { threadId: activeThreadId } : {}),
        attachments: persistedImages,
        files: persistedFiles,
      });

      if (!result.written) throw new Error("Storage quota exceeded. Your draft has been kept.");
      if (!result.durable)
        toastManager.add({
          type: "warning",
          title: "Stash is saved for this session",
          description: "Browser storage is unavailable. This prompt will not survive a reload.",
        });
      if (useComposerDraftStore.getState().draftsByThreadId[draftKey] !== originalDraft) return;
      draftActions.clearComposerContent(activeThreadId);
      toastManager.add({
        type: "success",
        title: "Prompt stashed",
        description: "Draft saved to stash.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save draft",
        description: error instanceof Error ? error.message : "Your draft has been kept.",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    activeThreadId,
    currentEnvironmentId,
    currentDraft,
    draftActions,
    existingDraftImages,
    existingDraftPrompt,
    hasStashableDraft,
    stashEntry,
  ]);

  const handleCopy = useCallback(async (entry: PromptStashEntry) => {
    try {
      await navigator.clipboard.writeText(entry.prompt);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
      toastManager.add({
        type: "success",
        title: "Copied to clipboard",
        description: "Stashed prompt text copied.",
      });
    } catch {
      toastManager.add({
        type: "error",
        title: "Could not copy",
        description: "Clipboard access was denied.",
      });
    }
  }, []);

  const handleDelete = useCallback(
    (entryId: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      removeStash(entryId);
      toastManager.add({
        type: "info",
        title: "Stash deleted",
        description: "Removed prompt from stash.",
      });
    },
    [removeStash],
  );

  const handleClearAll = useCallback(async () => {
    if (!(await showCustomConfirm("Delete the saved prompts in this environment?"))) return;
    clearStash(currentEnvironmentId ?? undefined);
    toastManager.add({
      type: "info",
      title: "Stash cleared",
      description: "All stashed prompts have been removed.",
    });
  }, [clearStash, currentEnvironmentId]);

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
                {expanded && entry.prompt && <p className="stash-draft-text">{entry.prompt}</p>}
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
