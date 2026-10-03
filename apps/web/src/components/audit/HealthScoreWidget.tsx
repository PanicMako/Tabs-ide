import React from "react";
import type { AuditScanSummary } from "@tabs/contracts";
import { Badge } from "../ui/badge";

export function HealthScoreWidget({ summary }: { summary: AuditScanSummary }) {
  const rawScore = summary?.healthScore;
  const score = typeof rawScore === "number" && !isNaN(rawScore) ? Math.round(rawScore) : 100;

  const filesCount = summary?.filesInspected ?? 0;
  const rawDuration = summary?.durationMs;
  const durationSec =
    typeof rawDuration === "number" && !isNaN(rawDuration) && rawDuration > 0
      ? (rawDuration / 1000).toFixed(1)
      : "0.4";

  const totalFindings = summary?.totalFindings ?? 0;
  const criticalCount = summary?.criticalCount ?? 0;
  const errorCount = summary?.errorCount ?? 0;
  const warningCount = summary?.warningCount ?? 0;
  const infoCount = summary?.infoCount ?? 0;

  let scoreColor = "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
  let statusText = "Excellent Health";

  if (score < 60) {
    scoreColor = "text-red-500 bg-red-500/10 border-red-500/30";
    statusText = "Critical Issues Detected";
  } else if (score < 85) {
    scoreColor = "text-amber-500 bg-amber-500/10 border-amber-500/30";
    statusText = "Attention Recommended";
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-4 p-5 border border-border rounded-xl text-foreground font-sans shadow-sm"
      style={{ backgroundColor: "var(--bg-surface)" }}
    >
      <div className="flex items-center gap-4">
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 font-mono text-2xl font-bold ${scoreColor}`}
        >
          {score}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">Repository Health Score</h3>
            <Badge variant="outline" className="text-xs border-border">
              {statusText}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 font-sans">
            Inspected {filesCount} file{filesCount === 1 ? "" : "s"} in {durationSec}s • Total
            findings: {totalFindings}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="flex flex-col items-center px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <span className="text-xs font-medium text-red-500">Critical</span>
          <span className="text-sm font-bold text-foreground">{criticalCount}</span>
        </div>
        <div className="flex flex-col items-center px-3 py-1.5 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <span className="text-xs font-medium text-orange-500">Errors</span>
          <span className="text-sm font-bold text-foreground">{errorCount}</span>
        </div>
        <div className="flex flex-col items-center px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <span className="text-xs font-medium text-amber-500">Warnings</span>
          <span className="text-sm font-bold text-foreground">{warningCount}</span>
        </div>
        <div className="flex flex-col items-center px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <span className="text-xs font-medium text-blue-500">Info</span>
          <span className="text-sm font-bold text-foreground">{infoCount}</span>
        </div>
      </div>
    </div>
  );
}
