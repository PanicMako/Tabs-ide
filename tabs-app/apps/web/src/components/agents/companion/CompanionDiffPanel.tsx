import { lazy, Suspense, useMemo, useState } from "react";
import type { ThreadId } from "@tabs/contracts";
import { useQuery } from "@tanstack/react-query";
import { Columns2Icon, RotateCcw, Rows2Icon, WrapTextIcon } from "lucide-react";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { gitDiffQueryOptions } from "~/lib/gitReactQuery";
import { CompanionEmpty } from "./CompanionChrome";
import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import { getRenderablePatch } from "~/lib/diffRendering";
import { CompanionDiffLayout, diffFileStats } from "./CompanionDiffLayouts";
const TurnDiff = lazy(() => import("~/components/DiffPanel"));

export function CompanionDiffPanel({ threadId }: { threadId?: ThreadId | null | undefined }) {
  const target = useActiveProjectTarget(threadId);
  const [view, setView] = useState<"working" | "turns">("working");
  const [split, setSplit] = useState(false);
  const { resolvedTheme } = useTheme();
  const [wrap, setWrap] = useState(true);
  const patch = useQuery({
    ...gitDiffQueryOptions({
      cwd: target?.cwd ?? null,
      path: ".",
      environmentId: target?.environmentId ?? undefined,
    }),
    enabled: Boolean(target && view === "working"),
  });
  const renderable = useMemo(
    () => getRenderablePatch(patch.data?.patch, `companion-diff:${resolvedTheme}`),
    [patch.data?.patch, resolvedTheme],
  );
  const totals = useMemo(() => {
    if (renderable?.kind !== "files") return null;
    const stats = diffFileStats(renderable.files);
    return {
      files: stats.length,
      additions: stats.reduce((sum, stat) => sum + stat.additions, 0),
      deletions: stats.reduce((sum, stat) => sum + stat.deletions, 0),
    };
  }, [renderable]);
  if (target)
    return (
      <div className="companion-workspace cd-diff-surface">
        <div className="cd-diff-toolbar" role="group" aria-label="Changes">
          <div className="cd-diff-source" role="tablist" aria-label="Changes source">
            {(
              [
                ["working", "Working tree"],
                ["turns", "By agent turn"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "working" && (
            <div className="cd-diff-toggles">
              {totals && (
                <span className="cd-diff-summary" aria-live="polite">
                  {totals.files} {totals.files === 1 ? "file" : "files"}
                  <span className="cd-diff-add">+{totals.additions}</span>
                  <span className="cd-diff-del">−{totals.deletions}</span>
                </span>
              )}
              <div className="cd-seg" role="group" aria-label="Diff layout">
                <button
                  type="button"
                  aria-pressed={!split}
                  aria-label="One column"
                  title="One column: removed and added lines together"
                  onClick={() => setSplit(false)}
                >
                  <Rows2Icon aria-hidden="true" size={13} />
                </button>
                <button
                  type="button"
                  aria-pressed={split}
                  aria-label="Side by side"
                  title="Side by side: before on the left, after on the right"
                  onClick={() => setSplit(true)}
                >
                  <Columns2Icon aria-hidden="true" size={13} />
                </button>
              </div>
              <button
                type="button"
                className="cd-seg-toggle"
                aria-pressed={wrap}
                aria-label="Wrap long lines"
                title={wrap ? "Long lines wrap to fit" : "Long lines scroll sideways"}
                onClick={() => setWrap(!wrap)}
              >
                <WrapTextIcon aria-hidden="true" size={13} />
              </button>
              <button
                type="button"
                aria-label="Refresh changes"
                title="Refresh changes"
                className="cd-icon"
                disabled={patch.isFetching}
                onClick={() => void patch.refetch()}
              >
                <RotateCcw
                  size={14}
                  className={patch.isFetching ? "animate-spin motion-reduce:animate-none" : ""}
                />
              </button>
            </div>
          )}
        </div>
        <DiffWorkerPoolProvider>
          {view === "turns" ? (
            <Suspense
              fallback={
                <p role="status" className="companion-note">
                  Loading turn changes...
                </p>
              }
            >
              <TurnDiff mode="sidebar" />
            </Suspense>
          ) : patch.error ? (
            <div role="alert" className="companion-note">
              <p>{patch.error.message}</p>
              <button type="button" className="underline" onClick={() => void patch.refetch()}>
                Retry
              </button>
            </div>
          ) : patch.isPending ? (
            <p role="status" className="companion-note">
              Loading changes...
            </p>
          ) : !renderable ? (
            <CompanionEmpty kind="diff" title="All clear">
              There are no tracked changes in the working tree. New files appear in the Git
              workspace.
            </CompanionEmpty>
          ) : renderable.kind === "raw" ? (
            <div className="companion-content">
              <p role="alert" className="companion-note">
                {renderable.reason}
              </p>
              <pre className="whitespace-pre-wrap font-mono text-xs">{renderable.text}</pre>
            </div>
          ) : (
            <CompanionDiffLayout
              files={renderable.files}
              options={{ split, wrap, theme: resolvedTheme, cwd: target.cwd }}
            />
          )}
        </DiffWorkerPoolProvider>
      </div>
    );
  return (
    <CompanionEmpty kind="diff" title="Choose a repository">
      Open a project to inspect its changes.
    </CompanionEmpty>
  );
}
