import type { GitEnvironmentResult } from "@tabs/contracts";
import { Cpu, FolderGit2, GitBranch, Loader2, Wand2, Pin, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useGitApi, useGitScopeKey } from "./gitApiContext";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { SegmentedControl } from "../ui/segmented-control";
import {
  loadPinnedBranches,
  savePinnedBranches,
  togglePinnedBranch,
  unpinAllBranches,
  MAX_PINNED_BRANCHES,
} from "./pinnedBranches";
import { Switch } from "../ui/switch";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { resolveAppModelSelectionState } from "../../modelSelection";
import { useServerConfig } from "../../state/settings";
import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import {
  AutoTextarea,
  Card,
  Field,
  GitModelPicker,
  SectionLabel,
  TextInput,
} from "./gitPrimitives";

export function updateGitConfigUser(configText: string, newName: string, newEmail: string): string {
  const lines = configText.split(/\r?\n/);
  const resultLines: string[] = [];
  let inUserSection = false;
  let foundUserSection = false;
  let hasName = false;
  let hasEmail = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const sectionName = trimmed.slice(1, -1).trim();
      if (inUserSection) {
        if (!hasName) resultLines.push(`\tname = ${newName}`);
        if (!hasEmail) resultLines.push(`\temail = ${newEmail}`);
      }
      inUserSection = sectionName.toLowerCase() === "user";
      if (inUserSection) {
        foundUserSection = true;
        hasName = false;
        hasEmail = false;
      }
      resultLines.push(line);
      continue;
    }

    if (inUserSection) {
      if (/^name\s*=/i.test(trimmed)) {
        resultLines.push(`\tname = ${newName}`);
        hasName = true;
        continue;
      }
      if (/^email\s*=/i.test(trimmed)) {
        resultLines.push(`\temail = ${newEmail}`);
        hasEmail = true;
        continue;
      }
    }

    resultLines.push(line);
  }

  if (inUserSection) {
    if (!hasName) resultLines.push(`\tname = ${newName}`);
    if (!hasEmail) resultLines.push(`\temail = ${newEmail}`);
  }

  if (!foundUserSection) {
    const lastLine = resultLines[resultLines.length - 1];
    if (resultLines.length > 0 && lastLine !== undefined && lastLine.trim() !== "") {
      resultLines.push("");
    }
    resultLines.push("[user]");
    resultLines.push(`\tname = ${newName}`);
    resultLines.push(`\temail = ${newEmail}`);
  }

  return resultLines.join("\n");
}

export function verifyGitConfigUser(
  configText: string,
  expectedName: string,
  expectedEmail: string,
): boolean {
  const lines = configText.split(/\r?\n/);
  let inUserSection = false;
  let nameFound = false;
  let emailFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const sectionName = trimmed.slice(1, -1).trim();
      inUserSection = sectionName.toLowerCase() === "user";
      continue;
    }
    if (inUserSection) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key === "name" && val === expectedName) nameFound = true;
        if (key === "email" && val === expectedEmail) emailFound = true;
      }
    }
  }

  return nameFound && emailFound;
}

export function SettingsPanel({
  cwd,
  environmentData,
  excludedBranches = [],
  onAddExcludedBranch,
  onRemoveExcludedBranch,
  onOpenAddRemote,
}: {
  cwd: string;
  environmentData: GitEnvironmentResult | null;
  excludedBranches?: string[];
  onAddExcludedBranch?: (name: string) => void;
  onRemoveExcludedBranch?: (name: string) => void;
  onOpenAddRemote: () => void;
}) {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [gitignore, setGitignore] = useState("");
  const [gitignoreChanged, setGitignoreChanged] = useState(false);
  const [newExclude, setNewExclude] = useState("");
  const [remotes, setRemotes] = useState<Array<{ name: string; url: string }>>([]);
  const [isSavingIdentity, setIsSavingIdentity] = useState(false);
  const [isSavingGitignore, setIsSavingGitignore] = useState(false);
  const [category, setCategory] = useState<"repository" | "workflow" | "ai">("repository");
  const settingsId = useId();
  const serverConfig = useServerConfig();
  const [customInstructions, setCustomInstructions] = useState("");
  const api = useGitApi();

  const gitScopeKey = useGitScopeKey();

  const [defaultDivergenceView, setDefaultDivergenceView] = useState<"spotlight" | "active">(() => {
    try {
      const saved =
        localStorage.getItem(`tabs_default_divergence_view_${gitScopeKey}`) ||
        localStorage.getItem("tabs_default_divergence_view");
      if (saved === "spotlight" || saved === "active") return saved;
    } catch {}
    return "spotlight";
  });
  const [pinnedBranches, setPinnedBranches] = useState<string[]>(() =>
    loadPinnedBranches(gitScopeKey),
  );
  const [newPinInput, setNewPinInput] = useState("");

  useEffect(() => {
    setPinnedBranches(loadPinnedBranches(gitScopeKey));
  }, [gitScopeKey]);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ gitScopeKey: string; branches: string[] }>;
      if (custom.detail?.gitScopeKey === gitScopeKey && Array.isArray(custom.detail.branches)) {
        setPinnedBranches(custom.detail.branches);
      }
    };
    window.addEventListener("tabs:pinned-branches-changed", handler);
    return () => window.removeEventListener("tabs:pinned-branches-changed", handler);
  }, [gitScopeKey]);

  const handleSetDefaultDivergenceView = (view: "spotlight" | "active") => {
    setDefaultDivergenceView(view);
    try {
      localStorage.setItem(`tabs_default_divergence_view_${gitScopeKey}`, view);
      localStorage.setItem("tabs_default_divergence_view", view);
      toastManager.add({
        type: "success",
        title: `Default divergence view set to ${view === "spotlight" ? "Spotlight" : "Active"}`,
      });
    } catch {}
  };

  const handleAddPinnedBranch = (branchName?: string) => {
    const name = (branchName ?? newPinInput).trim();
    if (!name) return;
    const res = togglePinnedBranch(gitScopeKey, pinnedBranches, name);
    if (res.action === "limit_reached") {
      toastManager.add({
        type: "warning",
        title: `Maximum ${MAX_PINNED_BRANCHES} branches can be pinned`,
        description: `Remove a pinned branch first to add '${name}'.`,
      });
      return;
    }
    setPinnedBranches(res.branches);
    setNewPinInput("");
    toastManager.add({
      type: "success",
      title: `Pinned '${name}' for divergence (${res.branches.length}/${MAX_PINNED_BRANCHES})`,
    });
  };

  const handleRemovePinnedBranch = (branchName: string) => {
    const next = pinnedBranches.filter((b) => b.toLowerCase() !== branchName.toLowerCase());
    savePinnedBranches(gitScopeKey, next);
    setPinnedBranches(next);
    toastManager.add({ type: "info", title: `Unpinned '${branchName}'` });
  };

  const handleUnpinAll = () => {
    const next = unpinAllBranches(gitScopeKey);
    setPinnedBranches(next);
    toastManager.add({ type: "info", title: "Unpinned all comparison branches" });
  };

  const removeRemote = async (remoteName: string) => {
    if (!api) return;
    try {
      await api.git.performRepositoryAction({
        cwd,
        operation: { action: "remove_remote", name: remoteName },
      });
      setRemotes((current) => current.filter((remote) => remote.name !== remoteName));
      toastManager.add({ type: "success", title: `Removed remote ${remoteName}` });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not remove remote",
        description: toGitUserFacingErrorMessage(error),
      });
    }
  };

  useEffect(() => {
    setCustomInstructions(settings?.gitAi?.customPromptInstructions ?? "");
  }, [settings?.gitAi?.customPromptInstructions]);
  const [isAnalyzingRepo, setIsAnalyzingRepo] = useState(false);

  const handleAnalyzeRepoAndGenerateRules = async () => {
    if (!api || !cwd) {
      toastManager.add({ type: "error", title: "Workspace API unavailable" });
      return;
    }

    setIsAnalyzingRepo(true);
    try {
      let pkgDetails = "";
      const pkgRes = await api.projects
        .readFile({ cwd, relativePath: "package.json" })
        .catch(() => null);
      if (pkgRes?.contents) {
        try {
          const parsed = JSON.parse(pkgRes.contents);
          const deps = Object.keys({ ...parsed.dependencies, ...parsed.devDependencies }).slice(
            0,
            30,
          );
          pkgDetails = `Project Name: ${parsed.name || "workspace"}, Key Stack Dependencies: ${deps.join(", ")}`;
        } catch {
          // Ignore JSON parse error
        }
      }

      const activeModelSelection =
        settings?.gitAi?.gitTextGenerationModelSelection ??
        resolveAppModelSelectionState(settings, serverConfig?.providers ?? []);

      const userPrompt = [
        `Deep Codebase Analysis Request for Workspace: ${cwd}`,
        pkgDetails ? `Repository Context: ${pkgDetails}` : "",
        "Task: Analyze the architecture, frameworks, and coding patterns of this codebase.",
        "Generate 4-6 concise, highly specific AI Code Review Rules tailored to this repository.",
        "Focus on breaking API changes, data contract schemas, type safety, error boundaries, security vulnerabilities, and testing guidelines.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const usedModelName = activeModelSelection.model;
      const res = await api.git.generateDiffSummary({
        cwd,
        target: { kind: "working_tree" },
        modelSelection: activeModelSelection,
        userHint: userPrompt,
      });

      if (res?.summary && res.summary !== "No changes detected.") {
        const generatedRules = [
          `# Codebase Review Rules (${cwd.split("/").pop()})`,
          "",
          res.summary ? `## Architecture Focus\n${res.summary}\n` : "",
          res.keyChanges && res.keyChanges !== "- No modifications found in diff."
            ? `## Code Review Standards\n${res.keyChanges}\n`
            : "",
          res.notesAndRisk ? `## Critical Risk Checklist\n${res.notesAndRisk}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        setCustomInstructions(generatedRules);
        updateSettings.updateSettings({
          gitAi: { customPromptInstructions: generatedRules },
        });
        toastManager.add({
          type: "success",
          title: `Generated review rules using ${usedModelName}!`,
        });
      } else {
        throw new Error("AI model returned empty response.");
      }
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Could not generate rules with AI",
        description: toGitUserFacingErrorMessage(err),
      });
    } finally {
      setIsAnalyzingRepo(false);
    }
  };
  const handleSaveCustomInstructions = () => {
    updateSettings.updateSettings({
      gitAi: {
        customPromptInstructions: customInstructions.trim(),
      },
    });
    toastManager.add({ type: "success", title: "Saved Git AI custom instructions" });
  };

  const handleUseSuggestedRules = () => {
    const suggested = [
      "Focus on high-precision code review instructions:",
      "- Identify breaking API changes and data contract modifications",
      "- Flag security vulnerabilities (exposed secrets, unvalidated inputs, SQLi/XSS)",
      "- Highlight performance bottlenecks and unhandled async exceptions",
      "- Ensure error handling and fallback paths are explicitly implemented",
    ].join("\n");
    setCustomInstructions(suggested);
    updateSettings.updateSettings({
      gitAi: { customPromptInstructions: suggested },
    });
    toastManager.add({ type: "success", title: "Applied suggested review rules" });
  };

  useEffect(() => {
    const nativeApi = api;
    if (!nativeApi || !cwd) {
      return;
    }
    let cancelled = false;

    async function loadSettings() {
      if (!nativeApi) return;
      // 1. Load .gitignore
      try {
        const res = await nativeApi.projects.readFile({ cwd, relativePath: ".gitignore" });
        if (res?.contents && !cancelled) {
          setGitignore(res.contents);
          setGitignoreChanged(false);
        }
      } catch {
        // Ignore if no .gitignore file
      }

      // 2. Load .git/config for identity & remotes
      try {
        const configRes = await nativeApi.projects.readFile({ cwd, relativePath: ".git/config" });
        if (configRes?.contents && !cancelled) {
          const text = configRes.contents;

          const nameMatch = text.match(/name\s*=\s*(.+)/i);
          const emailMatch = text.match(/email\s*=\s*(.+)/i);
          if (nameMatch && nameMatch[1]) setName(nameMatch[1].trim());
          if (emailMatch && emailMatch[1]) setEmail(emailMatch[1].trim());

          const parsedRemotes: Array<{ name: string; url: string }> = [];
          const lines = text.split("\n");
          let currentRemote: string | null = null;
          for (const line of lines) {
            const remoteMatch = line.match(/\[remote\s+"([^"]+)"\]/);
            if (remoteMatch && remoteMatch[1]) {
              currentRemote = remoteMatch[1];
            } else if (currentRemote) {
              const urlMatch = line.match(/\s*url\s*=\s*(.+)/);
              if (urlMatch && urlMatch[1]) {
                parsedRemotes.push({ name: currentRemote, url: urlMatch[1].trim() });
                currentRemote = null;
              }
            }
          }
          if (parsedRemotes.length > 0) {
            setRemotes(parsedRemotes);
          }
        }
      } catch {
        // Ignore
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [api, cwd]);

  const handleSaveIdentity = async () => {
    if (!api || !cwd) return;
    setIsSavingIdentity(true);
    let currentConfig = "";
    try {
      try {
        const res = await api.projects.readFile({ cwd, relativePath: ".git/config" });
        currentConfig = res?.contents || "";
      } catch {
        // Ignore if no .git/config exists yet
      }

      const updatedConfig = updateGitConfigUser(currentConfig, name.trim(), email.trim());
      await api.projects.writeFile({ cwd, relativePath: ".git/config", contents: updatedConfig });

      // Verification check: read back and verify contents
      const verifyRes = await api.projects.readFile({ cwd, relativePath: ".git/config" });
      const readBackText = verifyRes?.contents || "";

      if (!verifyGitConfigUser(readBackText, name.trim(), email.trim())) {
        // Rollback on verification failure
        if (currentConfig) {
          await api.projects.writeFile({
            cwd,
            relativePath: ".git/config",
            contents: currentConfig,
          });
        }
        throw new Error("Git identity write failed verification check; changes rolled back.");
      }

      toastManager.add({ type: "success", title: "Saved Git identity" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save Git identity",
        description: error instanceof Error ? error.message : "Write error",
      });
    } finally {
      setIsSavingIdentity(false);
    }
  };

  const handleSaveGitignore = async () => {
    if (!api) return;
    setIsSavingGitignore(true);
    try {
      await api.projects.writeFile({ cwd, relativePath: ".gitignore", contents: gitignore });
      setGitignoreChanged(false);
      toastManager.add({ type: "success", title: "Saved .gitignore" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save .gitignore",
        description: error instanceof Error ? error.message : "Write error",
      });
    } finally {
      setIsSavingGitignore(false);
    }
  };

  return (
    <div className="git-settings-layout">
      <nav className="git-settings-nav" aria-label="Git settings categories">
        {(
          [
            ["repository", "Repository", "Identity, remotes & ignored files", FolderGit2],
            ["workflow", "Workflow", "Branch tracking preferences", GitBranch],
            ["ai", "AI & review", "Model, rules & summaries", Cpu],
          ] as const
        ).map(([id, title, description, Icon]) => (
          <button
            key={id}
            type="button"
            aria-current={category === id ? "page" : undefined}
            aria-controls={`${settingsId}-content`}
            onClick={() => setCategory(id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>
              <span className="git-settings-nav-title">{title}</span>
              <span className="git-settings-nav-description">{description}</span>
            </span>
          </button>
        ))}
      </nav>
      <div id={`${settingsId}-content`} className="git-settings-content">
        {category === "repository" && (
          <div>
            {" "}
            <SectionLabel>Git Identity</SectionLabel>
            <Card className="p-4 mb-4 space-y-3">
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Used as the author on every commit you make in this project.
              </p>
              <Field label="Name">
                <TextInput
                  aria-label="Commit author name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your Name"
                />
              </Field>
              <Field label="Email">
                <TextInput
                  aria-label="Commit author email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Button
                size="sm"
                disabled={!name.trim() || !email.trim() || isSavingIdentity}
                onClick={() => void handleSaveIdentity()}
              >
                {isSavingIdentity ? <Loader2 size={12} className="animate-spin" /> : null}
                {isSavingIdentity ? "Saving identity…" : "Save identity"}
              </Button>
            </Card>
            <SectionLabel
              action={
                <Button variant="ghost" size="sm" onClick={onOpenAddRemote}>
                  Add remote
                </Button>
              }
            >
              Remotes
            </SectionLabel>
            <Card className="p-3 mb-1">
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-3">
                The URLs this project pushes to and pulls from. Most projects only need "origin".
              </p>
              {remotes.length === 0 ? (
                <div className="text-[11px] text-muted-foreground/70 px-2 py-2">
                  No remotes configured.
                </div>
              ) : (
                remotes.map((r) => (
                  <div
                    key={r.name}
                    className="flex items-center gap-3 px-2 py-2.5 border-b border-border/50 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-mono text-foreground/90">{r.name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground/70 truncate">
                        {r.url}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void removeRemote(r.name)}>
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </Card>
            <SectionLabel>.gitignore</SectionLabel>
            <Card className="p-3">
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-3">
                Files and folders Git should never track for this project. One pattern per line.
              </p>
              <AutoTextarea
                aria-label="Ignored file patterns"
                value={gitignore}
                onChange={(e) => {
                  setGitignore(e.target.value);
                  setGitignoreChanged(true);
                }}
                minRows={4}
                className="w-full border border-border rounded-lg text-foreground bg-background font-mono text-[11px] placeholder:text-muted-foreground/50 p-3 outline-none focus:border-border transition-colors"
              />
              <div className="mt-2.5">
                <Button
                  size="sm"
                  disabled={!gitignoreChanged || isSavingGitignore}
                  onClick={() => void handleSaveGitignore()}
                >
                  {isSavingGitignore ? <Loader2 size={12} className="animate-spin" /> : null}
                  {isSavingGitignore ? "Saving .gitignore…" : "Save .gitignore"}
                </Button>
              </div>
            </Card>
          </div>
        )}
        {category === "workflow" && (
          <div>
            {" "}
            <SectionLabel>Watched Branches &amp; Divergence</SectionLabel>
            <Card className="p-4 mb-4 space-y-3.5">
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Configure the default landing tab for the Divergence space and specify the pinned
                target branch (e.g. <code>main</code> or <code>staging</code>) for live divergence
                tracking in the Agents panel and Git view.
              </p>
              <Field label="Default Divergence View">
                <SegmentedControl
                  size="sm"
                  orbitKind="spotlight"
                  value={defaultDivergenceView}
                  onValueChange={(val) =>
                    handleSetDefaultDivergenceView(val as "spotlight" | "active")
                  }
                  options={[
                    { value: "spotlight", label: "Spotlight ✦" },
                    { value: "active", label: "Active" },
                  ]}
                />
              </Field>
              <Field
                label={
                  <div className="flex items-center justify-between w-full">
                    <span>
                      Pinned Comparison Branches for Agents &amp; Git ({pinnedBranches.length}/
                      {MAX_PINNED_BRANCHES})
                    </span>
                    {pinnedBranches.length > 0 && (
                      <button
                        type="button"
                        onClick={handleUnpinAll}
                        className="text-[11px] font-normal text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                      >
                        Unpin all
                      </button>
                    )}
                  </div>
                }
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 flex-wrap min-h-7">
                    {pinnedBranches.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground/60 py-1">
                        No branches pinned. Type a branch name below to pin for divergence
                        comparisons.
                      </span>
                    ) : (
                      pinnedBranches.map((b) => (
                        <Badge
                          key={b}
                          variant="outline"
                          className="border-sky-500/40 text-sky-500 bg-sky-500/10 text-xs gap-1.5 px-2 py-0.5 font-mono"
                        >
                          <Pin size={11} className="fill-current" />
                          <span>{b}</span>
                          <button
                            type="button"
                            aria-label={`Unpin ${b}`}
                            onClick={() => handleRemovePinnedBranch(b)}
                            className="hover:text-foreground cursor-pointer opacity-70 hover:opacity-100"
                          >
                            <X size={11} />
                          </button>
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <TextInput
                      value={newPinInput}
                      onChange={(e) => setNewPinInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddPinnedBranch();
                      }}
                      placeholder="e.g. staging or feature/v2"
                      disabled={pinnedBranches.length >= MAX_PINNED_BRANCHES}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      disabled={!newPinInput.trim() || pinnedBranches.length >= MAX_PINNED_BRANCHES}
                      onClick={() => handleAddPinnedBranch()}
                    >
                      Pin Branch
                    </Button>
                  </div>
                </div>
              </Field>
            </Card>
            <SectionLabel>Excluded watched branches</SectionLabel>
            <Card className="p-3 mb-1">
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-3">
                By default, all local and remote-tracking branches with unmerged commits are watched
                on Overview. Add branch names here to exclude them from divergence checks.
              </p>
              <div className="flex items-center gap-2 mb-3">
                <TextInput
                  aria-label="Branch to exclude"
                  value={newExclude}
                  onChange={(e) => setNewExclude(e.target.value)}
                  placeholder="e.g. feature/old-experiment"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  disabled={!newExclude.trim()}
                  onClick={() => {
                    if (newExclude.trim()) {
                      onAddExcludedBranch?.(newExclude.trim());
                      setNewExclude("");
                    }
                  }}
                >
                  Exclude branch
                </Button>
              </div>
              {excludedBranches.length === 0 ? (
                <div className="text-[11px] text-muted-foreground/70 px-2 py-2">
                  No branches excluded (watching all branches).
                </div>
              ) : (
                excludedBranches.map((b) => (
                  <div
                    key={b}
                    className="flex items-center justify-between gap-3 px-2 py-2 border-b border-border/50 last:border-0"
                  >
                    <span className="text-xs font-mono text-foreground/90 truncate">{b}</span>
                    <Button variant="ghost" size="sm" onClick={() => onRemoveExcludedBranch?.(b)}>
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </Card>
          </div>
        )}
        {category === "ai" && (
          <div>
            {" "}
            <SectionLabel>Git AI Tools</SectionLabel>
            <Card className="p-4 mb-4 space-y-5">
              <Field
                label="Model for Git"
                description="Use the same Fusion model picker as chat. Configure providers in Tabs settings."
              >
                <GitModelPicker ariaLabel="Model for Git" />
              </Field>
              <div className="pt-3 border-t border-border/50">
                <Field
                  label="Custom Review Rules"
                  description="Instructions added to AI diff summaries, commit messages, and PR reviews."
                >
                  <AutoTextarea
                    aria-label="Custom review rules"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="e.g. Focus on breaking API changes, security vulnerabilities, and database migration risks."
                    minRows={3}
                    className="w-full border border-border/80 rounded-lg bg-background text-foreground text-xs p-2.5 outline-none focus:border-border transition-colors leading-relaxed font-mono"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={handleSaveCustomInstructions}>
                      Save Rules
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isAnalyzingRepo}
                      onClick={() => void handleAnalyzeRepoAndGenerateRules()}
                    >
                      {isAnalyzingRepo ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <FolderGit2 size={12} />
                      )}
                      {isAnalyzingRepo ? "Analyzing Repo…" : "Analyze Repo & Generate Rules"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleUseSuggestedRules}>
                      <Wand2 size={12} />
                      Use suggested rules
                    </Button>
                  </div>
                </Field>
              </div>

              <div className="pt-3 border-t border-border/50 space-y-3">
                <label className="text-[11px] font-semibold text-foreground tracking-tight block">
                  Included Summary Sections
                </label>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-medium text-foreground block">
                        High-Level Summary
                      </span>
                      <span className="text-[11px] text-muted-foreground/70 block">
                        Concise 1-2 sentence overview of changes
                      </span>
                    </div>
                    <Switch
                      aria-label="Include high-level summary"
                      checked={settings?.gitAi?.includeSummarySection ?? true}
                      onCheckedChange={(checked) => {
                        updateSettings.updateSettings({
                          gitAi: {
                            includeSummarySection: Boolean(checked),
                          },
                        });
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
                    <div className="space-y-0.5">
                      <span className="text-xs font-medium text-foreground block">
                        Key Changes by Module
                      </span>
                      <span className="text-[11px] text-muted-foreground/70 block">
                        Grouped list of changes per file/module
                      </span>
                    </div>
                    <Switch
                      aria-label="Include key changes"
                      checked={settings?.gitAi?.includeKeyChangesSection ?? true}
                      onCheckedChange={(checked) => {
                        updateSettings.updateSettings({
                          gitAi: {
                            includeKeyChangesSection: Boolean(checked),
                          },
                        });
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
                    <div className="space-y-0.5">
                      <span className="text-xs font-medium text-foreground block">
                        Notes & Risk Assessment
                      </span>
                      <span className="text-[11px] text-muted-foreground/70 block">
                        Highlights breaking changes and potential risks
                      </span>
                    </div>
                    <Switch
                      aria-label="Include notes and risks"
                      checked={settings?.gitAi?.includeNotesAndRiskSection ?? true}
                      onCheckedChange={(checked) => {
                        updateSettings.updateSettings({
                          gitAi: {
                            includeNotesAndRiskSection: Boolean(checked),
                          },
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
