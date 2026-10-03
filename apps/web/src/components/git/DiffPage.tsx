import type { GitHistoryCommit, GitStatusFile, GitStatusResult } from "@tabs/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useGitApi, useGitScopeKey } from "./gitApiContext";
import { Card, FilePathLabel, PathBreadcrumb, StatPill } from "./gitPrimitives";

export interface ParsedFileDiff {
  path: string;
  ins: number;
  del: number;
  isBinary?: boolean;
  lines: Array<{ type: string; text: string }>;
}

export function withLineNumbers(lines: Array<{ type: string; text: string }>) {
  let oldNo = 0;
  let newNo = 0;
  return lines.map((l) => {
    if (l.type === "hunk") {
      const m1 = l.text.match(/-(\d+)/);
      const m2 = l.text.match(/\+(\d+)/);
      if (m1 && m1[1]) oldNo = parseInt(m1[1], 10);
      if (m2 && m2[1]) newNo = parseInt(m2[1], 10);
      return { ...l, oldNo: null, newNo: null };
    }
    if (l.type === "del") return { ...l, oldNo: oldNo++, newNo: null };
    if (l.type === "add") return { ...l, oldNo: null, newNo: newNo++ };
    return { ...l, oldNo: oldNo++, newNo: newNo++ };
  });
}

export function DiffLines({ lines }: { lines: Array<{ type: string; text: string }> }) {
  const numbered = withLineNumbers(lines);
  return (
    <div className="font-mono text-xs" style={{ lineHeight: 1.75 }}>
      {numbered.map((l, i) => {
        if (l.type === "hunk") {
          return (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground/70 whitespace-pre shrink-0">
                {l.text}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
          );
        }
        const isAdd = l.type === "add";
        const isDel = l.type === "del";
        const barColor = isAdd ? "var(--sem-emerald)" : isDel ? "var(--sem-red)" : "transparent";
        const rowStyle = {
          backgroundColor: isAdd
            ? "var(--sem-emerald-soft)"
            : isDel
              ? "var(--sem-red-soft)"
              : "transparent",
          borderLeft: `2px solid ${barColor}`,
        };
        return (
          <div key={i} className="flex" style={rowStyle}>
            <span className="w-7 shrink-0 text-right pr-1.5 select-none text-[10px] text-muted-foreground/50">
              {l.oldNo || ""}
            </span>
            <span className="w-7 shrink-0 text-right pr-1.5 select-none text-[10px] text-muted-foreground/50 border-r border-border/50 mr-2">
              {l.newNo || ""}
            </span>
            <span
              className="w-3 shrink-0 select-none text-[11px]"
              style={{
                color: isAdd ? "var(--sem-emerald)" : isDel ? "var(--sem-red)" : "var(--fg-20)",
              }}
            >
              {isAdd ? "+" : isDel ? "-" : ""}
            </span>
            <span
              className="whitespace-pre pr-3"
              style={{
                color: isAdd
                  ? "var(--sem-emerald-text)"
                  : isDel
                    ? "var(--sem-red-text)"
                    : "var(--fg-60)",
              }}
            >
              {l.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function parseGitPatchToFiles(patch: string): ParsedFileDiff[] {
  if (!patch || !patch.trim()) return [];
  const files: ParsedFileDiff[] = [];
  const rawBlocks = patch.split(/^diff --git /m).filter(Boolean);

  for (const block of rawBlocks) {
    const lines = block.split("\n");
    const headerLine = lines[0] ?? "";

    let renameFrom: string | null = null;
    let renameTo: string | null = null;
    let isBinary = false;

    for (const l of lines) {
      if (l.startsWith("rename from ")) renameFrom = l.slice("rename from ".length).trim();
      if (l.startsWith("rename to ")) renameTo = l.slice("rename to ".length).trim();
      if (l.startsWith("Binary files ") && l.includes("differ")) isBinary = true;
    }

    let path = "";
    if (renameFrom && renameTo) {
      path = `${renameFrom} → ${renameTo}`;
    } else if (renameTo) {
      path = renameTo;
    } else {
      const match = headerLine.match(/a\/(.+?)\s+b\/(.+)/);
      path = match && match[2] ? match[2] : headerLine || "diff";
    }

    if (isBinary) {
      files.push({
        path,
        ins: 0,
        del: 0,
        isBinary: true,
        lines: [{ type: "ctx", text: "Binary file diff (content omitted)" }],
      });
      continue;
    }

    let ins = 0;
    let del = 0;
    const parsedLines: Array<{ type: string; text: string }> = [];

    for (const line of lines) {
      if (line.startsWith("\\ No newline at end of file")) {
        parsedLines.push({ type: "ctx", text: line });
      } else if (line.startsWith("@@")) {
        parsedLines.push({ type: "hunk", text: line });
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        ins++;
        parsedLines.push({ type: "add", text: line.slice(1) });
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        del++;
        parsedLines.push({ type: "del", text: line.slice(1) });
      } else if (
        !line.startsWith("diff --git") &&
        !line.startsWith("index ") &&
        !line.startsWith("--- ") &&
        !line.startsWith("+++ ") &&
        !line.startsWith("similarity index ") &&
        !line.startsWith("rename from ") &&
        !line.startsWith("rename to ") &&
        !line.startsWith("new file mode ") &&
        !line.startsWith("deleted file mode ")
      ) {
        parsedLines.push({ type: "ctx", text: line });
      }
    }

    if (parsedLines.length === 0) {
      if (renameFrom || renameTo) {
        parsedLines.push({ type: "ctx", text: "File renamed with no content changes." });
      } else {
        parsedLines.push({ type: "ctx", text: "No content changes in this file." });
      }
    }

    files.push({ path, ins, del, isBinary: false, lines: parsedLines });
  }

  return files;
}

export function DiffCard({
  path,
  ins,
  del,
  lines,
}: {
  path: string;
  ins: number;
  del: number;
  lines: Array<{ type: string; text: string }>;
}) {
  return (
    <Card className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/40 shrink-0">
        <PathBreadcrumb path={path} />
        <StatPill ins={ins} del={del} />
      </div>
      <div className="flex-1 py-2 overflow-auto custom-scrollbar">
        <DiffLines lines={lines} />
      </div>
    </Card>
  );
}

import { useProjectGitState } from "../../state/scopedStateStore";

export function DiffPage({
  cwd,
  statusData,
  commits,
}: {
  cwd: string;
  statusData: GitStatusResult | null;
  commits: ReadonlyArray<GitHistoryCommit>;
}) {
  const [gitState, setGitState] = useProjectGitState(useGitScopeKey());
  const diffMode = gitState.diffMode;
  const setDiffMode = useCallback(
    (mode: "working" | "history") => {
      setGitState({ diffMode: mode });
    },
    [setGitState],
  );

  const api = useGitApi();
  const stagedFiles = statusData?.staged?.files ?? [];
  const unstagedFiles = statusData?.unstaged?.files ?? [];
  const workingFiles = useMemo(
    () => [...stagedFiles, ...unstagedFiles],
    [stagedFiles, unstagedFiles],
  );

  const selectedPath = gitState.selectedPath;
  const selectedCommitSha = gitState.selectedCommit;

  const selectedFile = useMemo(
    () => (selectedPath ? (workingFiles.find((f) => f.path === selectedPath) ?? null) : null),
    [workingFiles, selectedPath],
  );
  const setSelectedFile = useCallback(
    (f: GitStatusFile | null) => {
      setGitState({ selectedPath: f?.path ?? null });
    },
    [setGitState],
  );

  const selectedCommit = useMemo(
    () => (selectedCommitSha ? (commits.find((c) => c.sha === selectedCommitSha) ?? null) : null),
    [commits, selectedCommitSha],
  );
  const setSelectedCommit = useCallback(
    (c: GitHistoryCommit | null) => {
      setGitState({ selectedCommit: c?.sha ?? null });
    },
    [setGitState],
  );

  const [diffContent, setDiffContent] = useState<Array<{ type: string; text: string }>>([]);
  const [commitStats, setCommitStats] = useState<{ ins: number; del: number }>({ ins: 0, del: 0 });

  useEffect(() => {
    if (!api || !cwd) return;
    let cancelled = false;

    if (diffMode === "working" && selectedFile) {
      api.git
        .diff({ cwd, path: selectedFile.path })
        .then((res: { patch?: string }) => {
          if (cancelled) return;
          if (res?.patch) {
            const lines = res.patch.split("\n").map((line: string) => {
              if (line.startsWith("@@")) return { type: "hunk", text: line };
              if (line.startsWith("+")) return { type: "add", text: line.slice(1) };
              if (line.startsWith("-")) return { type: "del", text: line.slice(1) };
              return { type: "ctx", text: line };
            });
            setDiffContent(lines);
          } else {
            setDiffContent([]);
          }
        })
        .catch(() => {
          if (!cancelled) setDiffContent([]);
        });
    } else if (diffMode === "history" && selectedCommit) {
      api.git
        .diff({ cwd, commit: selectedCommit.sha })
        .then((res: { patch?: string; stats?: { insertions?: number; deletions?: number } }) => {
          if (cancelled) return;
          if (res?.patch) {
            let ins = 0;
            let del = 0;
            const lines = res.patch.split("\n").map((line: string) => {
              if (line.startsWith("@@")) return { type: "hunk", text: line };
              if (line.startsWith("+") && !line.startsWith("+++")) {
                ins++;
                return { type: "add", text: line.slice(1) };
              }
              if (line.startsWith("-") && !line.startsWith("---")) {
                del++;
                return { type: "del", text: line.slice(1) };
              }
              return { type: "ctx", text: line };
            });
            setDiffContent(lines);
            setCommitStats({ ins: res.stats?.insertions ?? ins, del: res.stats?.deletions ?? del });
          } else {
            setDiffContent([]);
            setCommitStats({ ins: 0, del: 0 });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDiffContent([]);
            setCommitStats({ ins: 0, del: 0 });
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, cwd, diffMode, selectedFile, selectedCommit]);

  const list = diffMode === "working" ? workingFiles : commits;

  return (
    <div>
      <div
        className="tabs-segmented flex items-center mb-4 w-fit"
        role="group"
        aria-label="Diff source"
      >
        <button
          type="button"
          aria-pressed={diffMode === "working"}
          onClick={() => setDiffMode("working")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
            diffMode === "working"
              ? "bg-accent text-foreground"
              : "text-muted-foreground/70 hover:text-foreground"
          }`}
        >
          Working tree
        </button>
        <button
          type="button"
          aria-pressed={diffMode === "history"}
          onClick={() => setDiffMode("history")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
            diffMode === "history"
              ? "bg-accent text-foreground"
              : "text-muted-foreground/70 hover:text-foreground"
          }`}
        >
          Commit history
        </button>
      </div>

      {list.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground/70 py-10">
          {diffMode === "working" ? "Working tree is clean — nothing to diff." : "No commits yet."}
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden">
          <div className="w-64 shrink-0 h-full overflow-y-auto custom-scrollbar">
            {diffMode === "working"
              ? workingFiles.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setSelectedFile(f)}
                    className={`relative w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors cursor-pointer ${
                      selectedPath === f.path ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    {selectedPath === f.path && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
                        style={{ backgroundColor: "var(--fg)" }}
                      />
                    )}
                    <div className="flex items-center gap-2 min-w-0">
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
                      <FilePathLabel path={f.path} />
                    </div>
                  </button>
                ))
              : commits.map((c) => (
                  <button
                    key={c.sha}
                    type="button"
                    onClick={() => setSelectedCommit(c)}
                    className={`relative w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors cursor-pointer ${
                      selectedCommitSha === c.sha ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    {selectedCommitSha === c.sha && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
                        style={{ backgroundColor: "var(--fg)" }}
                      />
                    )}
                    <div className="text-xs text-foreground/90 truncate leading-snug">
                      {c.subject}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
                      {c.shortSha}
                    </div>
                  </button>
                ))}
          </div>
          <div className="flex-1 min-w-0 h-full">
            {diffMode === "working" ? (
              selectedFile ? (
                <DiffCard
                  path={selectedFile.path}
                  ins={selectedFile.insertions}
                  del={selectedFile.deletions}
                  lines={diffContent}
                />
              ) : (
                <div className="text-center text-xs text-muted-foreground/50 py-10">
                  Pick a file on the left.
                </div>
              )
            ) : selectedCommit ? (
              <DiffCard
                path={selectedCommit.subject}
                ins={commitStats.ins}
                del={commitStats.del}
                lines={diffContent}
              />
            ) : (
              <div className="text-center text-xs text-muted-foreground/50 py-10">
                Pick a commit on the left.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
