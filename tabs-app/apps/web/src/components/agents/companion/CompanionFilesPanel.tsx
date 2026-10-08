import type { ThreadId, ProjectEntry } from "@tabs/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File as SourceFile } from "@pierre/diffs/react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Search,
  X,
  ArrowLeft,
  RotateCcw,
  Copy,
  Pencil,
  Save,
  PanelLeft,
} from "lucide-react";
import { memo, useState, useDeferredValue, useEffect, useRef } from "react";
import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import {
  projectReadFileQueryOptions,
  projectSearchEntriesQueryOptions,
  projectDirectoryQueryOptions,
  projectQueryKeys,
} from "~/lib/projectReactQuery";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { useCompanionSurfaceStore, type CompanionSurface } from "~/stores/companionSurfaceStore";
import { showCustomConfirm } from "~/lib/customConfirm";
import { Button } from "~/components/ui/button";
import ChatMarkdown from "~/components/ChatMarkdown";
import { useTheme } from "~/hooks/useTheme";
import { CompanionHeading, CompanionEmpty } from "./CompanionChrome";
import { filePreviewKind, parseDelimitedPreview } from "./filePreview";

function EntryIcon({ entry, expanded }: { entry: ProjectEntry; expanded?: boolean }) {
  return entry.kind === "directory" ? (
    expanded ? (
      <FolderOpen size={14} className="shrink-0 text-amber-500" />
    ) : (
      <Folder size={14} className="shrink-0 text-amber-500" />
    )
  ) : (
    <File size={14} className="shrink-0 text-muted-foreground" />
  );
}
function Directory({
  target,
  path,
  depth,
  selected,
  onSelect,
  root = false,
}: {
  target: ActiveProjectTarget;
  path: string;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
  root?: boolean;
}) {
  const [expanded, setExpanded] = useState(root);
  const directory = useQuery(
    projectDirectoryQueryOptions({
      cwd: target.cwd,
      directoryPath: path,
      environmentId: target.environmentId,
      enabled: expanded,
    }),
  );
  const entries = [...(directory.data?.entries ?? [])].sort((a, b) =>
    a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "directory" ? -1 : 1,
  );
  return (
    <div
      role={root ? "tree" : "group"}
      aria-label={root ? "Project file tree" : undefined}
      onKeyDown={
        root
          ? (event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
              ];
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              items[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : Math.max(
                        0,
                        Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
                      )
              ]?.focus();
            }
          : undefined
      }
    >
      {!root && (
        <button
          type="button"
          role="treeitem"
          aria-expanded={expanded}
          className="companion-file-row"
          style={{ paddingLeft: depth * 14 + 8 }}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setExpanded(true);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setExpanded(false);
            }
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <EntryIcon entry={{ path, kind: "directory" }} expanded={expanded} />
          <span className="truncate">{path.split("/").pop()}</span>
        </button>
      )}
      {expanded && (
        <>
          {directory.isPending ? (
            <p role="status" className="px-4 py-2 text-[11px] text-muted-foreground">
              Loading folder...
            </p>
          ) : directory.error ? (
            <div role="alert" className="p-3 text-xs">
              <p>{directory.error.message}</p>
              <button
                type="button"
                className="mt-1 underline"
                onClick={() => void directory.refetch()}
              >
                Retry folder
              </button>
            </div>
          ) : entries.length === 0 ? (
            <p className="px-4 py-2 text-[11px] text-muted-foreground">Empty folder</p>
          ) : (
            entries.map((entry) =>
              entry.kind === "directory" ? (
                <Directory
                  key={entry.path}
                  target={target}
                  path={entry.path}
                  depth={root ? depth : depth + 1}
                  selected={selected}
                  onSelect={onSelect}
                />
              ) : (
                <button
                  key={entry.path}
                  type="button"
                  role="treeitem"
                  aria-selected={selected === entry.path}
                  title={entry.path}
                  className="companion-file-row"
                  style={{ paddingLeft: (root ? depth : depth + 1) * 14 + 22 }}
                  onClick={() => onSelect(entry.path)}
                >
                  <EntryIcon entry={entry} />
                  <span className="truncate">{entry.path.split("/").pop()}</span>
                </button>
              ),
            )
          )}
          {directory.data?.truncated && (
            <p className="companion-note">
              Folder listing truncated. Use search to locate more files.
            </p>
          )}
        </>
      )}
    </div>
  );
}
function FilePreview({
  target,
  path,
  surface,
  scope,
  onBack,
}: {
  target: ActiveProjectTarget;
  path: string;
  surface: CompanionSurface | undefined;
  scope: string | undefined;
  onBack: () => void;
}) {
  const kind = filePreviewKind(path);
  const binary = ["image", "video", "audio", "pdf"].includes(kind);
  const client = useQueryClient();
  const { resolvedTheme } = useTheme();
  const [sourceMode, setSourceMode] = useState(false);
  const [editing, setEditing] = useState(surface?.draftContents !== undefined);
  const [draft, setDraft] = useState(surface?.draftContents ?? "");
  const [saving, setSaving] = useState(false);
  const editBase = useRef<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const update = useCompanionSurfaceStore((store) => store.update);
  const file = useQuery(
    projectReadFileQueryOptions({
      cwd: target.cwd,
      relativePath: path,
      environmentId: target.environmentId,
      enabled: !binary,
    }),
  );
  const asset = useQuery({
    queryKey: ["companion-media", target.environmentId, target.cwd, path],
    enabled: binary,
    queryFn: async () =>
      (await environmentApi(target.environmentId)).assets.createUrl({
        resource: { _tag: "draft-workspace-file", cwd: target.cwd, path },
      }),
    staleTime: 60_000,
    refetchInterval: 4 * 60_000,
  });
  const setDraftValue = (value: string) => {
    setDraft(value);
    if (scope && surface) update(scope, surface.id, { draftContents: value });
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const api = await environmentApi(target.environmentId);
      const current = await api.projects.readFile({ cwd: target.cwd, relativePath: path });
      if (current.truncated)
        throw new Error("This file is now too large to edit here. Open the full file in Code.");
      if (
        current.contents !== editBase.current &&
        !(await showCustomConfirm(
          "This file changed on disk. Replace it with your edited version?",
        ))
      )
        return;
      await api.projects.writeFile({ cwd: target.cwd, relativePath: path, contents: draft });
      client.setQueryData(projectQueryKeys.readFile(target.environmentId, target.cwd, path), {
        relativePath: path,
        contents: draft,
        byteLength: new TextEncoder().encode(draft).length,
        truncated: false,
      });
      if (scope && surface) update(scope, surface.id, { draftContents: undefined });
      setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };
  const openCode = async () => {
    try {
      useWorkspaceShellStore.getState().setActiveTool(target.projectId, "code");
      useWorkspaceShellStore.getState().setCodeFocusedPath(target.projectId, path);
      await window.desktopBridge?.openCodeFile({
        projectId: target.projectId,
        relativePath: path,
        navigationNonce: Date.now(),
      });
    } catch (failure) {
      setError(String(failure));
    }
  };
  const failed = error ?? file.error?.message ?? asset.error?.message;
  const loading = binary ? asset.isPending : file.isFetching;
  const table =
    kind === "csv" && file.data
      ? parseDelimitedPreview(file.data.contents, path.toLowerCase().endsWith(".tsv") ? "\t" : ",")
      : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="companion-toolbar">
        <button
          type="button"
          aria-label="Back to files"
          title="Back to files"
          className="companion-icon-button"
          onClick={onBack}
        >
          <ArrowLeft size={15} />
        </button>
        <span title={path} className="min-w-0 flex-1 truncate font-mono text-[11px]">
          {path}
        </span>
        {!binary && !editing && !file.data?.truncated && (
          <button
            type="button"
            aria-label="Edit file"
            title="Edit file"
            className="companion-icon-button"
            disabled={!file.data || loading}
            onClick={() => {
              editBase.current = file.data!.contents;
              setDraftValue(file.data!.contents);
              setEditing(true);
            }}
          >
            <Pencil size={14} />
          </button>
        )}
        {!binary && !editing && (
          <button
            type="button"
            aria-label="Copy file contents"
            title="Copy contents"
            className="companion-icon-button"
            disabled={!file.data}
            onClick={() => {
              void navigator.clipboard
                .writeText(file.data?.contents ?? "")
                .catch((failure: unknown) => setError(String(failure)));
            }}
          >
            <Copy size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label="Refresh file"
          title="Refresh file"
          disabled={editing}
          className="companion-icon-button"
          onClick={() => {
            setError(null);
            void (binary ? asset.refetch() : file.refetch());
          }}
        >
          <RotateCcw size={14} />
        </button>
        <Button size="xs" variant="ghost" onClick={() => void openCode()}>
          Code
        </Button>
      </div>
      {editing ? (
        <div className="companion-toolbar">
          <span className="flex-1 text-xs text-muted-foreground">Unsaved changes</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={saving}
            onClick={async () => {
              if (await showCustomConfirm("Discard your unsaved file changes?")) {
                setEditing(false);
                if (scope && surface) update(scope, surface.id, { draftContents: undefined });
              }
            }}
          >
            Discard
          </Button>
          <Button size="xs" disabled={saving} onClick={() => void save()}>
            <Save size={12} />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      ) : !binary && kind !== "text" ? (
        <div className="companion-toolbar" role="group" aria-label="File display">
          <button
            type="button"
            aria-pressed={!sourceMode}
            onClick={() => setSourceMode(false)}
            className="rounded-lg px-3 py-1 text-xs aria-pressed:bg-muted"
          >
            Preview
          </button>
          <button
            type="button"
            aria-pressed={sourceMode}
            onClick={() => setSourceMode(true)}
            className="rounded-lg px-3 py-1 text-xs aria-pressed:bg-muted"
          >
            Source
          </button>
        </div>
      ) : null}
      {failed && (
        <div role="alert" className="companion-note">
          <p>{failed}</p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => {
              setError(null);
              void (binary ? asset.refetch() : file.refetch());
            }}
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <p role="status" className="p-4 text-xs text-muted-foreground">
          Loading file...
        </p>
      ) : (
        !failed && (
          <>
            {binary && asset.data ? (
              kind === "pdf" ? (
                <iframe
                  className="min-h-0 flex-1 w-full border-0"
                  title={`PDF preview: ${path}`}
                  src={asset.data.relativeUrl}
                />
              ) : (
                <div className="companion-media">
                  {kind === "image" ? (
                    <img
                      src={asset.data.relativeUrl}
                      alt={path}
                      onError={() =>
                        setError("This image could not be decoded. Refresh or open it in Code.")
                      }
                    />
                  ) : kind === "video" ? (
                    <video
                      controls
                      preload="metadata"
                      src={asset.data.relativeUrl}
                      onError={() =>
                        setError("This video format cannot be played in this browser.")
                      }
                    />
                  ) : (
                    <audio
                      controls
                      preload="metadata"
                      src={asset.data.relativeUrl}
                      onError={() =>
                        setError("This audio format cannot be played in this browser.")
                      }
                    />
                  )}
                </div>
              )
            ) : null}
            {!binary && file.data && (
              <>
                {file.data.truncated && (
                  <p className="companion-note">
                    Preview truncated at 1 MB. Open in Code for the full file.
                  </p>
                )}
                {editing ? (
                  <div className="companion-source">
                    <textarea
                      aria-label={`Edit ${path}`}
                      spellCheck={false}
                      value={draft}
                      onChange={(event) => setDraftValue(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                          event.preventDefault();
                          void save();
                        }
                      }}
                    />
                  </div>
                ) : kind === "markdown" && !sourceMode ? (
                  <div className="companion-content">
                    <ChatMarkdown text={file.data.contents} cwd={target.cwd} />
                  </div>
                ) : table && !sourceMode ? (
                  <div className="companion-content">
                    <table className="companion-data-table">
                      <thead>
                        <tr>
                          {table.rows[0]?.slice(0, 50).map((cell, index) => (
                            <th key={index} scope="col">
                              {cell || `Column ${index + 1}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.slice(1).map((row, index) => (
                          <tr key={index}>
                            {row.slice(0, 50).map((cell, col) => (
                              <td key={col}>{cell.slice(0, 2000)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {table.rows.some(
                      (row) => row.length > 50 || row.some((cell) => cell.length > 2000),
                    ) && (
                      <p className="companion-note">
                        Table preview limits columns to 50 and cells to 2,000 characters. Switch to
                        Source for the full text.
                      </p>
                    )}
                    {table.truncated && (
                      <p className="companion-note">Showing the first 1,000 rows.</p>
                    )}
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto" aria-label={`Contents of ${path}`}>
                    <pre className="sr-only">{file.data.contents}</pre>
                    <div aria-hidden="true">
                      <SourceFile
                        file={{ name: path, contents: file.data.contents }}
                        options={{
                          theme: resolvedTheme === "dark" ? "github-dark" : "github-light",
                          disableFileHeader: true,
                          overflow: "scroll",
                        }}
                        disableWorkerPool
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )
      )}
    </div>
  );
}
export const CompanionFilesPanel = memo(function CompanionFilesPanel({
  threadId,
  surface,
  scope,
}: {
  threadId?: ThreadId | null | undefined;
  surface?: CompanionSurface | undefined;
  scope?: string | undefined;
}) {
  const target = useActiveProjectTarget(threadId);
  const client = useQueryClient();
  const [filter, setFilter] = useState("");
  const query = useDeferredValue(filter.trim());
  const [selected, setSelected] = useState<string | null>(surface?.selectedPath ?? null);
  const [treeVisible, setTreeVisible] = useState(false);
  const update = useCompanionSurfaceStore((store) => store.update);
  const search = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: target?.cwd ?? null,
      query,
      kind: "file",
      limit: 200,
      environmentId: target?.environmentId,
      enabled: !!target && !!query,
    }),
  );
  useEffect(() => {
    if (surface?.selectedPath !== undefined) setSelected(surface.selectedPath || null);
  }, [surface?.selectedPath]);
  const select = async (path: string | null) => {
    if (
      surface?.draftContents !== undefined &&
      path !== selected &&
      !(await showCustomConfirm("Discard your unsaved file changes?"))
    )
      return;
    setSelected(path);
    if (scope && surface)
      update(scope, surface.id, { selectedPath: path ?? "", draftContents: undefined });
  };
  if (!target)
    return (
      <CompanionEmpty kind="files" title="Choose a workspace">
        Open a project or thread to browse files.
      </CompanionEmpty>
    );
  return (
    <div className="companion-workspace">
      <CompanionHeading
        kind="files"
        detail={target.projectName}
        actions={
          <>
            {selected && (
              <button
                type="button"
                aria-label="Toggle file tree"
                title="Toggle file tree"
                aria-pressed={treeVisible}
                className="companion-icon-button"
                onClick={() => setTreeVisible(!treeVisible)}
              >
                <PanelLeft size={15} />
              </button>
            )}
            <button
              type="button"
              aria-label="Refresh files"
              className="companion-icon-button"
              onClick={() => {
                void client.invalidateQueries({ queryKey: ["projects", target.environmentId] });
              }}
            >
              <RotateCcw size={15} />
            </button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        {(!selected || treeVisible) && (
          <aside
            className={
              selected
                ? "w-[200px] min-w-0 shrink-0 overflow-auto border-r border-border"
                : "min-w-0 flex-1 overflow-auto"
            }
          >
            <div className="companion-toolbar">
              <Search size={14} className="shrink-0 text-muted-foreground" />
              <input
                aria-label="Search project files"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                placeholder="Find a file..."
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              {filter && (
                <button
                  type="button"
                  aria-label="Clear file search"
                  className="companion-icon-button"
                  onClick={() => setFilter("")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="p-2">
              {query ? (
                search.error ? (
                  <div role="alert" className="companion-note">
                    <p>{search.error.message}</p>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void search.refetch()}
                    >
                      Retry search
                    </button>
                  </div>
                ) : search.isFetching ? (
                  <p role="status" className="p-3 text-xs text-muted-foreground">
                    Searching...
                  </p>
                ) : search.data?.entries.length ? (
                  <>
                    {search.data.entries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        className="companion-file-row"
                        onClick={() => void select(entry.path)}
                      >
                        <EntryIcon entry={entry} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{entry.path.split("/").pop()}</span>
                          <span className="block truncate font-mono text-[9px] text-muted-foreground">
                            {entry.path.includes("/")
                              ? entry.path.slice(0, entry.path.lastIndexOf("/"))
                              : "Workspace root"}
                          </span>
                        </span>
                      </button>
                    ))}
                    {search.data.truncated && (
                      <p className="companion-note">More results available. Refine your search.</p>
                    )}
                  </>
                ) : (
                  <CompanionEmpty kind="files" title="No matching files">
                    Try a different filename.
                  </CompanionEmpty>
                )
              ) : (
                <Directory
                  root
                  target={target}
                  path=""
                  depth={0}
                  selected={selected}
                  onSelect={(path) => void select(path)}
                />
              )}
            </div>
          </aside>
        )}
        {selected && (
          <FilePreview
            key={selected}
            target={target}
            path={selected}
            surface={surface}
            scope={scope}
            onBack={() => void select(null)}
          />
        )}
      </div>
    </div>
  );
});
