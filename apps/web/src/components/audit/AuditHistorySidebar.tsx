import React from "react";
import type { AuditHistoryRecord } from "../../stores/auditStore";
import { Plus, History, ChevronRight, Loader2, XCircle } from "lucide-react";

export interface AuditHistorySidebarProps {
  readonly historyRecords: ReadonlyArray<AuditHistoryRecord>;
  readonly activeScanId?: string | undefined;
  readonly isRunning?: boolean | undefined;
  readonly activeStage?: string | undefined;
  readonly onSelectRecord: (record: AuditHistoryRecord) => void;
  readonly onNewAudit: () => void;
}

export function AuditHistorySidebar({
  historyRecords,
  activeScanId,
  isRunning,
  activeStage,
  onSelectRecord,
  onNewAudit,
}: AuditHistorySidebarProps) {
  const getScopeLabel = (scopeKind: string) => {
    switch (scopeKind) {
      case "changed_files_only":
        return "Working Tree Diff";
      case "full_repository":
        return "Full Repository";
      case "folder":
        return "Target Directory";
      default:
        return scopeKind.replace("_", " ");
    }
  };

  return (
    <aside
      className="w-56 shrink-0 flex flex-col h-full border-r border-border text-foreground font-sans"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <History size={14} className="text-muted-foreground" />
          <span className="text-xs font-semibold tracking-tight text-foreground font-sans">
            Reviews
          </span>
        </div>
        <button
          onClick={onNewAudit}
          title="New Code Review"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Active Scan Running Indicator */}
        {isRunning && (
          <div className="px-3 py-2.5 mx-2 my-1 rounded-lg bg-primary/8 border border-primary/20">
            <div className="flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-foreground shrink-0" />
              <span className="text-xs font-medium text-foreground font-sans truncate">
                Scanning…
              </span>
              <span className="ml-auto text-[9px] font-mono font-bold text-foreground/60 uppercase">
                Live
              </span>
            </div>
            {activeStage && (
              <p className="mt-1 text-[10px] text-muted-foreground font-sans truncate pl-[20px]">
                {activeStage}
              </p>
            )}
          </div>
        )}

        {/* Empty State */}
        {historyRecords.length === 0 && !isRunning && (
          <div className="px-4 py-8 text-center space-y-2">
            <History className="h-5 w-5 text-muted-foreground/30 mx-auto" />
            <p className="text-[11px] text-muted-foreground leading-relaxed font-sans">
              No reviews yet
            </p>
          </div>
        )}

        {/* Records */}
        {historyRecords.map((record) => {
          const summary = record.result.summary;
          const isSelected = activeScanId === summary.auditId;
          const findingsCount = summary?.totalFindings ?? 0;
          const isPassed = findingsCount === 0;
          const time = new Date(record.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          return (
            <button
              key={record.id}
              onClick={() => onSelectRecord(record)}
              className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors cursor-pointer group ${
                isSelected
                  ? "bg-muted/60 text-foreground"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
            >
              {/* Status dot */}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isPassed ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate font-sans leading-tight">
                  {getScopeLabel(record.scopeKind)}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5 leading-tight">
                  {time}
                  {" · "}
                  {isPassed ? "Clean" : `${findingsCount} issue${findingsCount === 1 ? "" : "s"}`}
                </p>
              </div>

              <ChevronRight
                size={12}
                className={`shrink-0 transition-opacity ${
                  isSelected ? "opacity-60" : "opacity-0 group-hover:opacity-40"
                }`}
              />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
