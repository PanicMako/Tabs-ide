import {
  BookmarkIcon,
  BookmarkPlusIcon,
  CopyIcon,
  FileIcon,
  FileTextIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  Undo2Icon,
  CheckIcon,
} from "lucide-react";
import { memo, useMemo, useState, useCallback } from "react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { usePromptStashStore, promptStashSnippet, type PromptStashEntry } from "~/promptStashStore";
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
import { ScrollArea } from "../ui/scroll-area";
import { toastManager } from "../ui/toast";
import { CompanionEmpty } from "../agents/companion/CompanionChrome";
import { showCustomConfirm } from "~/lib/customConfirm";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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
    (currentDraft?.files.length ?? 0) > 0;

  const draftActions = useMemo(
    () =>
      currentEnvironmentId
        ? createScopedComposerDraftActions(currentEnvironmentId)
        : composerDraftActions,
    [currentEnvironmentId],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (entry) =>
        entry.prompt.toLowerCase().includes(q) ||
        (entry.environmentId && entry.environmentId.toLowerCase().includes(q)),
    );
  }, [entries, searchQuery]);

  const activeEntry = useMemo(() => {
    return (
      filteredEntries.find((e) => e.id === selectedId) ??
      filteredEntries[0] ??
      entries.find((e) => e.id === selectedId) ??
      entries[0] ??
      null
    );
  }, [filteredEntries, entries, selectedId]);

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

      if (
        mode === "replace" &&
        (existingDraftPrompt.trim() ||
          existingDraftImages.length ||
          currentDraft?.files.length ||
          currentDraft?.terminalContexts.length ||
          currentDraft?.previewAnnotations.length) &&
        !(await showCustomConfirm(
          "Replace the current composer draft with this saved prompt? Use Append to keep both.",
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
      const restoredFiles = hydrateImagesFromPersisted(
        (entry.files ?? []).flatMap((file) =>
          file.dataUrl ? [{ ...file, dataUrl: file.dataUrl }] : [],
        ),
      ).map((file) => ({ ...file, type: "file" as const }));
      if (mode === "replace") {
        draftActions.clearComposerContent(activeThreadId);
        draftActions.setPrompt(activeThreadId, entry.prompt);
        if (entry.attachments.length > 0) {
          const restored = hydrateImagesFromPersisted(entry.attachments);
          if (restored.length > 0) {
            draftActions.addImages(activeThreadId, restored);
          }
        }
        // Take from stash (pops it from stash after loading)
        takeStash(entry.id);
        toastManager.add({
          type: "success",
          title: "Unstashed prompt into composer",
          description: `Loaded "${promptStashSnippet(entry).slice(0, 40)}..."`,
        });
      } else {
        const nextPrompt = existingDraftPrompt.trim()
          ? `${existingDraftPrompt.trim()}\n\n${entry.prompt}`
          : entry.prompt;
        draftActions.setPrompt(activeThreadId, nextPrompt);
        if (entry.attachments.length > 0) {
          const restored = hydrateImagesFromPersisted(entry.attachments);
          if (restored.length > 0) {
            draftActions.addImages(activeThreadId, restored);
          }
        }
        toastManager.add({
          type: "success",
          title: "Prompt appended to composer",
          description: `Appended stashed prompt to existing draft.`,
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
    ],
  );

  const handleStashCurrentDraft = useCallback(async () => {
    if (!activeThreadId || !hasStashableDraft) return;
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
        prompt: existingDraftPrompt,
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
      draftActions.setPrompt(activeThreadId, "");
      (currentDraft?.files ?? []).forEach((file) =>
        draftActions.removeFile(activeThreadId, file.id),
      );
      existingDraftImages.forEach((image) => draftActions.removeImage(activeThreadId, image.id));
      toastManager.add({
        type: "success",
        title: "Prompt stashed",
        description: "Draft saved to stash.",
      });
    } catch {
      toastManager.add({
        type: "error",
        title: "Could not stash draft",
      });
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
    <div
      className={cn(
        "companion-stash flex h-full min-h-0 flex-col bg-background text-foreground",
        className,
      )}
    >
      {/* Search & Actions Header */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/60 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <BookmarkIcon className="size-4 text-foreground" />
            <span>Stashed Prompts</span>
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono tabular-nums text-muted-foreground">
              {entries.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {hasStashableDraft && (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => void handleStashCurrentDraft()}
                className="h-6 gap-1 px-2 text-[11px] font-semibold text-foreground hover:bg-accent"
                title="Stash the current composer draft"
              >
                <BookmarkPlusIcon className="size-3 text-foreground" />
                <span>Stash Draft</span>
              </Button>
            )}

            {entries.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon className="mr-1 size-3" />
                Clear all
              </Button>
            )}
          </div>
        </div>

        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search saved prompts"
            placeholder="Find a saved prompt..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 pr-3 text-xs bg-muted/40"
          />
        </div>
      </div>

      {/* Main Content Area: Split List & Inspection Preview */}
      {entries.length === 0 ? (
        <CompanionEmpty kind="stash" title="Keep a good thought">
          Save a composer draft here, then restore or append it when you need it.
        </CompanionEmpty>
      ) : filteredEntries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          No stashes matching &ldquo;{searchQuery}&rdquo;
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col divide-y divide-border/50 overflow-hidden">
          {/* Top Half: Scrollable Stash List */}
          <ScrollArea className="flex-1 min-h-[120px] max-h-[46%] overflow-y-auto">
            <div className="divide-y divide-border/30 p-2 space-y-1">
              {filteredEntries.map((entry) => {
                const isSelected = activeEntry?.id === entry.id;
                const { value: timeVal, suffix: timeSuffix } = formatRelativeTime(entry.createdAt);

                return (
                  <div
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(entry.id);
                      }
                    }}
                    className={cn(
                      "companion-card group relative flex flex-col gap-1.5 rounded-lg p-2.5 text-left transition-all cursor-pointer select-none",
                      isSelected
                        ? "bg-accent text-accent-foreground ring-1 ring-border shadow-xs"
                        : "hover:bg-muted/50 text-foreground",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-xs font-medium leading-relaxed">
                        {promptStashSnippet(entry)}
                      </p>

                      {/* Action buttons on the card */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRestore(entry, "replace");
                          }}
                          disabled={!activeThreadId}
                          className="h-6 gap-1 px-2 text-[11px] font-semibold text-foreground hover:bg-background shadow-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                          title={
                            activeThreadId ? "Unstash prompt into composer" : "Open a thread first"
                          }
                        >
                          <Undo2Icon className="size-3 text-foreground" />
                          <span>Unstash</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={(e) => handleDelete(entry.id, e)}
                          className="size-6 text-muted-foreground hover:text-destructive cursor-pointer transition-colors"
                          aria-label="Delete stash"
                          title="Delete stash"
                        >
                          <Trash2Icon className="size-3" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>
                        {timeVal} {timeSuffix ?? ""}
                      </span>
                      {entry.environmentId && entry.environmentId !== currentEnvironmentId && (
                        <span className="rounded bg-muted px-1 font-mono text-[9px]">
                          {entry.environmentId}
                        </span>
                      )}
                      {entry.attachments.length > 0 && (
                        <span className="flex items-center gap-0.5 text-foreground font-medium">
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
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Bottom Half: Full Preview & Pinned Action Controls */}
          {activeEntry ? (
            <div className="flex flex-1 min-h-[160px] flex-col overflow-hidden bg-card/40">
              {/* Preview Header */}
              <div className="flex shrink-0 items-center justify-between px-3 py-2 border-b border-border/40 text-[11px] font-medium text-muted-foreground bg-muted/20">
                <span className="flex items-center gap-1.5">
                  <FileTextIcon className="size-3.5 text-foreground" />
                  <span>Stash Preview</span>
                  <span className="text-[10px] text-muted-foreground/70">
                    ({activeEntry.prompt.length} chars)
                  </span>
                </span>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => void handleCopy(activeEntry)}
                        >
                          {copiedId === activeEntry.id ? (
                            <CheckIcon className="size-3.5 text-emerald-500" />
                          ) : (
                            <CopyIcon className="size-3.5" />
                          )}
                        </Button>
                      }
                    />
                    <TooltipPopup side="top">Copy prompt text</TooltipPopup>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(activeEntry.id)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      }
                    />
                    <TooltipPopup side="top">Delete this stash</TooltipPopup>
                  </Tooltip>
                </div>
              </div>

              {/* Scrollable Preview Content */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
                <div className="rounded-md bg-muted/40 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap select-text text-foreground border border-border/30">
                  {activeEntry.prompt}
                </div>

                {/* Attachments Preview */}
                {activeEntry.attachments.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Attached Images ({activeEntry.attachments.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {activeEntry.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="group relative size-16 overflow-hidden rounded-md border border-border/80 bg-muted/40"
                        >
                          <img
                            src={att.dataUrl}
                            alt={att.name}
                            className="size-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Pinned Action Controls - ALWAYS Visible */}
              <div className="shrink-0 flex items-center gap-2 p-2.5 border-t border-border/50 bg-background/95 backdrop-blur-xs">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleRestore(activeEntry, "replace")}
                  disabled={!activeThreadId}
                  className="flex-1 gap-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  title={activeThreadId ? undefined : "Open a thread first"}
                >
                  <Undo2Icon className="size-3.5" />
                  Unstash to Composer
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(activeEntry, "append")}
                  disabled={!activeThreadId}
                  className="gap-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    activeThreadId
                      ? "Append prompt and attachments to existing composer draft"
                      : "Open a thread first"
                  }
                >
                  <PlusIcon className="size-3.5" />
                  Append
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
