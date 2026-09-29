import type { GitBranch as GitBranchType, GitHistoryCommit } from "@tabs/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Beaker,
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FileText,
  GitPullRequest,
  Loader2,
  Package,
  RefreshCw,
  Rocket,
  Search,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { invalidateGitQueries } from "../../lib/gitReactQuery";
import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import { useGitApi } from "./gitApiContext";
import { toastManager } from "../ui/toast";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Switch } from "~/components/ui/switch";
import { AutoTextarea, Banner, Field, Select, TextInput } from "./gitPrimitives";

export function ResetModal({
  commit,
  onReset,
  onClose,
}: {
  commit: GitHistoryCommit;
  onReset: (mode: "soft" | "mixed" | "hard") => void | Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"soft" | "mixed" | "hard">("mixed");
  const [submitting, setSubmitting] = useState(false);

  const handleReset = async () => {
    setSubmitting(true);
    try {
      await onReset(mode);
    } finally {
      setSubmitting(false);
    }
  };

  const MODES = [
    {
      id: "soft" as const,
      label: "Soft",
      desc: "Move HEAD only. All changes since stay staged, ready to re-commit.",
    },
    {
      id: "mixed" as const,
      label: "Mixed",
      desc: "Move HEAD and unstage. Changes since stay in your working tree.",
    },
    {
      id: "hard" as const,
      label: "Hard",
      desc: "Move HEAD and discard everything — commits and working tree changes both. Cannot be undone.",
    },
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-md">
        <DialogHeader>
          <DialogTitle>Reset to this commit</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="text-xs font-mono text-foreground/90 px-3 py-2 rounded-lg bg-muted/50 border border-border">
            {commit.shortSha} — {commit.subject}
          </div>
          <div className="flex flex-col gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className="text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer"
                style={{
                  borderColor:
                    mode === m.id
                      ? m.id === "hard"
                        ? "var(--sem-red-border)"
                        : "var(--overlay-20)"
                      : "var(--overlay-10)",
                  backgroundColor:
                    mode === m.id
                      ? m.id === "hard"
                        ? "var(--sem-red-soft)"
                        : "var(--overlay-5)"
                      : "transparent",
                }}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="text-xs font-semibold"
                    style={{
                      color: mode === m.id && m.id === "hard" ? "var(--sem-red)" : "var(--fg)",
                    }}
                  >
                    {m.label}
                  </span>
                  {mode === m.id && <Check size={12} className="text-muted-foreground/70" />}
                </div>
                <div className="text-[11px] text-muted-foreground/70 leading-relaxed">{m.desc}</div>
              </button>
            ))}
          </div>
          {mode === "hard" && (
            <Banner
              tone="bad"
              title="This can't be undone"
              body="Hard reset permanently discards commits and any uncommitted work in one step."
            />
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "hard" ? "destructive" : "default"}
            disabled={submitting}
            onClick={() => void handleReset()}
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
            {submitting ? "Resetting…" : `Reset (${mode})`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ForcePushModal({
  branch,
  onConfirm,
  onClose,
}: {
  branch: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-sm">
        <DialogHeader>
          <DialogTitle>Force push</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Banner
            tone="bad"
            title="This overwrites the remote branch"
            body={`If anyone else has pushed to ${branch} since your last pull, force-pushing discards their commits on the remote. This is common after an amend or rebase, but double-check before continuing.`}
          />
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={onConfirm}>
            Force push anyway
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function StashModal({
  onStash,
  onClose,
}: {
  onStash: (msg: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleStash = async () => {
    setSubmitting(true);
    try {
      await onStash(message.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-sm">
        <DialogHeader>
          <DialogTitle>Stash changes</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Field label="Message (optional)">
            <TextInput
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="WIP: pagination edge case"
            />
          </Field>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Sets aside everything currently staged and unstaged, and clears your working tree.
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={submitting} onClick={() => void handleStash()}>
            {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
            {submitting ? "Stashing…" : "Stash changes"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function PullSourceModal({
  branches,
  currentBranch,
  remoteName = "origin",
  onClose,
  onConfirm,
}: {
  branches: ReadonlyArray<GitBranchType>;
  currentBranch: string;
  remoteName?: string;
  onClose: () => void;
  onConfirm: (sourceBranch: string) => void | Promise<void>;
}) {
  const [source, setSource] = useState(currentBranch);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(source);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-sm">
        <DialogHeader>
          <DialogTitle>Stash, pull & reapply</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Field label="Pull from">
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {remoteName}/{b.name}
                  {b.name === currentBranch ? " (your tracked branch)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Defaults to your own branch's upstream. Pick a different branch to pull in someone
            else's work instead. Your current changes are stashed first either way, and reapplied
            after.
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting}
            onClick={() => void handleConfirm()}
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw />}
            {submitting ? "Stashing, pulling & reapplying…" : "Stash, pull & reapply"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function DiscardAllModal({
  count,
  onConfirm,
  onClose,
}: {
  count: number;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-sm">
        <DialogHeader>
          <DialogTitle>Discard all changes</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Banner
            tone="bad"
            title={`This discards ${count} file${count === 1 ? "" : "s"}`}
            body="Every uncommitted change in the working tree and staging area is permanently lost. This can't be undone."
          />
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={submitting}
            onClick={() => void handleConfirm()}
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
            {submitting ? "Discarding…" : "Discard everything"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function SearchableBranchSelect({
  branches,
  value,
  onChange,
  placeholder = "Select branch…",
}: {
  branches: ReadonlyArray<{ name: string }>;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return branches;
    const q = search.toLowerCase().trim();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, search]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs bg-background border border-border/80 rounded-lg text-foreground outline-none focus:ring-1 focus:ring-primary transition-all text-left"
      >
        <span className="font-mono text-xs truncate">{value || placeholder}</span>
        <ChevronDown
          size={13}
          className={`text-muted-foreground shrink-0 ml-1.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 w-full mt-1.5 bg-popover border border-border rounded-xl shadow-2xl z-[350] overflow-hidden">
          {/* Internal Search Input */}
          <div className="p-2 border-b border-border bg-muted/20">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0 z-10"
              />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search branches…"
                className="w-full bg-background border border-border/60 rounded-md pl-8 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-border"
              />
            </div>
          </div>

          {/* Branch List Options */}
          <div className="py-1 max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                No branches found
              </div>
            ) : (
              filtered.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => {
                    onChange(b.name);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-mono transition-colors text-left ${
                    b.name === value
                      ? "bg-accent text-accent-foreground font-semibold"
                      : "text-foreground/90 hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <span className="truncate">{b.name}</span>
                  {b.name === value && <Check size={13} className="text-primary shrink-0 ml-2" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CreatePRModal({
  currentBranch,
  branches,
  lastSubject,
  onCreate,
  onClose,
}: {
  currentBranch: string;
  branches: ReadonlyArray<GitBranchType>;
  lastSubject: string;
  onCreate: (pr: {
    title: string;
    head: string;
    base: string;
    body: string;
    draft: boolean;
  }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [head, setHead] = useState(currentBranch);
  const [base, setBase] = useState(
    () =>
      branches.find((b) => b.name !== currentBranch && (b.name === "main" || b.name === "master"))
        ?.name ||
      branches.find((b) => b.name !== currentBranch)?.name ||
      "main",
  );
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      await onCreate({ title: title.trim(), head, base, body: body.trim(), draft });
    } finally {
      setSubmitting(false);
    }
  };

  const autoFillTitleAndDescription = () => {
    if (lastSubject) {
      setTitle(lastSubject);
    }
    const defaultTemplate = `## Summary\n\n${lastSubject || "Describe the changes introduced in this pull request."}\n\n## Changes Included\n\n- Describe the implementation changes on ${head}.\n\n## Verification\n\n- Add the checks or manual verification actually performed.`;
    setBody(defaultTemplate);
  };

  const clearAllFields = () => {
    setTitle("");
    setBody("");
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-4xl w-[88vw] h-[640px] max-h-[75vh] p-0 overflow-hidden border-border/80 shadow-2xl">
        <div className="flex h-full w-full">
          {/* Left Configuration Sidebar */}
          <div className="w-80 shrink-0 border-r border-border/60 bg-muted/20 p-6 flex flex-col justify-between">
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-foreground tracking-tight">
                  Create pull request
                </h3>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Configure branches and visibility.
                </p>
              </div>

              {/* Branch Direction Arrow Pill */}
              <div className="flex items-center justify-between p-2.5 rounded-xl border border-border/70 bg-card/50 text-xs font-mono">
                <span className="px-2 py-1 rounded bg-muted/50 border border-border text-foreground/90 font-medium truncate max-w-[100px]">
                  {base}
                </span>
                <span className="text-muted-foreground/70 text-sm font-sans">&larr;</span>
                <span className="px-2 py-1 rounded bg-muted/50 border border-border text-foreground font-medium truncate max-w-[100px]">
                  {head}
                </span>
              </div>

              {/* Head Branch Selector with Search */}
              <Field label="Head Branch (from)">
                <SearchableBranchSelect
                  branches={branches}
                  value={head}
                  onChange={(val) => setHead(val)}
                  placeholder="Select head branch…"
                />
              </Field>

              {/* Base Branch Selector with Search */}
              <Field label="Base Branch (into)">
                <SearchableBranchSelect
                  branches={branches.filter((b) => b.name !== head)}
                  value={base}
                  onChange={(val) => setBase(val)}
                  placeholder="Select base branch…"
                />
              </Field>

              {/* PR Mode Segmented Control */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70 block">
                  PR Visibility
                </label>
                <div
                  className="tabs-segmented grid grid-cols-2 text-xs"
                  role="group"
                  aria-label="Pull request visibility"
                >
                  <button
                    type="button"
                    onClick={() => setDraft(false)}
                    aria-pressed={!draft}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium transition-all ${
                      !draft ? "font-semibold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <GitPullRequest
                      size={13}
                      className={!draft ? "text-foreground" : "text-muted-foreground"}
                    />
                    <span>Ready</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(true)}
                    aria-pressed={draft}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium transition-all ${
                      draft ? "font-semibold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <FileText
                      size={13}
                      className={draft ? "text-foreground" : "text-muted-foreground"}
                    />
                    <span>Draft</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Action Buttons */}
            <div className="flex items-center gap-2 pt-4 border-t border-border/50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={submitting}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="flex-1 gap-1.5"
                disabled={!title.trim() || submitting}
                onClick={() => void handleCreate()}
              >
                {submitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <GitPullRequest size={13} />
                )}
                <span>
                  {submitting
                    ? draft
                      ? "Drafting…"
                      : "Creating…"
                    : draft
                      ? "Create draft"
                      : "Create PR"}
                </span>
              </Button>
            </div>
          </div>

          {/* Right Main Editor Panel */}
          <div className="flex-1 flex flex-col p-6 bg-background relative">
            {/* Top Auto-fill & Clear Actions */}
            <div className="flex justify-end items-center gap-2 mb-4 pr-10">
              {(title.trim() || body.trim()) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFields}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 size={13} />
                  <span>Clear</span>
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={autoFillTitleAndDescription}
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Wand2 size={13} />
                <span>Auto-fill title & description</span>
              </Button>
            </div>

            {/* PR Title Input */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Pull request title…"
              className="w-full bg-transparent border-none text-2xl font-semibold text-foreground placeholder:text-muted-foreground/40 outline-none mb-3 pr-10 truncate"
            />

            <div className="w-10 h-0.5 bg-border rounded-full mb-4 opacity-80" />

            {/* PR Description Textarea */}
            <AutoTextarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add detailed description, context, motivation, or review notes (optional)…"
              minRows={10}
              className="w-full flex-1 bg-transparent border-none text-xs font-mono leading-relaxed text-foreground placeholder:text-muted-foreground/40 outline-none resize-none p-0 focus:border-none focus:ring-0"
            />
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

export function AddRemoteModal({
  onAdd,
  onClose,
}: {
  onAdd: (r: { name: string; url: string }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("origin");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async () => {
    setSubmitting(true);
    try {
      await onAdd({ name: name.trim() || "origin", url: url.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-md">
        <DialogHeader>
          <DialogTitle>Add remote</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Field label="Remote name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Remote URL">
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="git@github.com:org/repo.git"
            />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!url.trim() || submitting}
            onClick={() => void handleAdd()}
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
            {submitting ? "Adding remote…" : "Add remote"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function DeviceAuthModal({
  cwd,
  title = "Sign in to GitHub",
  subtitle = "Interactive GitHub authentication will open in the integrated terminal drawer.",
  onRunGitHubLogin,
  onConfirm,
  onClose,
}: {
  cwd: string;
  title?: string;
  subtitle?: string;
  onRunGitHubLogin: () => void | Promise<void>;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [authStatusText, setAuthStatusText] = useState<string | null>(null);
  const api = useGitApi();
  const queryClient = useQueryClient();

  const handleStartAuth = () => {
    void onRunGitHubLogin();
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setAuthStatusText("Checking GitHub auth status…");
    try {
      if (api) {
        const env = await api.git.environment({ cwd });
        await invalidateGitQueries(queryClient);
        if (env.gitHub.authenticated) {
          toastManager.add({ type: "success", title: "GitHub authenticated successfully" });
          onConfirm();
          return;
        }
      }
    } catch (error) {
      setAuthStatusText(toGitUserFacingErrorMessage(error));
      setConfirming(false);
      return;
    }
    setAuthStatusText("GitHub is not authenticated yet. Finish authorization, then try again.");
    setConfirming(false);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <p className="text-xs text-muted-foreground/80 leading-relaxed">{subtitle}</p>
          <div
            className="border border-border rounded-lg p-3 flex flex-col gap-2"
            style={{ backgroundColor: "var(--bg-base)" }}
          >
            <p className="text-[11px] text-muted-foreground">
              Click below to launch interactive sign in in your terminal:
            </p>
            <Button type="button" size="sm" onClick={handleStartAuth}>
              <ExternalLink /> Start `gh auth login` in terminal
            </Button>
          </div>
          {authStatusText && (
            <p className="text-[11px] text-center font-mono text-muted-foreground/70">
              {authStatusText}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={confirming}
            onClick={() => void handleConfirm()}
          >
            {confirming ? <Loader2 className="animate-spin" /> : null}
            {confirming ? "Verifying…" : "I've authorized it"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function NewWorktreeModal({
  branches,
  currentBranch,
  onCreate,
  onClose,
}: {
  branches: ReadonlyArray<GitBranchType>;
  currentBranch: string;
  onCreate: (input: { base: string; branch: string; path: string }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [base, setBase] = useState(currentBranch);
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("../worktree-folder");
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      await onCreate({ base, branch: branch.trim() || base, path: path.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-md">
        <DialogHeader>
          <DialogTitle>New worktree</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Field label="Based on">
            <Select value={base} onChange={(e) => setBase(e.target.value)}>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="New branch name (optional)">
            <TextInput
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="Leave blank to check out existing branch"
            />
          </Field>
          <Field label="Path">
            <TextInput value={path} onChange={(e) => setPath(e.target.value)} />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!path.trim() || submitting}
            onClick={() => void handleCreate()}
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
            {submitting ? "Creating worktree…" : "Create worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function SearchableTagSelect({
  tags,
  value,
  onChange,
}: {
  tags: ReadonlyArray<{ name: string }>;
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.toLowerCase().trim();
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, search]);

  const displayLabel = value === "__new__" ? "+ Create new tag…" : value || "Select a tag…";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs bg-background border border-border/80 rounded-lg text-foreground outline-none focus:ring-1 focus:ring-primary transition-all"
      >
        <span className="font-mono text-xs truncate">{displayLabel}</span>
        <ChevronDown
          size={13}
          className={`text-muted-foreground shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 w-full mt-1.5 bg-popover border border-border rounded-xl shadow-2xl z-[350] overflow-hidden">
          {/* Internal Search Input */}
          <div className="p-2 border-b border-border bg-muted/20">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0 z-10"
              />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tags…"
                className="w-full bg-background border border-border/60 rounded-md pl-8 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-border"
              />
            </div>
          </div>

          {/* List Options */}
          <div className="py-1 max-h-52 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange("__new__");
                setOpen(false);
                setSearch("");
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground/90 font-mono hover:bg-accent hover:text-accent-foreground font-semibold border-b border-border/40 transition-colors text-left"
            >
              + Create new tag…
            </button>

            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                No tags found
              </div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => {
                    onChange(t.name);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-foreground/80 hover:bg-accent hover:text-accent-foreground font-mono transition-colors text-left"
                >
                  <span className="truncate">{t.name}</span>
                  {value === t.name && (
                    <Check size={13} className="text-foreground shrink-0 ml-1" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DraftReleaseModal({
  tags,
  commits,
  onPublish,
  onClose,
}: {
  tags: ReadonlyArray<{ name: string }>;
  commits: ReadonlyArray<GitHistoryCommit>;
  onPublish: (rel: {
    tag: string;
    title: string;
    notes: string;
    prerelease: boolean;
  }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [tag, setTag] = useState(tags[0]?.name || "__new__");
  const [customTag, setCustomTag] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [prerelease, setPrerelease] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const effectiveTag = tag === "__new__" ? customTag.trim() : tag;

  const handlePublish = async () => {
    if (!effectiveTag) return;
    setSubmitting(true);
    try {
      await onPublish({
        tag: effectiveTag,
        title: title.trim() || effectiveTag,
        notes: notes.trim(),
        prerelease,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const generateNotes = () => {
    const bullets = commits
      .slice(0, 8)
      .map((c) => `* ${c.subject} (${c.shortSha})`)
      .join("\n");
    const formatted = `## What's Changed\n\n${bullets}\n\n**Full Commit History**: \`${commits[0]?.shortSha ?? "head"}\``;
    setNotes(formatted);
    if (!title.trim()) setTitle(effectiveTag ? `Release ${effectiveTag}` : "New Release");
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="git-tool-v2 max-w-4xl w-[88vw] h-[640px] max-h-[75vh] p-0 overflow-hidden border-border/80 shadow-2xl">
        <div className="flex h-full w-full">
          {/* Left Configuration Sidebar */}
          <div className="w-80 shrink-0 border-r border-border/60 bg-muted/20 p-6 flex flex-col justify-between">
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-foreground tracking-tight">
                  Draft a release
                </h3>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Configure target and visibility.
                </p>
              </div>

              {/* Target Tag Field with Internal Search */}
              <Field label="Target Tag">
                <SearchableTagSelect tags={tags} value={tag} onChange={(val) => setTag(val)} />
              </Field>

              {tag === "__new__" && (
                <Field label="New Tag Identifier">
                  <TextInput
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    placeholder="e.g. v1.5.0"
                    className="font-mono text-xs"
                  />
                </Field>
              )}

              {/* Release Type Segmented Control */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70 block">
                  Release Type
                </label>
                <div
                  className="tabs-segmented grid grid-cols-2 text-xs"
                  role="group"
                  aria-label="Release type"
                >
                  <button
                    type="button"
                    onClick={() => setPrerelease(false)}
                    aria-pressed={!prerelease}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium transition-all ${
                      !prerelease ? "font-semibold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Package
                      size={13}
                      className={!prerelease ? "text-foreground" : "text-muted-foreground"}
                    />
                    <span>Production</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrerelease(true)}
                    aria-pressed={prerelease}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium transition-all ${
                      prerelease ? "font-semibold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Beaker
                      size={13}
                      className={prerelease ? "text-foreground" : "text-muted-foreground"}
                    />
                    <span>Pre-release</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center gap-2 pt-4 border-t border-border/50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={submitting}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="flex-1 gap-1.5"
                disabled={!effectiveTag || submitting}
                onClick={() => void handlePublish()}
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
                <span>{submitting ? "Publishing release…" : "Publish release"}</span>
              </Button>
            </div>
          </div>

          {/* Right Main Editor Panel */}
          <div className="flex-1 flex flex-col p-6 bg-background relative">
            {/* Top Auto-generate Action */}
            <div className="flex justify-end mb-4 pr-10">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={generateNotes}
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Wand2 size={13} />
                <span>Auto-generate notes</span>
              </Button>
            </div>

            {/* Release Title Input */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Release Title…"
              className="w-full bg-transparent border-none text-2xl font-semibold text-foreground placeholder:text-muted-foreground/40 outline-none mb-3"
            />

            <div className="w-10 h-0.5 bg-border rounded-full mb-4 opacity-80" />

            {/* Release Notes Textarea */}
            <AutoTextarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the changes, features, and fixes in this release…"
              minRows={10}
              className="w-full flex-1 bg-transparent border-none text-xs font-mono leading-relaxed text-foreground placeholder:text-muted-foreground/40 outline-none resize-none p-0 focus:border-none focus:ring-0"
            />
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
