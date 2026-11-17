import { FileDiff, Virtualizer, type FileDiffMetadata } from "@pierre/diffs/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { openInPreferredEditor } from "~/editorPreferences";
import { readNativeApi } from "~/nativeApi";
import { resolvePathLinkTarget } from "~/terminal-links";
import { resolveDiffThemeName, resolveFileDiffPath } from "~/lib/diffRendering";
import { DIFF_PANEL_UNSAFE_CSS } from "~/lib/diffSurfaceCss";

export interface DiffViewOptions {
  split: boolean;
  wrap: boolean;
  theme: "light" | "dark";
  cwd: string | null;
}

export interface DiffFileStat {
  file: FileDiffMetadata;
  path: string;
  dir: string;
  name: string;
  additions: number;
  deletions: number;
}

export function diffFileStats(files: ReadonlyArray<FileDiffMetadata>): DiffFileStat[] {
  return files
    .map((file) => {
      const path = resolveFileDiffPath(file);
      const slash = path.lastIndexOf("/");
      return {
        file,
        path,
        dir: slash >= 0 ? path.slice(0, slash + 1) : "",
        name: slash >= 0 ? path.slice(slash + 1) : path,
        additions: file.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0),
        deletions: file.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0),
      };
    })
    .toSorted((left, right) =>
      left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" }),
    );
}

function fileKey(stat: DiffFileStat, theme: string) {
  return `${stat.file.cacheKey ?? `${stat.file.prevName ?? "none"}:${stat.file.name}`}:${theme}`;
}

function useOpenInEditor(cwd: string | null) {
  return useCallback(
    (path: string) => {
      const api = readNativeApi();
      if (!api) return;
      void openInPreferredEditor(api, cwd ? resolvePathLinkTarget(path, cwd) : path).catch(
        () => undefined,
      );
    },
    [cwd],
  );
}

/** One file with the diff library's own sticky header; clicking the title opens the editor. */
function RenderedFile({
  stat,
  options,
  onOpen,
}: {
  stat: DiffFileStat;
  options: DiffViewOptions;
  onOpen: (path: string) => void;
}) {
  return (
    <div
      data-diff-file-path={stat.path}
      className="cd-diff-file"
      onClickCapture={(event) => {
        const path = (event.nativeEvent as MouseEvent).composedPath?.() ?? [];
        if (path.some((node) => node instanceof Element && node.hasAttribute("data-title")))
          onOpen(stat.path);
      }}
    >
      <FileDiff
        fileDiff={stat.file}
        options={{
          diffStyle: options.split ? "split" : "unified",
          lineDiffType: "none",
          overflow: options.wrap ? "wrap" : "scroll",
          theme: resolveDiffThemeName(options.theme),
          themeType: options.theme,
          unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
        }}
      />
    </div>
  );
}

/** A five block bar like a pull request's, sized to the file's share of changed lines. */
export function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const added = total ? Math.round((additions / total) * 5) : 0;
  const removed = total ? Math.min(5 - added, Math.round((deletions / total) * 5)) : 0;
  return (
    <span className="cd-diff-bar" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <i
          key={index}
          data-kind={index < added ? "add" : index < added + removed ? "del" : "none"}
        />
      ))}
    </span>
  );
}

function FileRow({
  stat,
  selected,
  onClick,
}: {
  stat: DiffFileStat;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cd-diff-row"
      aria-current={selected ? "true" : undefined}
      title={stat.path}
      onClick={onClick}
    >
      <span className="cd-diff-row-path">
        <span className="cd-diff-row-name">{stat.name}</span>
        {stat.dir && <span className="cd-diff-row-dir">{stat.dir}</span>}
      </span>
      <span className="cd-diff-row-stat">
        <span className="cd-diff-add">+{stat.additions}</span>
        <span className="cd-diff-del">−{stat.deletions}</span>
      </span>
      <ChangeBar additions={stat.additions} deletions={stat.deletions} />
    </button>
  );
}

function SplitView({ stats, options }: { stats: DiffFileStat[]; options: DiffViewOptions }) {
  const open = useOpenInEditor(options.cwd);
  const viewport = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(stats[0]?.path ?? null);
  const jump = (path: string) => {
    setFocused(path);
    const container = viewport.current?.querySelector<HTMLElement>(".cd-diff-stream");
    const target = [
      ...(container?.querySelectorAll<HTMLElement>("[data-diff-file-path]") ?? []),
    ].find((element) => element.dataset.diffFilePath === path);
    if (!container || !target) return;
    // Scroll only the diff column. scrollIntoView would also scroll every clipped ancestor,
    // including the panel frame, and push the whole panel out of view.
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    container.scrollTo({ top: Math.max(0, top - 4), behavior: "smooth" });
  };
  return (
    <div className="cd-diff-split">
      <nav className="cd-diff-split-list" aria-label="Changed files">
        {stats.map((stat) => (
          <FileRow
            key={stat.path}
            stat={stat}
            selected={stat.path === focused}
            onClick={() => jump(stat.path)}
          />
        ))}
      </nav>
      <div ref={viewport} className="cd-diff-split-main">
        <Virtualizer
          className="cd-diff-stream"
          config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
        >
          {stats.map((stat) => (
            <RenderedFile
              key={fileKey(stat, options.theme)}
              stat={stat}
              options={options}
              onOpen={open}
            />
          ))}
        </Virtualizer>
      </div>
    </div>
  );
}

/** The working tree's changes: the file list beside every file's diff. */
export function CompanionDiffLayout({
  files,
  options,
}: {
  files: ReadonlyArray<FileDiffMetadata>;
  options: DiffViewOptions;
}) {
  const stats = useMemo(() => diffFileStats(files), [files]);
  return (
    <div className="cd-diff">
      <SplitView stats={stats} options={options} />
    </div>
  );
}
