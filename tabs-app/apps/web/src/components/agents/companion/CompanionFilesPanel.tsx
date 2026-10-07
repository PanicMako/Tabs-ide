import type { ThreadId } from "@tabs/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  FileCode,
  FileIcon,
  FileText,
  FolderTree,
  Search,
  X,
  ArrowLeft,
  RotateCcw,
} from "lucide-react";
import { memo, useMemo, useState, useCallback, useDeferredValue } from "react";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import {
  projectReadFileQueryOptions,
  projectSearchEntriesQueryOptions,
} from "~/lib/projectReactQuery";
import { useWorkspaceShellStore } from "~/workspaceShellStore";

function getFileIcon(path: string) {
  if (/\.(tsx?|jsx?|vue|svelte)$/i.test(path)) {
    return <FileCode className="size-3.5 text-blue-500 shrink-0" />;
  }
  if (/\.(md|mdx|txt|json|yaml|yml|toml)$/i.test(path)) {
    return <FileText className="size-3.5 text-amber-500 shrink-0" />;
  }
  return <FileIcon className="size-3.5 text-muted-foreground shrink-0" />;
}

export const CompanionFilesPanel = memo(function CompanionFilesPanel({
  threadId,
}: {
  threadId?: ThreadId | null | undefined;
}) {
  const target = useActiveProjectTarget(threadId);
  const [filterQuery, setFilterQuery] = useState("");

  const query = useDeferredValue(filterQuery.trim());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const file = useQuery(
    projectReadFileQueryOptions({
      cwd: target?.cwd ?? null,
      relativePath: selectedPath,
      environmentId: target?.environmentId,
    }),
  );
  const searchOptions = useMemo(
    () =>
      projectSearchEntriesQueryOptions({
        cwd: target?.cwd ?? null,
        query,
        kind: "file",
        limit: 200,
        environmentId: target?.environmentId ?? null,
        enabled: Boolean(target?.cwd),
      }),
    [target?.cwd, target?.environmentId, query],
  );

  const { data, isFetching, error, refetch } = useQuery(searchOptions);
  const entries = data?.entries ?? [];

  const filteredEntries = entries;

  const handleOpenFile = useCallback(
    (relativePath: string) => {
      if (!target) return;
      useWorkspaceShellStore.getState().setActiveTool(target.projectId, "code");
      useWorkspaceShellStore.getState().setCodeFocusedPath(target.projectId, relativePath);
      if (window.desktopBridge?.openCodeFile) {
        void window.desktopBridge
          .openCodeFile({
            projectId: target.projectId,
            relativePath,
            navigationNonce: Date.now(),
          })
          .catch((error: unknown) =>
            setOpenError(error instanceof Error ? error.message : String(error)),
          );
      }
    },
    [target],
  );

  if (!target) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-muted-foreground">
        <FolderTree className="mb-2 size-8 opacity-40" />
        <p className="text-xs font-medium">No active project workspace</p>
        <p className="text-[11px] text-muted-foreground/80 mt-1">
          Open a project or thread with a workspace root to browse files.
        </p>
      </div>
    );
  }

  if (selectedPath)
    return (
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
          <button
            type="button"
            aria-label="Back to files"
            onClick={() => setSelectedPath(null)}
            className="rounded-md p-2 hover:bg-muted"
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={selectedPath}>
            {selectedPath}
          </span>
          <button
            type="button"
            aria-label="Refresh file"
            onClick={() => void file.refetch()}
            className="rounded-md p-2 hover:bg-muted"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => handleOpenFile(selectedPath)}
            className="rounded-md px-2 py-1 text-xs hover:bg-muted"
          >
            Open in Code
          </button>
        </div>
        {openError && (
          <p role="alert" className="p-3 text-sm text-destructive">
            {openError}
          </p>
        )}
        {file.isFetching ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Loading file...
          </p>
        ) : file.error ? (
          <div role="alert" className="p-4 text-sm">
            <p>{file.error.message}</p>
            <button type="button" onClick={() => void file.refetch()} className="mt-2 underline">
              Retry
            </button>
          </div>
        ) : (
          <>
            {file.data?.truncated && (
              <p className="border-b border-border p-2 text-xs text-muted-foreground">
                Preview truncated. Open in Code for the full file.
              </p>
            )}
            <pre
              tabIndex={0}
              aria-label={`Contents of ${selectedPath}`}
              className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-6 selection:bg-primary/20"
            >
              {file.data?.contents}
            </pre>
          </>
        )}
      </div>
    );

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-background text-foreground">
      {/* Header & Filter */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/70 bg-muted/20 p-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-foreground truncate max-w-[200px]">
            {target.projectName}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {filteredEntries.length} {filteredEntries.length === 1 ? "file" : "files"}
            <button
              type="button"
              aria-label="Refresh files"
              onClick={() => void refetch()}
              className="ml-2 rounded p-1 hover:bg-muted"
            >
              <RotateCcw className="size-3" />
            </button>
          </span>
        </div>
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            aria-label="Search project files"
            placeholder="Search project files..."
            className="h-7 w-full rounded-md border border-border/80 bg-background/80 pl-6.5 pr-6 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden"
          />
          {filterQuery && (
            <button
              type="button"
              aria-label="Clear file search"
              onClick={() => setFilterQuery("")}
              className="absolute right-1.5 inline-flex size-4 items-center justify-center rounded-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {data?.truncated && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          More files available. Search to narrow the results.
        </p>
      )}
      {/* File List */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1 text-xs">
        {error ? (
          <div role="alert" className="p-4">
            <p>{error.message}</p>
            <button type="button" onClick={() => void refetch()} className="mt-2 underline">
              Retry
            </button>
          </div>
        ) : isFetching ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-xs">
            Loading files...
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-xs">
            {filterQuery ? "No matching files" : "No files in project"}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const parts = entry.path.split("/");
            const fileName = parts.pop() ?? entry.path;
            const dirPath = parts.join("/");

            return (
              <button
                key={entry.path}
                type="button"
                onClick={() => setSelectedPath(entry.path)}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 cursor-pointer"
              >
                {getFileIcon(entry.path)}
                <div className="min-w-0 flex-1 truncate">
                  <span className="text-foreground group-hover:text-primary font-medium">
                    {fileName}
                  </span>
                  {dirPath && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/70 font-mono">
                      {dirPath}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});
