import type { GitHistoryCommit } from "@tabs/contracts";
import {
  Check,
  Copy,
  History as HistoryIcon,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
  Undo2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import { useGitApi, useGitScopeKey } from "./gitApiContext";
import { DiffCard, parseGitPatchToFiles, type ParsedFileDiff } from "./DiffPage";
import { GitCheckingState } from "./GitCheckingState";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Banner, Card, DiffSummaryCard, StatPill, TextInput } from "./gitPrimitives";

export function CommitRow({
  c,
  onClick,
  onReset,
  onRevert,
  onCherryPick,
}: {
  c: GitHistoryCommit;
  onClick?: () => void;
  onReset: (commit: GitHistoryCommit) => void;
  onRevert: (commit: GitHistoryCommit) => void;
  onCherryPick: (commit: GitHistoryCommit) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const copySha = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(c.sha).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
    setMenuOpen(false);
  };

  return (
    <div className="group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        }}
        className="relative w-full text-left flex flex-col gap-1.5 pl-4 pr-9 py-3 border-b border-border/50 last:border-0 hover:bg-muted/50 rounded-md transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <span
          className="absolute top-4 w-2 h-2 rounded-full border-2"
          style={{
            left: "-13px",
            borderColor: c.isHead ? "var(--foreground)" : "var(--muted-foreground)",
            backgroundColor: c.isHead ? "var(--foreground)" : "var(--background)",
          }}
        />
        <div className="text-xs font-medium text-foreground/90 leading-snug">{c.subject}</div>
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono text-muted-foreground/70">
          <span className="border border-border rounded px-1.5 py-0.5 text-muted-foreground">
            {c.shortSha}
          </span>
          <span>{c.authorName}</span>
          <span>&middot;</span>
          <span>{c.authoredAt.slice(0, 10)}</span>
          {(c.refs || []).map((r) => (
            <span key={r} className="rounded-full px-2 py-0.5 bg-muted text-foreground/80">
              {r}
            </span>
          ))}
        </div>
      </div>
      <div className="absolute right-1 top-3" ref={menuRef} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label={`Open actions for commit ${c.shortSha}`}
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          className={`w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground/70 hover:text-foreground transition-opacity cursor-pointer ${
            menuOpen
              ? "opacity-100 bg-muted"
              : "opacity-0 group-hover:opacity-100 hover:bg-muted/50"
          }`}
        >
          <MoreHorizontal size={13} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border shadow-2xl overflow-hidden z-40 py-1 bg-card">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCherryPick(c);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <Copy size={11} /> Cherry-pick
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRevert(c);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <Undo2 size={11} /> Revert
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReset(c);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted transition-colors cursor-pointer"
              style={{ color: "var(--sem-red)" }}
            >
              <RotateCcw size={11} /> Reset to here
            </button>
            <div className="h-px bg-border/50 my-1" />
            <button
              type="button"
              onClick={copySha}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy SHA"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CommitDetailModal({
  cwd,
  commit,
  onClose,
}: {
  cwd: string;
  commit: GitHistoryCommit | null;
  onClose: () => void;
}) {
  const gitScopeKey = useGitScopeKey();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileDiffs, setFileDiffs] = useState<ParsedFileDiff[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [diffSummaryResult, setDiffSummaryResultState] = useState<
    import("@tabs/contracts").GitGenerateDiffSummaryResult | null
  >(null);

  useEffect(() => {
    if (!commit?.sha) {
      setDiffSummaryResultState(null);
      return;
    }
    try {
      const cached = sessionStorage.getItem(`tabs_git_commit_summary_${gitScopeKey}_${commit.sha}`);
      setDiffSummaryResultState(cached ? JSON.parse(cached) : null);
    } catch {
      setDiffSummaryResultState(null);
    }
  }, [commit?.sha, gitScopeKey]);

  const setDiffSummaryResult = (
    val: import("@tabs/contracts").GitGenerateDiffSummaryResult | null,
  ) => {
    setDiffSummaryResultState(val);
    if (commit?.sha) {
      try {
        if (val) {
          sessionStorage.setItem(
            `tabs_git_commit_summary_${gitScopeKey}_${commit.sha}`,
            JSON.stringify(val),
          );
        } else {
          sessionStorage.removeItem(`tabs_git_commit_summary_${gitScopeKey}_${commit.sha}`);
        }
      } catch {
        // Ignore session storage errors
      }
    }
  };
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const api = useGitApi();

  useEffect(() => {
    if (!commit || !api || !cwd) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedFileIndex(0);

    api.git
      .diff({ cwd, commit: commit.sha })
      .then((res: { patch?: string }) => {
        if (cancelled) return;
        if (res?.patch) {
          const parsed = parseGitPatchToFiles(res.patch);
          setFileDiffs(parsed);
        } else {
          setFileDiffs([]);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(toGitUserFacingErrorMessage(err));
          setFileDiffs([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, cwd, commit]);

  const handleSummarizeCommit = async () => {
    if (!api || !commit) return;
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const res = await api.git.generateDiffSummary({
        cwd,
        target: { kind: "commit", sha: commit.sha },
      });
      setDiffSummaryResult(res);
    } catch (err) {
      setSummaryError(toGitUserFacingErrorMessage(err));
    } finally {
      setIsSummarizing(false);
    }
  };

  if (!commit) return null;

  const currentFile = fileDiffs[selectedFileIndex] ?? null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-5xl">
        <DialogHeader>
          <DialogTitle>Commit {commit.shortSha}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col h-[75vh] min-h-[400px] overflow-hidden">
          <div className="space-y-1.5 border-b border-border/50 pb-3 shrink-0">
            <div className="text-sm font-semibold text-foreground leading-snug">
              {commit.subject}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground/70 font-mono">
              <span>
                Author: <strong className="text-foreground/90">{commit.authorName}</strong>
              </span>
              <span>
                Date:{" "}
                <strong className="text-foreground/90">{commit.authoredAt.slice(0, 10)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground/70 pt-1">
              <span className="truncate flex-1">SHA: {commit.sha}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={isSummarizing}
                onClick={() => void handleSummarizeCommit()}
                className="gap-1 text-xs"
              >
                {isSummarizing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Wand2 size={12} className="text-foreground" />
                )}
                {isSummarizing ? "Summarizing…" : "Summarize commit"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(commit.sha)}
              >
                Copy SHA
              </Button>
            </div>
          </div>

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
              targetScope="commit"
              wasTruncated={diffSummaryResult.wasTruncated}
              truncatedReason={diffSummaryResult.truncatedReason}
              onClose={() => setDiffSummaryResult(null)}
            />
          )}

          {loading ? (
            <GitCheckingState message="Loading commit diff…" size={36} />
          ) : error ? (
            <Banner tone="bad" title="Failed to load commit diff" body={error} />
          ) : fileDiffs.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground/70 py-8">
              No file changes found in this commit.
            </div>
          ) : (
            <div className="flex flex-1 min-h-0 gap-3 overflow-hidden mt-3">
              <div className="w-64 shrink-0 border-r border-border/50 pr-2 overflow-y-auto custom-scrollbar space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 px-2 py-1">
                  Files ({fileDiffs.length})
                </div>
                {fileDiffs.map((fd, idx) => (
                  <button
                    key={fd.path}
                    type="button"
                    onClick={() => setSelectedFileIndex(idx)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      selectedFileIndex === idx
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <span className="truncate flex-1 font-mono text-[11px]">{fd.path}</span>
                    {fd.isBinary ? (
                      <span className="text-[10px] font-mono border border-border rounded px-1.5 py-0.5 text-muted-foreground/70 uppercase">
                        BIN
                      </span>
                    ) : (
                      <StatPill ins={fd.ins} del={fd.del} />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1 min-w-0 h-full overflow-hidden">
                {currentFile ? (
                  <DiffCard
                    path={currentFile.path}
                    ins={currentFile.ins}
                    del={currentFile.del}
                    lines={currentFile.lines}
                  />
                ) : (
                  <div className="text-center text-xs text-muted-foreground/70 py-8">
                    Select a file to view changes.
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

import { useProjectGitState } from "../../state/scopedStateStore";

export function HistoryPanel({
  cwd,
  commits,
  loadingHistory,
  onReset,
  onRevert,
  onCherryPick,
  onLoadMoreHistory,
}: {
  cwd: string;
  commits: ReadonlyArray<GitHistoryCommit>;
  loadingHistory?: boolean;
  onReset: (c: GitHistoryCommit) => void;
  onRevert: (c: GitHistoryCommit) => void;
  onCherryPick: (c: GitHistoryCommit) => void;
  onLoadMoreHistory?: () => void;
}) {
  const [gitState, setGitState] = useProjectGitState(useGitScopeKey());
  const query = gitState.historySearch;
  const setQuery = useCallback(
    (q: string) => {
      setGitState({ historySearch: q });
    },
    [setGitState],
  );
  const [activeCommit, setActiveCommit] = useState<GitHistoryCommit | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? commits.filter(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          c.authorName.toLowerCase().includes(q) ||
          c.sha.includes(q),
      )
    : commits;

  if (loadingHistory) {
    return <GitCheckingState message="Loading history…" size={36} />;
  }

  if (commits.length === 0) {
    return (
      <Card className="p-6 text-center">
        <HistoryIcon className="mx-auto mb-2 text-muted-foreground/70" size={24} />
        <p className="text-xs font-medium text-foreground/90 mb-1">No commits yet</p>
        <p className="text-[11px] text-muted-foreground/70">
          Commits made to this repository will appear here.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search
          size={12}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10"
        />
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by message, author, or SHA…"
          className="pl-8"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground/70 py-10">
          No commits match "{query}"
        </div>
      ) : (
        <div className="relative pl-4">
          <div className="absolute top-2 bottom-2 w-px bg-border" style={{ left: "7px" }} />
          {filtered.map((c) => (
            <CommitRow
              key={c.sha}
              c={c}
              onClick={() => setActiveCommit(c)}
              onReset={onReset}
              onRevert={onRevert}
              onCherryPick={onCherryPick}
            />
          ))}
          {onLoadMoreHistory && filtered.length >= 50 && (
            <div className="pt-4 text-center">
              <Button variant="ghost" size="sm" onClick={onLoadMoreHistory}>
                Load more commits
              </Button>
            </div>
          )}
        </div>
      )}
      {activeCommit && (
        <CommitDetailModal cwd={cwd} commit={activeCommit} onClose={() => setActiveCommit(null)} />
      )}
    </div>
  );
}
