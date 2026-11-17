import { useMemo, useState, useCallback, useRef } from "react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import {
  usePromptStashStore,
  partitionStashAttachments,
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
import { randomUUID } from "~/lib/utils";
import { toastManager } from "../ui/toast";
import { showCustomConfirm } from "~/lib/customConfirm";
import { appendTerminalContextsToPrompt } from "~/lib/terminalContext";
import { appendPreviewAnnotationPrompt } from "~/lib/previewAnnotation";
import { appendReviewCommentsToPrompt } from "~/reviewCommentContext";
import type { MessageEdit } from "./MessageEditor";

export interface PromptStashOptions {
  activeThreadId?: ThreadId | null | undefined;
  currentEnvironmentId?: EnvironmentId | null | undefined;
  onLoadedIntoComposer?: (() => void) | undefined;
}

/** Everything the stash does, without any of how it looks. Each stash layout renders from this. */
export function usePromptStash({
  activeThreadId,
  currentEnvironmentId,
  onLoadedIntoComposer,
}: PromptStashOptions) {
  const entries = usePromptStashStore((state) => state.entries);
  const takeStash = usePromptStashStore((state) => state.take);
  const stashEntry = usePromptStashStore((state) => state.stashEntry);
  const removeStash = usePromptStashStore((state) => state.remove);
  const clearStash = usePromptStashStore((state) => state.clear);
  const updateStashEntry = usePromptStashStore((state) => state.updateEntry);

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
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const handleEdit = useCallback(
    async (entryId: string, edit: MessageEdit) => {
      const entry = usePromptStashStore.getState().entries.find((item) => item.id === entryId);
      if (!entry) return false;
      let added;
      try {
        added = await Promise.all(
          edit.addedImages.map(async (file) => ({
            id: randomUUID(),
            name: file.name || "image",
            mimeType: file.type || "image/png",
            sizeBytes: file.size,
            dataUrl: await readFileAsDataUrl(file),
          })),
        );
      } catch {
        toastManager.add({ type: "error", title: "An image could not be read" });
        return false;
      }
      const attachments = [
        ...edit.keptImageIds.flatMap((id) => entry.attachments.filter((image) => image.id === id)),
        ...added,
      ];
      if (partitionStashAttachments(attachments).droppedNames.length) {
        toastManager.add({
          type: "error",
          title: "Images are too large to save",
          description: "The draft is unchanged. Use smaller images.",
        });
        return false;
      }
      const result = updateStashEntry(entryId, { prompt: edit.text, attachments });
      if (!result.updated) return false;
      if (!result.durable)
        toastManager.add({
          type: "warning",
          title: "Edit saved for this session",
          description: "Browser storage is unavailable, so the change will not survive a reload.",
        });
      return true;
    },
    [updateStashEntry],
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

  return {
    activeThreadId,
    currentEnvironmentId,
    entries,
    filteredEntries,
    searchQuery,
    setSearchQuery,
    selectedId,
    setSelectedId,
    editingId,
    setEditingId,
    saving,
    copiedId,
    hasStashableDraft,
    restore: handleRestore,
    stashCurrentDraft: handleStashCurrentDraft,
    copy: handleCopy,
    remove: handleDelete,
    edit: handleEdit,
    clearAll: handleClearAll,
  };
}

export type PromptStashController = ReturnType<typeof usePromptStash>;
