import React from "react";
import type { AuditFinding } from "@tabs/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export interface FindingDetailDrawerProps {
  readonly finding: AuditFinding | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onOpenPatchModal: (finding: AuditFinding) => void;
  readonly onOpenAskAIDrawer: (id: string) => void;
  readonly onDismissFinding?: (id: string) => void;
  readonly onMarkFalsePositive?: (id: string) => void;
}

export function FindingDetailDrawer({
  finding,
  isOpen,
  onClose,
  onOpenPatchModal,
  onOpenAskAIDrawer,
  onDismissFinding,
  onMarkFalsePositive,
}: FindingDetailDrawerProps) {
  if (!isOpen || !finding) return null;

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-full max-w-lg border-l border-border shadow-2xl flex flex-col text-foreground"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs uppercase font-bold border-border">
            {finding.severity}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {finding.category}
          </Badge>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm font-semibold p-1 cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{finding.title}</h2>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            {finding.filePath}:{finding.startLine}-{finding.endLine}
          </p>
        </div>

        {/* Verification Status */}
        <div className="p-3 bg-muted/40 border border-border rounded-lg text-xs space-y-1">
          <div className="flex items-center justify-between font-mono">
            <span className="text-muted-foreground">Verification State:</span>
            <span
              className={`font-semibold ${
                finding.verificationState === "verified_passed"
                  ? "text-emerald-500"
                  : finding.verificationState === "verified_disproven"
                    ? "text-muted-foreground line-through"
                    : "text-amber-500"
              }`}
            >
              {finding.verificationState}
            </span>
          </div>
          {finding.disproofReason && (
            <p className="text-[11px] text-muted-foreground italic mt-1">
              {finding.disproofReason}
            </p>
          )}
        </div>

        {/* Explanation */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Detailed Explanation
          </h3>
          <p className="text-xs text-foreground/90 leading-relaxed bg-muted/30 p-3 rounded-lg border border-border">
            {finding.explanation}
          </p>
        </div>

        {/* Code Evidence Snippet */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Code Evidence
          </h3>
          <pre className="text-xs font-mono bg-muted/60 p-3 rounded-lg border border-border text-foreground overflow-x-auto">
            <code>{finding.evidenceSnippet}</code>
          </pre>
        </div>

        {/* Source Metadata */}
        <div className="text-xs font-mono space-y-1 text-muted-foreground bg-muted/20 p-3 rounded-lg border border-border">
          <div>
            Source Tool: <span className="text-foreground">{finding.sourceTool}</span>
          </div>
          {finding.ruleId && (
            <div>
              Rule ID: <span className="text-foreground">{finding.ruleId}</span>
            </div>
          )}
          <div>
            Confidence Score:{" "}
            <span className="text-foreground">{(finding.confidence * 100).toFixed(0)}%</span>
          </div>
          <div>
            Fingerprint: <span className="text-muted-foreground">{finding.fingerprint}</span>
          </div>
        </div>

        {/* Suggested Fix Summary */}
        {finding.suggestedFix && (
          <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg text-xs space-y-2">
            <h4 className="font-semibold text-foreground">Suggested Safe Repair Plan</h4>
            <p className="text-foreground">{finding.suggestedFix.description}</p>
            <Button
              onClick={() => onOpenPatchModal(finding)}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs py-1.5 rounded-md"
            >
              Preview Unified Diff Patch
            </Button>
          </div>
        )}
      </div>

      {/* Footer Action Bar */}
      <div className="p-4 border-t border-border bg-muted/40 flex items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => onOpenAskAIDrawer(finding.id)}
          className="text-xs text-purple-500 border-purple-500/30 hover:bg-purple-500/10"
        >
          Ask AI About Finding
        </Button>
        <div className="flex items-center gap-2">
          {onMarkFalsePositive && (
            <Button
              variant="outline"
              onClick={() => onMarkFalsePositive(finding.id)}
              className="text-xs text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
            >
              False Positive
            </Button>
          )}
          {onDismissFinding && (
            <Button
              variant="outline"
              onClick={() => onDismissFinding(finding.id)}
              className="text-xs text-muted-foreground border-border hover:bg-muted"
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
