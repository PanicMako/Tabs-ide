import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_MODEL, type ManagedWorktree, type StorageInventory } from "@tabs/contracts";
import { projectsAtom } from "~/state/threads";
import { useWorkspaceActiveProjectId, workspaceShellActions } from "~/state/workspaceShell";
import { getPrimaryEnvironmentId } from "~/connection/environmentApiRegistry";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useConfirm } from "~/hooks/useConfirm";
import { ensureNativeApi } from "~/nativeApi";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { useNavigate } from "@tanstack/react-router";
import { newCommandId, newProjectId } from "~/lib/utils";
import { makeAppModelSelection } from "~/modelSelection";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RefreshCwIcon } from "lucide-react";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import "./workspace-maintenance.css";

const bytes = (value: number) =>
  value < 1024 * 1024
    ? `${(value / 1024).toFixed(1)} KB`
    : value < 1024 ** 3
      ? `${(value / 1024 ** 2).toFixed(1)} MB`
      : `${(value / 1024 ** 3).toFixed(2)} GB`;
export default function WorkspaceMaintenanceSettings() {
  const projects = useAtomValue(projectsAtom).filter(
    (p) => p.environmentId === getPrimaryEnvironmentId(),
  );
  const activeId = useWorkspaceActiveProjectId();
  const [projectId, setProjectId] = useState(activeId ?? projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId);
  const [worktrees, setWorktrees] = useState<readonly ManagedWorktree[]>([]);
  const [storage, setStorage] = useState<StorageInventory | null>(null);
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("HEAD");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const { handleNewThread } = useHandleNewThread();
  const navigate = useNavigate();
  const cleanup = useSettings((s) => s.storageCleanup);
  const { updateSettings: update } = useUpdateSettings();
  const generation = useRef(0);
  const refresh = async () => {
    const revision = ++generation.current;
    const api = ensureNativeApi().maintenance;
    if (!api)
      throw new Error(
        "Workspace maintenance is unavailable. Restart the desktop app after updating.",
      );
    const [files, trees] = await Promise.all([
      api.inspectStorage(),
      project ? api.inspectWorktrees(project.cwd) : Promise.resolve([]),
    ]);
    if (revision === generation.current) {
      setStorage(files);
      setWorktrees(trees);
    }
  };
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void perform(async () => {});
    return () => {
      generation.current++;
    };
  }, [project?.cwd]);
  const openWorktree = async (entry: ManagedWorktree) => {
    const existing = projects.find((p) => p.cwd === entry.path);
    const id = existing?.id ?? newProjectId();
    if (!existing)
      await ensureNativeApi().orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId: id,
        title: entry.branch ?? "Worktree",
        workspaceRoot: entry.path,
        defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
        createdAt: new Date().toISOString(),
      });
    workspaceShellActions.openProject(id);
    workspaceShellActions.setActiveProject(id);
    workspaceShellActions.setActiveTool(id, "code");
    await navigate({ to: "/" });
  };
  return (
    <div className="workspace-maintenance space-y-6" aria-busy={busy}>
      <SettingsSectionHeader
        title="Worktrees & Storage"
        description="Manage isolated checkouts and reclaim old application logs on this computer."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void perform(async () => {})}
          >
            <RefreshCwIcon className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
            {busy ? "Inspecting…" : "Refresh inventory"}
          </Button>
        }
      />
      {(busy || message || error) && (
        <div
          className="text-xs leading-relaxed"
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          <span className={error ? "text-destructive" : "text-muted-foreground"}>
            {error ?? (busy ? "Inspecting worktrees and application storage…" : message)}
          </span>
        </div>
      )}
      <SettingsSection
        title="Git worktrees"
        description="Open a checkout, start an agent, or create an isolated branch."
        contentClassName="maintenance-panel"
      >
        <div className="maintenance-controls">
          <label className="sr-only" htmlFor="maintenance-repository">
            Repository
          </label>
          <select
            id="maintenance-repository"
            aria-label="Repository"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {project && (
          <form
            className="maintenance-controls"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const result = await ensureNativeApi().git.createWorktree({
                  cwd: project.cwd,
                  branch: base.trim() || "HEAD",
                  newBranch: branch.trim(),
                  path: null,
                });
                setMessage(`Created ${result.worktree.branch} at ${result.worktree.path}`);
                setBranch("");
              });
            }}
          >
            <label className="maintenance-field">
              <span>New branch</span>
              <Input
                required
                aria-label="New worktree branch"
                placeholder="feature/my-task"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </label>
            <label className="maintenance-field">
              <span>Base branch or commit</span>
              <Input
                aria-label="Base branch or commit"
                placeholder="HEAD"
                value={base}
                onChange={(e) => setBase(e.target.value)}
              />
            </label>
            <Button
              className="self-end"
              variant="outline"
              size="sm"
              disabled={busy || !branch.trim()}
              type="submit"
            >
              Create worktree
            </Button>
          </form>
        )}
        {!project && <p>Select a local project to inspect its worktrees.</p>}
        <div className="maintenance-list">
          {!busy && project && worktrees.length === 0 && (
            <p className="maintenance-empty">No worktrees found for this repository.</p>
          )}
          {worktrees.map((tree) => {
            const protectedReason = tree.main
              ? "Main checkout"
              : tree.locked
                ? "Locked by Git"
                : tree.error
                  ? "Inspection failed"
                  : tree.protected
                    ? "Referenced by a project, conversation, or terminal"
                    : tree.dirty
                      ? "Modified or untracked files"
                      : tree.ignored
                        ? "Contains ignored files"
                        : null;
            return (
              <article className="maintenance-row" key={tree.path}>
                <strong>{tree.branch ?? "Detached HEAD"}</strong>
                <code>{tree.path}</code>
                <small>
                  {tree.head.slice(0, 10)} ·{" "}
                  {protectedReason ??
                    (tree.prunable
                      ? "Missing checkout · stale Git record"
                      : "Clean · available to remove")}
                  {tree.threadCount
                    ? ` · ${tree.threadCount} conversation(s), ${tree.settledThreadCount} settled`
                    : ""}
                </small>
                {tree.error && (
                  <details className="maintenance-error-details">
                    <summary>Inspection details</summary>
                    <p>{tree.error}</p>
                  </details>
                )}
                <div className="maintenance-controls">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || Boolean(tree.error) || tree.prunable}
                    onClick={() => void perform(() => openWorktree(tree))}
                  >
                    Open workspace
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || Boolean(tree.error) || tree.prunable || !project}
                    onClick={() =>
                      void perform(async () => {
                        if (!project) return;
                        workspaceShellActions.setActiveProject(project.id);
                        workspaceShellActions.setActiveTool(project.id, "agents");
                        await handleNewThread(project.id, {
                          branch: tree.branch,
                          worktreePath: tree.path,
                          envMode: "worktree",
                          environmentId: project.environmentId,
                        });
                      })
                    }
                  >
                    Start agent here
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || Boolean(protectedReason)}
                    onClick={() =>
                      void perform(async () => {
                        if (
                          !project ||
                          !(await confirm(
                            `${tree.prunable ? "Remove stale Git record" : "Remove clean worktree"} ${tree.path}? Its branch is retained. This cannot be undone.`,
                          ))
                        )
                          return;
                        await ensureNativeApi().maintenance!.removeWorktree(project.cwd, tree.path);
                        setMessage("Removed worktree. Branch retained.");
                      })
                    }
                  >
                    {tree.prunable ? "Remove stale record…" : "Remove…"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
        <details className="maintenance-note">
          <summary>What keeps a worktree protected?</summary>
          <p>
            Deletion rechecks Git status and protects all conversation references, open projects,
            terminals, locks, ignored files and untracked work. No force-delete is offered. Close or
            remove references before cleanup.
          </p>
        </details>
      </SettingsSection>
      <SettingsSection
        title="Application storage"
        description="Review application-owned files and remove eligible rotated logs."
        contentClassName="maintenance-panel"
      >
        {storage ? (
          <>
            <p>
              <strong>{bytes(storage.totalBytes)}</strong> in logs and browser artifacts ·{" "}
              <strong>{bytes(storage.reclaimableBytes)}</strong> reclaimable in{" "}
              {storage.candidates.length} rotated logs.
            </p>
            <div className="maintenance-categories">
              {storage.categories.map((category) => (
                <div key={category.id} className="maintenance-category">
                  <span>
                    {category.id === "logs" ? "Application logs" : "Browser exports (retained)"}
                  </span>
                  <strong>{bytes(category.bytes)}</strong>
                  <small>{bytes(category.reclaimableBytes)} reclaimable</small>
                </div>
              ))}
            </div>
            <p>
              Only rotated logs older than seven days can be removed here. Current logs, browser
              exports, credentials, conversations, source files and caches are retained.
            </p>
            <div className="maintenance-controls">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || storage.candidates.length === 0}
                onClick={() =>
                  void perform(async () => {
                    if (
                      !(await confirm(
                        `Delete ${storage.candidates.length} old rotated logs (${bytes(storage.reclaimableBytes)})?`,
                      ))
                    )
                      return;
                    const result = await ensureNativeApi().maintenance!.cleanStorage(
                      storage.candidates.map((c) => c.id),
                    );
                    setMessage(
                      `Removed ${result.deletedCount} files, reclaimed ${bytes(result.deletedBytes)}.`,
                    );
                    if (result.errors.length) setError(result.errors.join("\n"));
                  })
                }
              >
                Clean eligible logs…
              </Button>
            </div>
            {storage.warnings.map((warning) => (
              <p key={warning} role="status">
                {warning}
              </p>
            ))}
            <div className="maintenance-list">
              {storage.candidates.map((file) => (
                <div className="maintenance-row" key={file.id}>
                  <strong>{file.name}</strong>
                  <p>
                    {bytes(file.bytes)} · Modified {new Date(file.modifiedAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p>Refresh to inspect application-owned storage.</p>
        )}
        <label className="maintenance-retention">
          <span>Automatic rotated log retention</span>
          <select
            className="maintenance-select"
            aria-label="Automatic log retention"
            value={cleanup.logsAfterDays ?? "off"}
            onChange={(e) =>
              void update({
                storageCleanup: {
                  logsAfterDays: e.target.value === "off" ? null : Number(e.target.value),
                },
              })
            }
          >
            <option value="off">Manual only</option>
            {[7, 14, 30, 90].map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>
        <p>
          Automatic retention uses the existing hourly cleanup service. Manual cleanup always
          preserves at least seven days.
        </p>
      </SettingsSection>
      {confirmDialog}
    </div>
  );
}
