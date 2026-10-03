import React from "react";
import type { ReviewProgressEvent } from "@tabs/contracts";

export function AuditProgressView({
  latestProgress,
  progressLogs,
}: {
  latestProgress: ReviewProgressEvent | null;
  progressLogs: ReviewProgressEvent[];
}) {
  return (
    <div
      className="p-8 border border-border rounded-xl flex flex-col items-center justify-center space-y-6 shadow-sm text-foreground"
      style={{ backgroundColor: "var(--bg-surface)" }}
    >
      {/* Animated Circular Squircle Spinner */}
      <div className="relative w-24 h-24 bg-muted/40 rounded-2xl border border-border flex items-center justify-center shadow-inner">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" strokeWidth="6" />
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="6"
            strokeDasharray="250"
            strokeDashoffset="80"
            className="animate-spin origin-center"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="text-center space-y-1">
        <h3 className="text-lg font-semibold text-foreground font-sans">
          {latestProgress?.message ?? "Reading codebase..."}
        </h3>
        <p className="text-xs font-mono text-foreground font-medium">
          Active Stage: {latestProgress?.stage ?? "assembling_context"}
        </p>
      </div>

      {/* Execution Logs Output */}
      <div className="w-full max-w-lg max-h-32 overflow-y-auto font-mono text-[11px] bg-muted/60 p-3 rounded-lg border border-border text-foreground space-y-1">
        {progressLogs.map((log, idx) => (
          <div key={idx} className="flex items-center justify-between">
            <span className="truncate max-w-xs">&gt; {log.message}</span>
            <span className="text-muted-foreground text-[10px]">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
