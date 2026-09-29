import type { GitEnvironmentResult, ProviderInstanceId } from "@tabs/contracts";
import {
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  FolderGit2,
  Globe,
  KeyRound,
  Loader2,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useGitApi } from "./gitApiContext";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
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
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const api = useGitApi();

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

  const isGeminiConfigured = Boolean(settings?.providers?.gemini?.apiKey?.trim());

  useEffect(() => {
    if (settings?.providers?.gemini?.apiKey !== undefined) {
      setGeminiApiKey(settings.providers.gemini.apiKey);
    }
    if (settings?.gitAi?.customPromptInstructions !== undefined) {
      setCustomInstructions(settings.gitAi.customPromptInstructions);
    }
  }, [settings?.providers?.gemini?.apiKey, settings?.gitAi?.customPromptInstructions]);

  const [modelSourceMode, setModelSourceModeState] = useState<"connected" | "direct_gemini">(() => {
    return settings?.gitAi?.modelSourceMode ?? "connected";
  });
  const [keyScope, setKeyScope] = useState<"global" | "project">("global");
  const [isAnalyzingRepo, setIsAnalyzingRepo] = useState(false);

  useEffect(() => {
    if (settings?.gitAi?.modelSourceMode) {
      setModelSourceModeState(settings.gitAi.modelSourceMode);
    }
  }, [settings?.gitAi?.modelSourceMode]);

  const setModelSourceMode = (mode: "connected" | "direct_gemini") => {
    setModelSourceModeState(mode);
    updateSettings.updateSettings({
      gitAi: {
        modelSourceMode: mode,
      },
    });
  };

  const handleAnalyzeRepoAndGenerateRules = async () => {
    if (!api || !cwd) {
      toastManager.add({ type: "error", title: "Workspace API unavailable" });
      return;
    }

    const currentKey = geminiApiKey.trim();
    if (currentKey && currentKey !== settings?.providers?.gemini?.apiKey) {
      updateSettings.updateSettings({
        providers: {
          gemini: {
            apiKey: currentKey,
          },
        },
      });
    }

    const isDirectGemini =
      (settings?.gitAi?.modelSourceMode ?? modelSourceMode) === "direct_gemini";
    const effectiveKey = currentKey || settings?.providers?.gemini?.apiKey?.trim();

    if (isDirectGemini && !effectiveKey) {
      toastManager.add({
        type: "error",
        title: "Gemini API Key Required",
        description:
          "Please enter your Google Gemini API key and click Save Key before generating rules.",
      });
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

      const activeModelSelection = settings?.gitAi?.gitTextGenerationModelSelection || {
        instanceId: "gemini",
        model: "gemini-3.6-flash",
      };

      const userPrompt = [
        `Deep Codebase Analysis Request for Workspace: ${cwd}`,
        pkgDetails ? `Repository Context: ${pkgDetails}` : "",
        "Task: Analyze the architecture, frameworks, and coding patterns of this codebase.",
        "Generate 4-6 concise, highly specific AI Code Review Rules tailored to this repository.",
        "Focus on breaking API changes, data contract schemas, type safety, error boundaries, security vulnerabilities, and testing guidelines.",
      ]
        .filter(Boolean)
        .join("\n\n");

      let res: import("@tabs/contracts").GitGenerateDiffSummaryResult | null = null;
      let usedModelName = activeModelSelection.model;

      try {
        res = await api.git.generateDiffSummary({
          cwd,
          target: { kind: "working_tree" },
          modelSelection: activeModelSelection as import("@tabs/contracts").ModelSelection,
          userHint: userPrompt,
        });
      } catch (firstErr) {
        // Fallback retry with Gemini 2.5 Flash if primary selected provider failed or request was cancelled
        const fallbackSelection = {
          instanceId: "gemini" as ProviderInstanceId,
          model: "gemini-3.6-flash",
        };
        if (activeModelSelection.instanceId !== "gemini") {
          usedModelName = "Gemini 2.5 Flash (Fallback)";
          res = await api.git.generateDiffSummary({
            cwd,
            target: { kind: "working_tree" },
            modelSelection: fallbackSelection,
            userHint: userPrompt,
          });
        } else {
          throw firstErr;
        }
      }

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
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSaveGeminiKey = () => {
    updateSettings.updateSettings({
      providers: {
        gemini: {
          apiKey: geminiApiKey.trim(),
        },
      },
    });
    toastManager.add({ type: "success", title: "Saved Google Gemini API key" });
  };

  const handleTestGeminiKey = async () => {
    const key = geminiApiKey.trim();
    if (!key) {
      toastManager.add({ type: "error", title: "Gemini API key is empty" });
      return;
    }
    setIsTestingKey(true);
    setTestResult(null);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      );
      if (res.ok) {
        setTestResult({
          ok: true,
          message: "API key validated successfully with Google AI Studio (HTTP 200).",
        });
        toastManager.add({ type: "success", title: "Google Gemini API key valid!" });
      } else {
        const errText = await res.text().catch(() => "");
        setTestResult({
          ok: false,
          message: `Gemini API HTTP ${res.status}: ${errText || res.statusText}`,
        });
        toastManager.add({
          type: "error",
          title: "Google Gemini API key invalid",
          description: `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      });
      toastManager.add({ type: "error", title: "Connection failed", description: String(err) });
    } finally {
      setIsTestingKey(false);
    }
  };

  const handleClearGeminiKey = () => {
    setGeminiApiKey("");
    setTestResult(null);
    updateSettings.updateSettings({
      providers: {
        gemini: {
          apiKey: "",
        },
      },
    });
    toastManager.add({ type: "info", title: "Cleared Google Gemini API key" });
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
    <div>
      <SectionLabel>Git AI Tools</SectionLabel>
      <Card className="p-4 mb-4 space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 pb-2 border-b border-border/40">
            <div>
              <span className="text-xs font-semibold text-foreground block">Model Source Mode</span>
              <span className="text-[11px] text-muted-foreground/70 block">
                Choose how AI models are routed for diff summaries and reviews
              </span>
            </div>
            <div
              className="tabs-segmented flex items-center"
              role="group"
              aria-label="Model source mode"
            >
              <button
                type="button"
                onClick={() => setModelSourceMode("connected")}
                aria-pressed={modelSourceMode === "connected"}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                  modelSourceMode === "connected"
                    ? "bg-background text-foreground shadow-xs border border-border/80 font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Cpu size={12} /> Connected Providers
              </button>
              <button
                type="button"
                onClick={() => setModelSourceMode("direct_gemini")}
                aria-pressed={modelSourceMode === "direct_gemini"}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                  modelSourceMode === "direct_gemini"
                    ? "bg-background text-foreground shadow-xs border border-border/80 font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <KeyRound size={12} /> Direct Gemini API
              </button>
            </div>
          </div>

          <Field
            label="Active Git AI Model"
            description={
              modelSourceMode === "connected"
                ? "Selecting models from connected provider subscriptions (Codex, Claude, Grok, Cursor, OpenCode)."
                : "Selecting models powered by your direct Google Gemini API key."
            }
          >
            <GitModelPicker
              selection={settings?.gitAi?.gitTextGenerationModelSelection}
              filterSourceMode={modelSourceMode}
              onSelect={(selection) => {
                updateSettings.updateSettings({
                  gitAi: {
                    gitTextGenerationModelSelection: selection,
                  },
                });
              }}
            />
          </Field>
        </div>

        {modelSourceMode === "connected" ? (
          <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
              <span>
                Using Connected Provider Subscriptions (Codex, Claude, Grok, Cursor) — No API Key
                required.
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModelSourceMode("direct_gemini")}
              className="text-primary hover:text-primary text-[11px]"
            >
              Use Gemini API Key
            </Button>
          </div>
        ) : (
          <div className="pt-3 border-t border-border/50">
            <Field
              label="Google Gemini API Key"
              description="Enables Google Gemini 2.5 Flash / Pro for high-speed 1M-token diff summaries. Supports standard keys from Google AI Studio (aistudio.google.com)."
            >
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <TextInput
                      type={showGeminiKey ? "text" : "password"}
                      value={geminiApiKey}
                      onChange={(e) => {
                        setGeminiApiKey(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder="AIzaSy..."
                      className="w-full font-mono text-xs pr-9"
                    />
                    <button
                      type="button"
                      aria-label={showGeminiKey ? "Hide Gemini API key" : "Show Gemini API key"}
                      aria-pressed={showGeminiKey}
                      onClick={() => setShowGeminiKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
                    >
                      {showGeminiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <Button size="sm" onClick={handleSaveGeminiKey}>
                    Save Key
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!geminiApiKey.trim() || isTestingKey}
                    onClick={() => void handleTestGeminiKey()}
                  >
                    {isTestingKey ? <Loader2 size={12} className="animate-spin" /> : null}
                    {isTestingKey ? "Testing…" : "Test Key"}
                  </Button>
                  {isGeminiConfigured && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearGeminiKey}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 text-[11px] pt-1">
                  <div className="flex items-center gap-2">
                    {isGeminiConfigured ? (
                      <span className="inline-flex items-center gap-1 text-emerald-500 font-medium">
                        <CheckCircle2 size={12} /> Key Configured
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70 font-medium">Not Configured</span>
                    )}
                  </div>
                  <div
                    className="tabs-segmented flex items-center"
                    role="group"
                    aria-label="API key scope"
                  >
                    <button
                      type="button"
                      onClick={() => setKeyScope("global")}
                      aria-pressed={keyScope === "global"}
                      className={cn(
                        "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer",
                        keyScope === "global"
                          ? "bg-background text-foreground font-semibold border border-border/60"
                          : "text-muted-foreground/70",
                      )}
                      title="Global System-Wide key: shared across all projects in Tabs"
                    >
                      <Globe size={10} /> Global System
                    </button>
                    <button
                      type="button"
                      onClick={() => setKeyScope("project")}
                      aria-pressed={keyScope === "project"}
                      className={cn(
                        "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer",
                        keyScope === "project"
                          ? "bg-background text-foreground font-semibold border border-border/60"
                          : "text-muted-foreground/70",
                      )}
                      title="Project Local key: overrides key for this workspace repository"
                    >
                      <FolderGit2 size={10} /> Project Workspace
                    </button>
                  </div>
                </div>

                {testResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
                      testResult.ok
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                        : "bg-destructive/10 border-destructive/30 text-destructive"
                    }`}
                  >
                    {testResult.message}
                  </div>
                )}
              </div>
            </Field>
          </div>
        )}

        <div className="pt-3 border-t border-border/50">
          <Field
            label="Custom Review Rules"
            description="Instructions added to AI diff summaries, commit messages, and PR reviews."
          >
            <AutoTextarea
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

      <SectionLabel>Git Identity</SectionLabel>
      <Card className="p-4 mb-4 space-y-3">
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          Used as the author on every commit you make in this project.
        </p>
        <Field label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your Name"
          />
        </Field>
        <Field label="Email">
          <TextInput
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

      <SectionLabel>Excluded watched branches</SectionLabel>
      <Card className="p-3 mb-1">
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-3">
          By default, all local and remote-tracking branches with unmerged commits are watched on
          Overview. Add branch names here to exclude them from divergence checks.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <TextInput
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
  );
}
