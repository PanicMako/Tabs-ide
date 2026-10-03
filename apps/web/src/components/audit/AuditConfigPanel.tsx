import React, { useState } from "react";
import type { AuditScanDepth } from "@tabs/contracts";
import type { AuditMode } from "../../stores/auditStore";
import { ArrowRight, Loader2, Folder, ShieldAlert, ShieldCheck } from "lucide-react";
import { Input } from "../ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";

export interface AuditConfigProps {
  readonly activeMode: AuditMode;
  readonly scopeKind:
    | "full_repository"
    | "workspace_package"
    | "folder"
    | "selected_files"
    | "changed_files_only";
  readonly depth: AuditScanDepth;
  readonly isRunning: boolean;
  readonly cwd?: string;
  readonly api?: any;
  readonly onSelectMode: (mode: AuditMode) => void;
  readonly onScopeChange: (
    scope:
      | "full_repository"
      | "workspace_package"
      | "folder"
      | "selected_files"
      | "changed_files_only",
  ) => void;
  readonly onDepthChange: (depth: AuditScanDepth) => void;
  readonly onRunScan: () => void;
}

const DEPTH_OPTIONS: { id: AuditScanDepth; label: string; hint: string }[] = [
  { id: "quick", label: "Quick", hint: "Static pattern scan — results in seconds." },
  { id: "standard", label: "Standard", hint: "2-pass AI review across symbols & imports." },
  { id: "deep", label: "Deep", hint: "Full AST graph + disproof verifier pass." },
];

const SCOPES = [
  {
    id: "changed_files_only" as const,
    title: "Working Tree & PR Changes",
    subtitle: "Git diff — modified files & uncommitted changes",
  },
  {
    id: "full_repository" as const,
    title: "Full Repository",
    subtitle: "Complete codebase across all modules",
  },
  {
    id: "folder" as const,
    title: "Subsystem / Target Folder",
    subtitle: "Restricted to a specific package or directory",
  },
];

const MODE_LABELS: Record<string, string> = {
  pr_review: "Git Diff & Working Tree",
  full_audit: "Full Codebase Audit",
  security: "Security Audit",
  architecture: "Architecture Review",
  refactoring: "Refactoring Review",
};

export function AuditConfigPanel({
  activeMode,
  scopeKind,
  depth,
  isRunning,
  cwd,
  api,
  onSelectMode,
  onScopeChange,
  onDepthChange,
  onRunScan,
}: AuditConfigProps) {
  const [targetFolderPath, setTargetFolderPath] = useState("apps/web");
  const [scopeError, setScopeError] = useState<string | null>(null);

  const validateAndSetFolder = (inputPath: string) => {
    const trimmed = inputPath.trim();
    setTargetFolderPath(trimmed);

    if (!trimmed) {
      setScopeError("Path cannot be empty.");
      return;
    }

    if (cwd) {
      const normCwd = cwd.replace(/\\/g, "/").replace(/\/$/, "");
      const normInput = trimmed.replace(/\\/g, "/");

      if (normInput.startsWith("/") || normInput.includes(":\\")) {
        if (!normInput.startsWith(normCwd)) {
          setScopeError(
            "Directory is outside the workspace root — must stay inside the repository.",
          );
          return;
        }
      } else if (normInput.startsWith("..") || normInput.includes("/../")) {
        setScopeError("Path traversal outside workspace root is forbidden.");
        return;
      }
    }

    setScopeError(null);
  };

  const handleBrowseFolder = async () => {
    try {
      const picked = await api?.dialogs?.pickFolder?.();
      if (picked) validateAndSetFolder(picked);
    } catch (err) {
      console.error("Folder picker error", err);
    }
  };

  const selectedDepth = DEPTH_OPTIONS.find((d) => d.id === depth)!;

  return (
    <div className="space-y-12 font-sans">
      {/* ── Title row ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground leading-none">
            Code Review
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a scope and analysis depth, then begin.
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground font-sans whitespace-nowrap">
            Review Type:
          </span>
          <Select value={activeMode} onValueChange={(v) => onSelectMode(v as typeof activeMode)}>
            <SelectTrigger className="h-8 text-xs font-sans bg-transparent border-border text-foreground w-44">
              <SelectValue>{MODE_LABELS[activeMode]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pr_review">Git Diff & Working Tree</SelectItem>
              <SelectItem value="full_audit">Full Codebase Audit</SelectItem>
              <SelectItem value="security">Security Audit</SelectItem>
              <SelectItem value="architecture">Architecture Review</SelectItem>
              <SelectItem value="refactoring">Refactoring Review</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Scope selection ──────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-[10px] font-bold tracking-widest uppercase font-mono text-muted-foreground/60 mb-4">
          WHAT SHOULD I LOOK AT?
        </p>

        <div className="space-y-0.5">
          {SCOPES.map((scope) => {
            const selected = scopeKind === scope.id;
            return (
              <div key={scope.id}>
                <button
                  onClick={() => onScopeChange(scope.id)}
                  className={`group w-full flex items-center gap-4 py-3.5 rounded-lg text-left transition-all cursor-pointer pl-3 ${
                    selected ? "bg-muted/30" : "hover:bg-muted/15"
                  }`}
                >
                  {/* Left accent bar */}
                  <span
                    className={`w-0.5 self-stretch rounded-full shrink-0 transition-all ${
                      selected ? "bg-primary" : "bg-transparent group-hover:bg-muted-foreground/20"
                    }`}
                  />

                  <div className="min-w-0">
                    <span
                      className={`text-[1.1rem] font-sans leading-tight transition-all ${
                        selected
                          ? "font-semibold text-foreground"
                          : "font-normal text-muted-foreground/40 group-hover:text-muted-foreground/70"
                      }`}
                    >
                      {scope.title}
                    </span>
                    {selected && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-sans">
                        {scope.subtitle}
                      </p>
                    )}
                  </div>
                </button>

                {/* Target folder input */}
                {scope.id === "folder" && selected && (
                  <div className="ml-8 mt-2 mb-1 space-y-2 max-w-sm">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Folder
                          size={12}
                          className="text-muted-foreground absolute left-2.5 top-2.5"
                        />
                        <Input
                          value={targetFolderPath}
                          onChange={(e) => validateAndSetFolder(e.target.value)}
                          placeholder="apps/web or packages/contracts"
                          className={`w-full pl-7 h-8 text-xs bg-muted/30 border-border text-foreground font-mono ${scopeError ? "border-red-500" : ""}`}
                        />
                      </div>
                      <button
                        onClick={handleBrowseFolder}
                        className="h-8 px-3 text-xs font-medium rounded-md bg-muted border border-border hover:bg-accent text-foreground transition-colors shrink-0 cursor-pointer"
                      >
                        Browse
                      </button>
                    </div>
                    {scopeError && (
                      <div className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                        <ShieldAlert size={12} className="shrink-0 mt-px" />
                        <span>{scopeError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Analysis depth ───────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold tracking-widest uppercase font-mono text-muted-foreground/60">
          ANALYSIS DEPTH
        </p>

        <div className="grid grid-cols-3 gap-2">
          {DEPTH_OPTIONS.map((d) => {
            const active = depth === d.id;
            return (
              <button
                key={d.id}
                onClick={() => onDepthChange(d.id)}
                className={`flex flex-col gap-2 px-5 py-4 rounded-xl border text-left cursor-pointer transition-all ${
                  active
                    ? "border-border bg-muted/50 text-foreground"
                    : "border-border/50 bg-transparent text-muted-foreground/50 hover:border-border hover:text-muted-foreground hover:bg-muted/20"
                }`}
              >
                <span
                  className={`text-sm font-semibold font-sans ${active ? "text-foreground" : ""}`}
                >
                  {d.label}
                </span>
                <span
                  className={`text-[11px] font-sans leading-snug ${active ? "text-muted-foreground" : "text-muted-foreground/40"}`}
                >
                  {d.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Action ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/30">
          <ShieldCheck size={13} className="text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground font-sans">
            Sandboxed execution — your code never leaves this machine
          </span>
        </div>

        <button
          onClick={onRunScan}
          disabled={isRunning || Boolean(scopeError)}
          className="group bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-sm px-7 py-2.5 rounded-lg flex items-center gap-2.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
        >
          {isRunning ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Scanning…</span>
            </>
          ) : (
            <>
              <span>Begin Review</span>
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
