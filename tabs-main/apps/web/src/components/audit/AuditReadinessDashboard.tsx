import React from "react";
import type { AuditMode } from "../../stores/auditStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ShieldCheck, Cpu, Code2, Zap, Layers, FileCode } from "lucide-react";

export interface AuditReadinessProps {
  readonly activeMode: AuditMode;
  readonly onSelectMode: (mode: AuditMode) => void;
  readonly onRunScan: () => void;
}

export function AuditReadinessDashboard({
  activeMode,
  onSelectMode,
  onRunScan,
}: AuditReadinessProps) {
  return (
    <div className="p-6 border border-border bg-card rounded-xl space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-foreground">
              Repository Code Audit & Security Engine
            </h2>
            <Badge
              variant="outline"
              className="text-[10px] border-emerald-500/30 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
            >
              System Ready
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl leading-relaxed">
            Deterministic AST indexing, sandboxed static analysis, disproof verification, and
            token-budgeted context packing ready for automated repository reviews.
          </p>
        </div>

        <Button
          onClick={onRunScan}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs px-5 py-2.5 rounded-lg shadow-md transition-all"
        >
          Launch {activeMode.replace("_", " ")} Scan
        </Button>
      </div>

      {/* Subsystem Readiness Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3.5 bg-muted/50 border border-border rounded-lg space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Cpu size={14} className="text-blue-600 dark:text-blue-400" />
            <span>AST Intelligence & Indexer</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Fast file enumeration with content-addressed SHA-256 caching and dependency graph
            extraction.
          </p>
        </div>

        <div className="p-3.5 bg-muted/50 border border-border rounded-lg space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
            <span>Sandboxed Analyzers</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Gitleaks, OpenGrep, and OSV-Scanner running in network-isolated process sandbox.
          </p>
        </div>

        <div className="p-3.5 bg-muted/50 border border-border rounded-lg space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Zap size={14} className="text-purple-600 dark:text-purple-400" />
            <span>Disproof Agent & FP Memory</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            2nd-pass guard verification suppresses false positives and applies user feedback memory.
          </p>
        </div>
      </div>

      {/* Mode Preset Selector Shortcuts */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Select Recommended Audit Mode
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              id: "full_audit" as const,
              title: "Full Codebase Audit",
              desc: "Complete repository scan across correctness, security, performance, and test gaps.",
              icon: FileCode,
            },
            {
              id: "pr_review" as const,
              title: "PR & Changed Files",
              desc: "Incremental audit targeting working tree changes and pull request diffs.",
              icon: Layers,
            },
            {
              id: "security" as const,
              title: "Security & Secrets",
              desc: "Dedicated secret leakage, injection, XSS, and dependency vulnerability scan.",
              icon: ShieldCheck,
            },
            {
              id: "architecture" as const,
              title: "Architecture & Quality",
              desc: "God-file identification, cyclomatic complexity, and subsystem boundary review.",
              icon: Code2,
            },
          ].map((preset) => {
            const IconComponent = preset.icon;
            const isSelected = activeMode === preset.id;

            return (
              <div
                key={preset.id}
                onClick={() => onSelectMode(preset.id)}
                className={`p-3.5 rounded-lg border text-xs cursor-pointer transition-all ${
                  isSelected
                    ? "bg-primary/10 border-primary text-foreground shadow-xs"
                    : "bg-muted/40 border-border text-foreground hover:border-border/80 hover:bg-muted/70"
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-foreground mb-1">
                  <IconComponent
                    size={14}
                    className={isSelected ? "text-foreground" : "text-muted-foreground"}
                  />
                  <span>{preset.title}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{preset.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
