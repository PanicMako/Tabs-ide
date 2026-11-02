import { useState } from "react";
import type { ManagedWorktree, StorageInventory } from "@tabs/contracts";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  GitBranchIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsSection, SettingsRow } from "./SettingsLayout";
import "./workspace-maintenance.css";

export const maintenanceBytes = (value: number) =>
  value === 0
    ? "0 B"
    : value < 1024
      ? `${value} B`
      : value < 1024 ** 2
        ? `${(value / 1024).toFixed(1)} KB`
        : value < 1024 ** 3
          ? `${(value / 1024 ** 2).toFixed(1)} MB`
          : `${(value / 1024 ** 3).toFixed(2)} GB`;

export function worktreeProtection(tree: ManagedWorktree): string | null {
  return tree.main
    ? "Main checkout"
    : tree.locked
      ? "Locked by Git"
      : tree.error
        ? "Inspection failed"
        : tree.protected
          ? "In use by a project or conversation"
          : tree.dirty
            ? "Modified or untracked files"
            : tree.ignored
              ? "Contains ignored files"
              : null;
}

interface Props {
  projects: readonly { id: string; name: string }[];
  projectId: string;
  onProjectChange: (id: string) => void;
  hasProject: boolean;
  worktrees: readonly ManagedWorktree[];
  storage: StorageInventory | null;
  busy: boolean;
  branch: string;
  base: string;
  onBranchChange: (value: string) => void;
  onBaseChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (tree: ManagedWorktree) => void;
  onStart: (tree: ManagedWorktree) => void;
  onRemove: (tree: ManagedWorktree) => void;
  onClean: () => void;
  retentionDays: number | null;
  onRetentionChange: (days: number | null) => void;
}

export function WorkspaceMaintenanceView(props: Props) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const needle = query.trim().toLowerCase();
  const visible = props.worktrees.filter((tree) =>
    `${tree.branch ?? "Detached HEAD"} ${tree.path}`.toLowerCase().includes(needle),
  );
  const storage = props.storage;
  const removable = props.worktrees.filter((tree) => !worktreeProtection(tree)).length;
  return (
    <div className="wm-content">
      <SettingsSection
        title="Git worktrees"
        description="Separate checkouts for parallel work."
        headerAction={
          props.worktrees.length > 0 ? (
            <span className="wm-meta">
              {props.worktrees.length} checkouts · {removable} removable
            </span>
          ) : undefined
        }
      >
        <div className="wm-toolbar">
          <label className="wm-repository">
            <span>Repository</span>
            <Select
              value={props.projectId}
              onValueChange={(value) => {
                props.onProjectChange(value ?? "");
                setQuery("");
              }}
            >
              <SelectTrigger aria-label="Repository" size="sm" className="w-44 max-w-full">
                <SelectValue>
                  {props.projects.find((project) => project.id === props.projectId)?.name ??
                    "Choose a project"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">Choose a project</SelectItem>
                {props.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={!props.hasProject}
            aria-expanded={creating}
            aria-controls="wm-create-form"
            onClick={() => setCreating((value) => !value)}
          >
            <PlusIcon className="size-3.5" />
            New worktree
          </Button>
        </div>
        {creating && props.hasProject && (
          <form
            id="wm-create-form"
            className="wm-create"
            onSubmit={(event) => {
              event.preventDefault();
              props.onCreate();
            }}
          >
            <div className="wm-create-heading">
              <strong>Create an isolated checkout</strong>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Close worktree form"
                onClick={() => setCreating(false)}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
            <div className="wm-form-fields">
              <label>
                <span>New branch</span>
                <Input
                  required
                  aria-label="New worktree branch"
                  placeholder="feature/my-task"
                  value={props.branch}
                  onChange={(event) => props.onBranchChange(event.target.value)}
                />
              </label>
              <label>
                <span>From branch or commit</span>
                <Input
                  aria-label="Base branch or commit"
                  value={props.base}
                  onChange={(event) => props.onBaseChange(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                size="sm"
                variant="default"
                disabled={props.busy || !props.branch.trim()}
              >
                Create worktree
              </Button>
            </div>
          </form>
        )}
        {props.hasProject && props.worktrees.length > 0 && (
          <div className="wm-list-toolbar">
            <div className="wm-search">
              <SearchIcon className="size-3.5" aria-hidden="true" />
              <Input
                unstyled
                aria-label="Filter worktrees"
                placeholder="Find a branch or path…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <span className="wm-meta">
              {visible.length} {visible.length === 1 ? "checkout" : "checkouts"}
            </span>
          </div>
        )}
        <div className="wm-tree-list" aria-label="Repository worktrees" aria-busy={props.busy}>
          {props.hasProject && props.busy && props.worktrees.length === 0 ? (
            <p className="wm-empty" role="status">
              Inspecting this repository’s worktrees…
            </p>
          ) : !props.hasProject ? (
            <p className="wm-empty">Choose a local repository to see its worktrees.</p>
          ) : visible.length === 0 ? (
            <p className="wm-empty">
              {needle
                ? "No branches or paths match your search."
                : "No worktrees found for this repository."}
            </p>
          ) : (
            visible.map((tree) => {
              const protection = worktreeProtection(tree);
              const status = tree.error
                ? "Needs review"
                : (protection ?? (tree.prunable ? "Stale record" : "Clean"));
              return (
                <article key={tree.path} className="wm-tree">
                  <div className="wm-tree-main">
                    <GitBranchIcon className="wm-branch-icon" aria-hidden="true" />
                    <div className="wm-tree-identity">
                      <strong title={tree.branch ?? "Detached HEAD"}>
                        {tree.branch ?? "Detached HEAD"}
                      </strong>
                      <span className="wm-tree-path" title={tree.path}>
                        {tree.path}
                      </span>
                    </div>
                    <span className="wm-status" data-review={Boolean(tree.error) || undefined}>
                      {status}
                    </span>
                  </div>
                  <div className="wm-tree-bottom">
                    <details className="wm-tree-details">
                      <summary>
                        <ChevronDownIcon className="size-3" aria-hidden="true" />
                        Details
                        {tree.threadCount > 0 ? ` · ${tree.threadCount} conversations` : ""}
                      </summary>
                      <div>
                        <dl>
                          <dt>Path</dt>
                          <dd>{tree.path}</dd>
                          <dt>Revision</dt>
                          <dd>{tree.head.slice(0, 10)}</dd>
                          <dt>Removal</dt>
                          <dd>{protection ?? "Available to remove; branch retained"}</dd>
                          {tree.threadCount > 0 && (
                            <>
                              <dt>Conversations</dt>
                              <dd>
                                {tree.threadCount} total · {tree.settledThreadCount} settled
                              </dd>
                            </>
                          )}
                        </dl>
                        {tree.error && <p className="wm-inspection-error">{tree.error}</p>}
                      </div>
                    </details>
                    <div className="wm-tree-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={props.busy || Boolean(tree.error) || tree.prunable}
                        onClick={() => props.onOpen(tree)}
                      >
                        Open
                        <ArrowUpRightIcon className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          props.busy || Boolean(tree.error) || tree.prunable || !props.hasProject
                        }
                        onClick={() => props.onStart(tree)}
                      >
                        Start agent
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title={
                          protection ?? (tree.prunable ? "Remove stale record" : "Remove worktree")
                        }
                        aria-label={`${tree.prunable ? "Remove stale record" : "Remove worktree"} ${tree.branch ?? tree.path}`}
                        disabled={props.busy || Boolean(protection)}
                        onClick={() => props.onRemove(tree)}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
        <div className="wm-footnote">
          Only clean, unused worktrees can be removed. Branches are kept.
        </div>
      </SettingsSection>
      <SettingsSection
        title="Application storage"
        description="Application files on this computer."
      >
        <dl className="wm-storage-summary">
          <div>
            <dt>Total size</dt>
            <dd>{storage ? maintenanceBytes(storage.totalBytes) : "—"}</dd>
          </div>
          <div>
            <dt>Safe to reclaim</dt>
            <dd>{storage ? maintenanceBytes(storage.reclaimableBytes) : "—"}</dd>
          </div>
          <div>
            <dt>Eligible logs</dt>
            <dd>{storage ? storage.candidates.length.toLocaleString() : "—"}</dd>
          </div>
        </dl>
        {storage ? (
          <div className="wm-categories">
            {storage.categories.map((category) => (
              <div className="wm-category" key={category.id}>
                <div>
                  <strong>{category.id === "logs" ? "Application logs" : "Browser exports"}</strong>
                  <span>
                    {category.id === "logs"
                      ? `${maintenanceBytes(category.reclaimableBytes)} eligible for cleanup`
                      : "Retained with your conversations"}
                  </span>
                </div>
                <span className="wm-category-size">{maintenanceBytes(category.bytes)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="wm-empty" role="status">
            {props.busy
              ? "Measuring application storage…"
              : "Refresh inventory to inspect application storage."}
          </p>
        )}
        <div className="wm-cleanup">
          <div>
            <strong>Clear old rotated logs</strong>
            <p>Only rotated logs older than seven days. Current logs and browser exports stay.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={props.busy || !storage?.candidates.length}
            onClick={props.onClean}
          >
            Clean eligible logs…
          </Button>
        </div>
        {storage && storage.candidates.length > 0 && (
          <details className="wm-log-details">
            <summary>Review {storage.candidates.length} eligible logs</summary>
            <div>
              {storage.candidates.map((file) => (
                <div key={file.id}>
                  <span title={file.name}>{file.name}</span>
                  <span>{new Date(file.modifiedAt).toLocaleDateString()}</span>
                  <strong>{maintenanceBytes(file.bytes)}</strong>
                </div>
              ))}
            </div>
          </details>
        )}
        {storage?.warnings.map((warning) => (
          <p className="wm-warning" role="status" key={warning}>
            {warning}
          </p>
        ))}
        <SettingsRow
          title="Automatic log retention"
          description="Choose when old rotated logs are cleared."
          control={
            <Select
              value={String(props.retentionDays ?? "off")}
              onValueChange={(value) => {
                if (value !== null) props.onRetentionChange(value === "off" ? null : Number(value));
              }}
            >
              <SelectTrigger
                aria-label="Automatic log retention"
                size="sm"
                className="w-full sm:w-36"
              >
                <SelectValue>
                  {props.retentionDays === null ? "Manual only" : `${props.retentionDays} days`}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="off">Manual only</SelectItem>
                {[7, 14, 30, 90].map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} days
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </div>
  );
}
