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
import { RefreshCwIcon } from "lucide-react";
import { SettingsSectionHeader } from "./SettingsLayout";
import { WorkspaceMaintenanceView, maintenanceBytes } from "./WorkspaceMaintenanceView";

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
  const operationGeneration = useRef(0);
  const refresh = async () => {
    const revision = ++generation.current;
    const api = ensureNativeApi().maintenance;
    if (!api)
      throw new Error(
        "Workspace maintenance is unavailable. Restart the desktop app after updating.",
      );
    const results = await Promise.allSettled([
      api.inspectStorage().then((files) => {
        if (revision === generation.current) setStorage(files);
      }),
      (project ? api.inspectWorktrees(project.cwd) : Promise.resolve([])).then((trees) => {
        if (revision === generation.current) setWorktrees(trees);
      }),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
  const perform = async (operation: () => Promise<void>) => {
    const operationRevision = ++operationGeneration.current;
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await operation();
      await refresh();
    } catch (cause) {
      if (operationRevision === operationGeneration.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (operationRevision === operationGeneration.current) setBusy(false);
    }
  };
  useEffect(() => {
    void perform(async () => {});
    return () => {
      generation.current++;
      operationGeneration.current++;
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
      <WorkspaceMaintenanceView
        projects={projects}
        projectId={projectId}
        onProjectChange={(id) => {
          setProjectId(id);
          setWorktrees([]);
        }}
        hasProject={Boolean(project)}
        worktrees={worktrees}
        storage={storage}
        busy={busy}
        branch={branch}
        base={base}
        onBranchChange={setBranch}
        onBaseChange={setBase}
        onCreate={() =>
          void perform(async () => {
            if (!project) return;
            const result = await ensureNativeApi().git.createWorktree({
              cwd: project.cwd,
              branch: base.trim() || "HEAD",
              newBranch: branch.trim(),
              path: null,
            });
            setMessage(`Created ${result.worktree.branch} at ${result.worktree.path}`);
            setBranch("");
          })
        }
        onOpen={(tree) => void perform(() => openWorktree(tree))}
        onStart={(tree) =>
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
        onRemove={(tree) =>
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
        onClean={() =>
          void perform(async () => {
            if (
              !storage ||
              !(await confirm(
                `Delete ${storage.candidates.length} old rotated logs (${maintenanceBytes(storage.reclaimableBytes)})?`,
              ))
            )
              return;
            const result = await ensureNativeApi().maintenance!.cleanStorage(
              storage.candidates.map((file) => file.id),
            );
            setMessage(
              `Removed ${result.deletedCount} files, reclaimed ${maintenanceBytes(result.deletedBytes)}.`,
            );
            if (result.errors.length) setError(result.errors.join("\n"));
          })
        }
        retentionDays={cleanup.logsAfterDays}
        onRetentionChange={(days) => void update({ storageCleanup: { logsAfterDays: days } })}
      />
      {confirmDialog}
    </div>
  );
}
