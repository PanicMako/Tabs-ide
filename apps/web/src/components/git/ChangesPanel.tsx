import type {
  GitEnvironmentResult,
  GitHistoryCommit,
  GitListBranchesResult,
  GitStatusFile,
  GitStatusResult,
  ModelSelection,
} from "@tabs/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  GitCommit,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { deriveRepoState } from "../../lib/deriveRepoState";
import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import { invalidateGitQueries } from "../../lib/gitReactQuery";
import { useGitApi, useGitScopeKey } from "./gitApiContext";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Switch } from "~/components/ui/switch";
import {
  AutoTextarea,
  Banner,
  Card,
  DiffSummaryCard,
  FilePathLabel,
  GitModelPicker,
  SectionLabel,
} from "./gitPrimitives";

const STRATEGY_LABEL: Record<string, string> = {
  ours: "Use current",
  theirs: "Use incoming",
  both: "Use both",
  manual: "Manual edit",
};

import { DiffLines } from "./DiffPage";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";

export function FileRow({
  cwd,
  f,
  staged,
  rowLoadingAction,
  onOpenDiff,
  onToggleStage,
  onDiscard,
}: {
  cwd?: string;
  f: GitStatusFile;
  staged: boolean;
  rowLoadingAction?: "stage" | "unstage" | "discard" | null | undefined;
  onOpenDiff: (f: GitStatusFile) => void;
  onToggleStage: (f: GitStatusFile) => void;
  onDiscard: (f: GitStatusFile) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diffLines, setDiffLines] = useState<Array<{ type: string; text: string }> | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const api = useGitApi();

  const toggleInlineDiff = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (diffLines || !api || !cwd) return;

    setLoadingDiff(true);
    api.git
      .diff({ cwd, path: f.path })
      .then((res: { patch?: string }) => {
        if (res?.patch) {
          const lines = res.patch.split("\n").map((line: string) => {
            if (line.startsWith("@@")) return { type: "hunk", text: line };
            if (line.startsWith("+") && !line.startsWith("+++"))
              return { type: "add", text: line.slice(1) };
            if (line.startsWith("-") && !line.startsWith("---"))
              return { type: "del", text: line.slice(1) };
            return { type: "ctx", text: line };
          });
          setDiffLines(lines);
        } else {
          setDiffLines([]);
        }
      })
      .catch(() => setDiffLines([]))
      .finally(() => setLoadingDiff(false));
  };

  const isRowLoading = Boolean(rowLoadingAction);

  return (
    <div className="w-full border-b border-border/50 last:border-0">
      <div className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors">
        <button
          type="button"
          onClick={toggleInlineDiff}
          aria-label={
            expanded
              ? `Collapse inline diff for ${f.path}`
              : `Toggle inline diff preview for ${f.path}`
          }
          aria-expanded={expanded}
          title={expanded ? "Collapse inline diff" : "Preview inline diff"}
          className="shrink-0 text-muted-foreground/70 hover:text-foreground cursor-pointer"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <button
          type="button"
          onClick={() => onOpenDiff(f)}
          aria-label={`Open full diff for ${f.path}`}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              backgroundColor: f.untracked
                ? "var(--sem-emerald)"
                : f.deletions > 0 && f.insertions === 0
                  ? "var(--sem-red)"
                  : "var(--sem-amber)",
            }}
          />
          <FilePathLabel path={f.path} size="text-xs" />
        </button>
        <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--sem-emerald)" }}>
          +{f.insertions}
        </span>
        <span
          className="text-[11px] font-mono shrink-0"
          style={{ color: "var(--sem-red)", opacity: 0.85 }}
        >
          -{f.deletions}
        </span>
        <button
          type="button"
          onClick={toggleInlineDiff}
          aria-label={
            expanded ? `Collapse inline diff for ${f.path}` : `Preview inline diff for ${f.path}`
          }
          aria-expanded={expanded}
          title="Toggle inline diff preview"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center justify-center w-5 h-5 rounded bg-muted/50 border border-border text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Eye size={10} />
        </button>
        <button
          type="button"
          disabled={isRowLoading}
          aria-label={`Discard changes to ${f.path}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!isRowLoading) onDiscard(f);
          }}
          title="Discard changes to this file"
          className={`${rowLoadingAction === "discard" ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity shrink-0 flex items-center justify-center w-5 h-5 rounded bg-muted/50 border border-border text-muted-foreground hover:text-foreground cursor-pointer disabled:pointer-events-none`}
        >
          {rowLoadingAction === "discard" ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Trash2 size={10} />
          )}
        </button>
        <button
          type="button"
          disabled={isRowLoading}
          aria-label={staged ? `Unstage ${f.path}` : `Stage ${f.path}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!isRowLoading) onToggleStage(f);
          }}
          title={staged ? "Unstage file" : "Stage file"}
          className={`${rowLoadingAction === "stage" || rowLoadingAction === "unstage" ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity shrink-0 flex items-center justify-center w-5 h-5 rounded bg-muted/50 border border-border text-muted-foreground hover:text-foreground cursor-pointer disabled:pointer-events-none`}
        >
          {rowLoadingAction === "stage" || rowLoadingAction === "unstage" ? (
            <Loader2 size={10} className="animate-spin" />
          ) : staged ? (
            <Minus size={10} />
          ) : (
            <Plus size={10} />
          )}
        </button>
      </div>

      {expanded && (
        <div className="my-2 ml-6 p-2 rounded border border-border/50 bg-muted/40 max-h-72 overflow-auto custom-scrollbar">
          {loadingDiff ? (
            <div className="text-[11px] text-muted-foreground/70 py-2">Loading diff preview…</div>
          ) : !diffLines || diffLines.length === 0 ? (
            <div className="text-[11px] text-muted-foreground/70 py-2">No diff available</div>
          ) : (
            <DiffLines lines={diffLines} />
          )}
        </div>
      )}
    </div>
  );
}

interface ConflictHunk {
  header: string;
  ours: string[];
  theirs: string[];
}
interface ConflictFile {
  path: string;
  hunks: ConflictHunk[];
}

export function ConflictResolver({
  files,
  resolutions,
  setResolutions,
}: {
  files: ConflictFile[];
  resolutions: Record<string, { strategy: string; text?: string }>;
  setResolutions: React.Dispatch<
    React.SetStateAction<Record<string, { strategy: string; text?: string }>>
  >;
}) {
  const [activeFile, setActiveFile] = useState(0);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [manualText, setManualText] = useState("");

  const key = (fi: number, hi: number) => `${fi}:${hi}`;
  const isResolved = (fi: number, hi: number) => Boolean(resolutions[key(fi, hi)]);
  const fileResolvedCount = (fi: number) =>
    files[fi]?.hunks.filter((_, hi) => isResolved(fi, hi)).length ?? 0;
  const fileDone = (fi: number) => fileResolvedCount(fi) === (files[fi]?.hunks.length ?? 0);

  const setStrategy = (fi: number, hi: number, strategy: string, text?: string) => {
    setResolutions((prev) => {
      const item: { strategy: string; text?: string } = { strategy };
      if (text !== undefined) item.text = text;
      return { ...prev, [key(fi, hi)]: item };
    });
    setEditingKey(null);
  };
  const bulkAll = (strategy: string) => {
    setResolutions((prev) => {
      const next = { ...prev };
      files.forEach((f, fi) =>
        f.hunks.forEach((_, hi) => {
          next[key(fi, hi)] = { strategy };
        }),
      );
      return next;
    });
  };

  const file = files[activeFile] ?? files[0];

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-3">
        <Button variant="ghost" size="sm" onClick={() => bulkAll("ours")}>
          Accept all current
        </Button>
        <Button variant="ghost" size="sm" onClick={() => bulkAll("theirs")}>
          Accept all incoming
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="w-48 shrink-0">
          {files.map((f, fi) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setActiveFile(fi)}
              className={`w-full text-left px-2.5 py-2 rounded-lg mb-1 transition-colors cursor-pointer ${
                activeFile === fi ? "bg-accent" : "hover:bg-muted/50"
              }`}
            >
              <div className="text-[11px] font-mono text-foreground/90 truncate leading-normal pb-0.5">
                {f.path.split("/").pop()}
              </div>
              <div
                className="text-[10px] font-mono mt-1"
                style={{ color: fileDone(fi) ? "var(--sem-emerald)" : "var(--fg-30)" }}
              >
                {fileResolvedCount(fi)}/{f.hunks.length} resolved
              </div>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          {file?.hunks.map((h, hi) => {
            const res = resolutions[key(activeFile, hi)];
            const editing = editingKey === key(activeFile, hi);
            return (
              <Card key={hi} className="mb-3 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
                  <span className="text-[11px] font-mono text-muted-foreground/70 truncate">
                    {h.header}
                  </span>
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded-full shrink-0"
                    style={
                      res
                        ? {
                            color: "var(--sem-emerald)",
                            backgroundColor: "var(--sem-emerald-soft)",
                          }
                        : { color: "var(--sem-amber)", backgroundColor: "var(--sem-amber-soft)" }
                    }
                  >
                    {res ? STRATEGY_LABEL[res.strategy] : "Unresolved"}
                  </span>
                </div>

                {!editing ? (
                  <>
                    <div className="grid grid-cols-2">
                      <div className="border-r border-border/50 min-w-0">
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/70 border-b border-border/50 font-mono">
                          Current (ours)
                        </div>
                        <div className="font-mono text-[11px] py-1 overflow-x-auto custom-scrollbar">
                          {h.ours.map((l, li) => (
                            <div
                              key={li}
                              className="px-3 py-0.5 whitespace-pre text-muted-foreground"
                            >
                              {l}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/70 border-b border-border/50 font-mono">
                          Incoming (theirs)
                        </div>
                        <div className="font-mono text-[11px] py-1 overflow-x-auto custom-scrollbar">
                          {h.theirs.map((l, li) => (
                            <div
                              key={li}
                              className="px-3 py-0.5 whitespace-pre text-muted-foreground"
                            >
                              {l}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border/50">
                      <Button
                        size="sm"
                        variant={res?.strategy === "ours" ? "default" : "outline"}
                        onClick={() => setStrategy(activeFile, hi, "ours")}
                      >
                        Use current
                      </Button>
                      <Button
                        size="sm"
                        variant={res?.strategy === "theirs" ? "default" : "outline"}
                        onClick={() => setStrategy(activeFile, hi, "theirs")}
                      >
                        Use incoming
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStrategy(activeFile, hi, "both")}
                      >
                        Use both
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingKey(key(activeFile, hi));
                          setManualText([...h.ours, ...h.theirs].join("\n"));
                        }}
                      >
                        Edit manually
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="p-3">
                    <AutoTextarea
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      minRows={4}
                      className="w-full border border-border rounded-lg text-foreground/90 bg-background font-mono text-[11px] p-3 outline-none focus:border-border transition-colors"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        size="sm"
                        onClick={() => setStrategy(activeFile, hi, "manual", manualText)}
                      >
                        Save resolution
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingKey(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}

          {activeFile < files.length - 1 && (
            <Button
              size="sm"
              disabled={!fileDone(activeFile)}
              title={!fileDone(activeFile) ? "Resolve every hunk in this file first" : undefined}
              onClick={() => setActiveFile((i) => Math.min(files.length - 1, i + 1))}
            >
              Next file
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useProjectGitState } from "../../state/scopedStateStore";

export function ChangesPanel({
  cwd,
  statusData,
  environmentData,
  branchList,
  commits = [],
  onOpenDiff,
  onOpenStash,
  onOpenDiscardAll,
  onRunInTerminal,
}: {
  cwd: string;
  statusData: GitStatusResult | null;
  environmentData?: GitEnvironmentResult | null;
  branchList?: GitListBranchesResult | null;
  commits?: ReadonlyArray<GitHistoryCommit>;
  onOpenDiff: (f: GitStatusFile) => void;
  onOpenStash: () => void;
  onOpenDiscardAll: () => void;
  onRunInTerminal: (cmd: string) => void;
}) {
  const gitScopeKey = useGitScopeKey();
  const [gitState, setGitState] = useProjectGitState(gitScopeKey);

  const msg = gitState.commitDraft;
  const setMsg = useCallback(
    (v: string | ((prev: string) => string)) => {
      setGitState((prev) => ({ commitDraft: typeof v === "function" ? v(prev.commitDraft) : v }));
    },
    [setGitState],
  );

  const [generating, setGenerating] = useState(false);

  const amend = gitState.amend;
  const setAmend = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setGitState((prev) => ({ amend: typeof v === "function" ? v(prev.amend) : v }));
    },
    [setGitState],
  );

  const conflictResolutions = gitState.conflictResolutions;
  const setConflictResolutions = useCallback(
    (
      v:
        | Record<string, { strategy: string; text?: string }>
        | ((
            prev: Record<string, { strategy: string; text?: string }>,
          ) => Record<string, { strategy: string; text?: string }>),
    ) => {
      setGitState((prev) => ({
        conflictResolutions: typeof v === "function" ? v(prev.conflictResolutions) : v,
      }));
    },
    [setGitState],
  );

  const [isStagingAll, setIsStagingAll] = useState(false);
  const [isUnstagingAll, setIsUnstagingAll] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCommittingAndPushing, setIsCommittingAndPushing] = useState(false);
  const [fileRowLoadingMap, setFileRowLoadingMap] = useState<
    Record<string, "stage" | "unstage" | "discard">
  >({});
  const [diffSummaryResult, setDiffSummaryResultState] = useState<
    import("@tabs/contracts").GitGenerateDiffSummaryResult | null
  >(() => {
    if (!cwd) return null;
    try {
      const cached = sessionStorage.getItem(`tabs_git_summary_${gitScopeKey}`);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const setDiffSummaryResult = (
    val: import("@tabs/contracts").GitGenerateDiffSummaryResult | null,
  ) => {
    setDiffSummaryResultState(val);
    if (cwd) {
      try {
        if (val) {
          sessionStorage.setItem(`tabs_git_summary_${gitScopeKey}`, JSON.stringify(val));
        } else {
          sessionStorage.removeItem(`tabs_git_summary_${gitScopeKey}`);
        }
      } catch {
        // Ignore session storage errors
      }
    }
  };
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const selectedModel = gitState.selectedModel;
  const setSelectedModel = useCallback(
    (
      v:
        | ModelSelection
        | undefined
        | ((prev: ModelSelection | undefined) => ModelSelection | undefined),
    ) => {
      setGitState((prev) => ({
        selectedModel: typeof v === "function" ? v(prev.selectedModel) : v,
      }));
    },
    [setGitState],
  );

  const api = useGitApi();
  const queryClient = useQueryClient();

  const isGitInstalled = environmentData?.git.installed ?? true;
  const isRepo = branchList?.isRepo ?? true;
  const ghAuthed = environmentData?.gitHub.authenticated ?? false;
  const hasRemote = branchList?.hasOriginRemote ?? false;
  const ahead = statusData?.aheadCount ?? 0;
  const behind = statusData?.behindCount ?? 0;
  const stagedFiles = statusData?.staged?.files ?? [];
  const unstagedFiles = (statusData?.unstaged?.files ?? []).filter(
    (f) => !f.conflicted && !f.untracked,
  );
  const conflictedFiles = statusData?.conflicted?.files ?? [];
  const hasConflict = conflictedFiles.length > 0;
  const totalChanged = stagedFiles.length + unstagedFiles.length;
  const isDetached = !branchList?.branches.some((b) => b.current);
  const remoteName = branchList?.remoteName ?? "origin";
  const pushAccess = branchList?.pushAccess ?? "unknown";

  const repoState = useMemo(
    () =>
      deriveRepoState({
        isGitInstalled,
        isRepo,
        hasRemote,
        ghAuthed,
        aheadCount: ahead,
        behindCount: behind,
        stagedFilesCount: stagedFiles.length,
        unstagedFilesCount: unstagedFiles.length,
        hasConflict,
        isDetached,
        isEmptyRepo:
          isRepo && (commits.length === 0 || (branchList?.branches.length === 0 && !hasConflict)),
        remoteName,
        pushAccess,
      }),
    [
      isGitInstalled,
      isRepo,
      hasRemote,
      ghAuthed,
      ahead,
      behind,
      stagedFiles.length,
      unstagedFiles.length,
      hasConflict,
      isDetached,
      commits.length,
      branchList?.branches.length,
      remoteName,
      pushAccess,
    ],
  );

  const toggleStage = async (f: GitStatusFile, staged: boolean) => {
    if (!api) return;
    setFileRowLoadingMap((prev) => ({ ...prev, [f.path]: staged ? "unstage" : "stage" }));
    try {
      if (staged) {
        await api.git.unstageFiles({ cwd, paths: [f.path] });
      } else {
        await api.git.stageFiles({ cwd, paths: [f.path] });
      }
      await invalidateGitQueries(queryClient);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: staged ? "Unstage failed" : "Stage failed",
        description: toGitUserFacingErrorMessage(error),
      });
    } finally {
      setFileRowLoadingMap((prev) => {
        const next = { ...prev };
        delete next[f.path];
        return next;
      });
    }
  };

  const stageAll = async () => {
    if (!api || !unstagedFiles.length) return;
    setIsStagingAll(true);
    try {
      await api.git.stageFiles({ cwd, paths: unstagedFiles.map((f) => f.path) });
      await invalidateGitQueries(queryClient);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Stage all failed",
        description: toGitUserFacingErrorMessage(error),
      });
    } finally {
      setIsStagingAll(false);
    }
  };

  const unstageAll = async () => {
    if (!api || !stagedFiles.length) return;
    setIsUnstagingAll(true);
    try {
      await api.git.unstageFiles({ cwd, paths: stagedFiles.map((f) => f.path) });
      await invalidateGitQueries(queryClient);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unstage all failed",
        description: toGitUserFacingErrorMessage(error),
      });
    } finally {
      setIsUnstagingAll(false);
    }
  };

  const discardFile = async (f: GitStatusFile) => {
    if (!api) return;
    setFileRowLoadingMap((prev) => ({ ...prev, [f.path]: "discard" }));
    try {
      await api.git.discardChanges({ cwd, paths: [f.path] });
      await invalidateGitQueries(queryClient);
      toastManager.add({ type: "success", title: `Discarded ${f.path}` });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Discard failed",
        description: toGitUserFacingErrorMessage(error),
      });
    } finally {
      setFileRowLoadingMap((prev) => {
        const next = { ...prev };
        delete next[f.path];
        return next;
      });
    }
  };

  const handleGenerate = async () => {
    if (!api || !stagedFiles.length) return;
    setGenerating(true);
    try {
      const result = await api.git.generateDiffSummary({
        cwd,
        target: { kind: "working_tree" },
        ...(selectedModel ? { modelSelection: selectedModel } : {}),
        userHint:
          "Prioritize the staged changes and return a concise imperative commit subject as the first line.",
      });
      setMsg(result.summary.split("\n", 1)[0]?.trim() ?? "");
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Message generation failed",
        description: toGitUserFacingErrorMessage(error),
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCommit = async (andPush = false) => {
    if (!api) return;
    if (andPush) {
      setIsCommittingAndPushing(true);
    } else {
      setIsCommitting(true);
    }
    try {
      if (amend) {
        await api.git.amendCommit({ cwd, message: msg.trim() || undefined });
      } else {
        await api.git.runStackedAction({
          actionId: crypto.randomUUID(),
          cwd,
          action: andPush ? "commit_push" : "commit",
          commitMessage: msg.trim(),
        });
      }
      await invalidateGitQueries(queryClient);
      setMsg("");
      toastManager.add({
        type: "success",
        title: amend ? "Amended commit" : andPush ? "Committed and pushed" : "Committed staged",
      });
    } catch (error) {
      await invalidateGitQueries(queryClient);
      const errObj = error as { message?: string; phase?: string; createdCommitSha?: string };
      const isPushFailureAfterCommit =
        errObj?.phase === "push" && Boolean(errObj?.createdCommitSha);
      const unpushedCount = ahead + 1;
      const countLabel =
        unpushedCount === 1 ? "1 unpushed commit" : `${unpushedCount} unpushed commits`;
      const shortSha = errObj.createdCommitSha ? errObj.createdCommitSha.substring(0, 7) : "";
      const errorMsg = toGitUserFacingErrorMessage(error);
      toastManager.add({
        type: "error",
        title: isPushFailureAfterCommit ? "Commit succeeded, but push failed" : "Commit failed",
        description: isPushFailureAfterCommit
          ? `${shortSha ? `Committed as ${shortSha}. ` : ""}Push failed: ${errorMsg}. You have ${countLabel} — click Push to retry.`
          : errorMsg,
      });
    } finally {
      setIsCommitting(false);
      setIsCommittingAndPushing(false);
    }
  };

  const handleSummarizeChanges = async () => {
    if (!api) return;
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const res = await api.git.generateDiffSummary({
        cwd,
        target: { kind: "working_tree" },
        ...(selectedModel ? { modelSelection: selectedModel } : {}),
      });
      setDiffSummaryResult(res);
    } catch (err) {
      const errMsg = toGitUserFacingErrorMessage(err);
      setSummaryError(errMsg);
    } finally {
      setIsSummarizing(false);
    }
  };

  return (
    <div>
      {summaryError && (
        <Banner
          tone="bad"
          title="AI Diff Summary Error"
          body={summaryError}
          actions={
            <Button variant="ghost" size="sm" onClick={() => setSummaryError(null)}>
              Dismiss
            </Button>
          }
        />
      )}

      {diffSummaryResult && (
        <DiffSummaryCard
          summary={diffSummaryResult.summary}
          keyChanges={diffSummaryResult.keyChanges}
          notesAndRisk={diffSummaryResult.notesAndRisk}
          targetScope={diffSummaryResult.targetScope}
          wasTruncated={diffSummaryResult.wasTruncated}
          truncatedReason={diffSummaryResult.truncatedReason}
          onClose={() => setDiffSummaryResult(null)}
        />
      )}
      {/* Conflicts section */}
      {hasConflict && (
        <Card
          className="p-4 mb-4 border"
          style={{ borderColor: "var(--sem-red-border)", backgroundColor: "var(--sem-red-soft)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-xs font-semibold" style={{ color: "var(--sem-red)" }}>
                Merge conflict ({conflictedFiles.length} files)
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Resolve every conflict hunk below, then stage all files and complete the merge.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onRunInTerminal("git merge --abort")}>
              <RotateCcw /> Abort merge
            </Button>
          </div>

          <ConflictResolver
            files={conflictedFiles.map((f) => ({
              path: f.path,
              hunks: [
                {
                  header: `@@ ${f.path} @@`,
                  ours: ["// current changes"],
                  theirs: ["// incoming changes"],
                },
              ],
            }))}
            resolutions={conflictResolutions}
            setResolutions={setConflictResolutions}
          />
        </Card>
      )}

      {/* Staged files card */}
      <SectionLabel
        action={
          stagedFiles.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={isUnstagingAll || isStagingAll}
              onClick={() => void unstageAll()}
            >
              {isUnstagingAll ? <Loader2 size={12} className="animate-spin" /> : null}
              {isUnstagingAll ? "Unstaging all…" : "Unstage all"}
            </Button>
          ) : undefined
        }
      >
        Staged changes ({stagedFiles.length})
      </SectionLabel>
      <Card className="p-2 mb-4">
        {stagedFiles.length === 0 ? (
          <div className="text-center text-[11px] text-muted-foreground/50 py-6">
            No staged changes
          </div>
        ) : (
          stagedFiles.map((f) => (
            <FileRow
              key={f.path}
              cwd={cwd}
              f={f}
              staged
              rowLoadingAction={fileRowLoadingMap[f.path]}
              onOpenDiff={onOpenDiff}
              onToggleStage={(file) => void toggleStage(file, true)}
              onDiscard={(file) => void discardFile(file)}
            />
          ))
        )}
      </Card>

      {/* Unstaged files card */}
      <SectionLabel
        action={
          <div className="flex items-center gap-2">
            {unstagedFiles.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isStagingAll || isUnstagingAll}
                onClick={() => void stageAll()}
              >
                {isStagingAll ? <Loader2 size={12} className="animate-spin" /> : null}
                {isStagingAll ? "Staging all…" : "Stage all"}
              </Button>
            )}
            {totalChanged > 0 && (
              <Button variant="ghost" size="sm" onClick={onOpenDiscardAll}>
                Discard all
              </Button>
            )}
          </div>
        }
      >
        Changes ({unstagedFiles.length})
      </SectionLabel>
      <Card className="p-2 mb-4">
        {unstagedFiles.length === 0 ? (
          <div className="text-center text-[11px] text-muted-foreground/50 py-6">
            Working tree clean
          </div>
        ) : (
          unstagedFiles.map((f) => (
            <FileRow
              key={f.path}
              cwd={cwd}
              f={f}
              staged={false}
              rowLoadingAction={fileRowLoadingMap[f.path]}
              onOpenDiff={onOpenDiff}
              onToggleStage={(file) => void toggleStage(file, false)}
              onDiscard={(file) => void discardFile(file)}
            />
          ))
        )}
      </Card>

      <SectionLabel>Commit</SectionLabel>
      <Card className="p-4 space-y-3.5 border-border/80">
        <AutoTextarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (stagedFiles.length && repoState.canCommitLocally) void handleCommit(false);
            }
          }}
          placeholder={
            amend ? "Leave blank to keep the previous message…" : "Summarize your change…"
          }
          minRows={3}
          className="w-full border border-border/80 rounded-lg bg-background text-foreground text-xs placeholder:text-muted-foreground/50 p-3 outline-none focus:border-border transition-colors leading-relaxed"
        />

        {/* Amend Option Bar with Switch */}
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-border/60 bg-muted/20">
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-foreground">Amend previous commit</div>
            <div className="text-[11px] text-muted-foreground/70">
              Replace the tip of current branch instead of creating a new commit
            </div>
          </div>
          <Switch checked={amend} onCheckedChange={(c) => setAmend(!!c)} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={
                !stagedFiles.length ||
                !repoState.canCommitLocally ||
                isCommitting ||
                isCommittingAndPushing
              }
              title={!stagedFiles.length ? "Nothing staged yet" : undefined}
              onClick={() => void handleCommit(false)}
            >
              {isCommitting ? <Loader2 size={13} className="animate-spin" /> : <GitCommit />}
              {isCommitting
                ? amend
                  ? "Amending…"
                  : "Committing…"
                : amend
                  ? "Amend commit"
                  : repoState.commitButtonLabel}
            </Button>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={
                  totalChanged === 0 || isSummarizing || isCommitting || isCommittingAndPushing
                }
                title={
                  totalChanged === 0 ? "No changes in working tree" : "Summarize changes with AI"
                }
                onClick={() => void handleSummarizeChanges()}
              >
                {isSummarizing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Wand2 className="size-3.5 text-foreground" />
                )}
                {isSummarizing ? "Summarizing…" : "Summarize changes"}
              </Button>
              <GitModelPicker selection={selectedModel} onSelect={setSelectedModel} />
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!stagedFiles.length || generating || isCommitting || isCommittingAndPushing}
              title="Generates a message from the staged diff"
              onClick={() => void handleGenerate()}
            >
              {generating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Wand2 className="size-3.5" />
              )}
              {generating ? "Generating…" : "Generate message"}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !stagedFiles.length ||
              !repoState.canCommitLocally ||
              !repoState.canPush ||
              isCommitting ||
              isCommittingAndPushing
            }
            title={
              repoState.pushDisabledReason ??
              (!stagedFiles.length ? "Nothing staged yet" : undefined)
            }
            onClick={() => void handleCommit(true)}
          >
            {isCommittingAndPushing ? <Loader2 size={13} className="animate-spin" /> : <Upload />}
            {isCommittingAndPushing ? "Committing & pushing…" : "Commit & push"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
