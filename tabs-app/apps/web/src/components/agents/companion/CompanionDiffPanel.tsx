import { lazy, Suspense, useMemo, useState } from "react";
import type { ThreadId } from "@tabs/contracts";
import { useQuery } from "@tanstack/react-query";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import { RotateCcw } from "lucide-react";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { gitDiffQueryOptions } from "~/lib/gitReactQuery";
import { CompanionHeading, CompanionEmpty } from "./CompanionChrome";
import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
const TurnDiff = lazy(() => import("~/components/DiffPanel"));

export function CompanionDiffPanel({ threadId }: { threadId?: ThreadId | null | undefined }) {
  const target = useActiveProjectTarget(threadId);
  const [view, setView] = useState<"working" | "turns">("working");
  const [split, setSplit] = useState(false);
  const { resolvedTheme } = useTheme();
  const patch = useQuery({
    ...gitDiffQueryOptions({
      cwd: target?.cwd ?? null,
      path: ".",
      environmentId: target?.environmentId ?? undefined,
    }),
    enabled: Boolean(target && view === "working"),
  });
  const parsed = useMemo(() => {
    try {
      return {
        files: parsePatchFiles(patch.data?.patch ?? "").flatMap((entry) => entry.files),
        error: null,
      };
    } catch {
      return {
        files: [],
        error: "This patch cannot be rendered. You can inspect its raw text below.",
      };
    }
  }, [patch.data?.patch]);
  if (!target)
    return (
      <CompanionEmpty kind="diff" title="Choose a repository">
        Open a project to inspect its changes.
      </CompanionEmpty>
    );
  return (
    <div className="companion-workspace">
      <CompanionHeading
        kind="diff"
        detail={target.projectName}
        actions={
          <button
            type="button"
            aria-label="Refresh changes"
            className="companion-icon-button"
            onClick={() => void patch.refetch()}
          >
            <RotateCcw size={15} />
          </button>
        }
      />
      <div className="companion-toolbar" role="group" aria-label="Changes source">
        <button
          type="button"
          aria-pressed={view === "working"}
          className="companion-segment"
          onClick={() => setView("working")}
        >
          Working tree
        </button>
        <button
          type="button"
          aria-pressed={view === "turns"}
          className="companion-segment"
          onClick={() => setView("turns")}
        >
          Agent turns
        </button>
        {view === "working" && (
          <button
            type="button"
            aria-pressed={split}
            className="companion-segment ml-auto"
            onClick={() => setSplit(!split)}
          >
            {split ? "Split" : "Unified"}
          </button>
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
        ) : !patch.data?.patch ? (
          <CompanionEmpty kind="diff" title="All clear">
            There are no tracked changes in the working tree. New files appear in the Git workspace.
          </CompanionEmpty>
        ) : (
          <div className="companion-content">
            {parsed.error ? (
              <>
                <p role="alert" className="companion-note">
                  {parsed.error}
                </p>
                <pre className="whitespace-pre-wrap font-mono text-xs">{patch.data.patch}</pre>
              </>
            ) : parsed.files.length ? (
              parsed.files.map((file, index) => (
                <div
                  key={`${file.name}:${index}:${resolvedTheme}`}
                  className="mb-3 overflow-hidden rounded-xl border border-border"
                >
                  <FileDiff
                    fileDiff={file}
                    options={{
                      theme: resolvedTheme === "dark" ? "github-dark" : "github-light",
                      diffStyle: split ? "split" : "unified",
                      overflow: "wrap",
                    }}
                  />
                </div>
              ))
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-xs">{patch.data.patch}</pre>
            )}
          </div>
        )}
      </DiffWorkerPoolProvider>
    </div>
  );
}
