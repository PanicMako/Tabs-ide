import { useQuery } from "@tanstack/react-query";
import { FileCode, FileIcon, FileText, FolderTree, Search, X } from "lucide-react";
import { memo, useMemo, useState, useCallback } from "react";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import { cn } from "~/lib/utils";

function getFileIcon(path: string) {
  if (/\.(tsx?|jsx?|vue|svelte)$/i.test(path)) {
    return <FileCode className="size-3.5 text-blue-500 shrink-0" />;
  }
  if (/\.(md|mdx|txt|json|yaml|yml|toml)$/i.test(path)) {
    return <FileText className="size-3.5 text-amber-500 shrink-0" />;
  }
  return <FileIcon className="size-3.5 text-muted-foreground shrink-0" />;
}

export const CompanionFilesPanel = memo(function CompanionFilesPanel() {
  const target = useActiveProjectTarget();
  const [filterQuery, setFilterQuery] = useState("");

  const searchOptions = useMemo(
    () =>
      projectSearchEntriesQueryOptions({
        cwd: target?.cwd ?? null,
        query: "",
        limit: 200,
        environmentId: target?.environmentId ?? null,
        enabled: Boolean(target?.cwd),
      }),
    [target?.cwd, target?.environmentId],
  );

  const { data, isLoading } = useQuery(searchOptions);
  const entries = data?.entries ?? [];

  const filteredEntries = useMemo(() => {
    if (!filterQuery.trim()) return entries;
    const lower = filterQuery.toLowerCase();
    return entries.filter(
      (entry) =>
        entry.path.toLowerCase().includes(lower) ||
        (entry.path.split("/").pop() ?? "").toLowerCase().includes(lower),
    );
  }, [entries, filterQuery]);

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
          .catch(() => undefined);
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
          </span>
        </div>
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter files..."
            className="h-7 w-full rounded-md border border-border/80 bg-background/80 pl-6.5 pr-6 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              className="absolute right-1.5 inline-flex size-4 items-center justify-center rounded-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* File List */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1 text-xs">
        {isLoading ? (
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
                onClick={() => handleOpenFile(entry.path)}
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
