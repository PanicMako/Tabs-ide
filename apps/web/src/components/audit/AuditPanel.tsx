import React, { useState } from "react";
import { useAuditStore, updateAuditState } from "../../stores/auditStore";
import { GitModelPicker } from "../git/gitPrimitives";
import { HealthScoreWidget } from "./HealthScoreWidget";
import { AuditConfigPanel } from "./AuditConfigPanel";
import { AuditProgressView } from "./AuditProgressView";
import { AuditHistorySidebar } from "./AuditHistorySidebar";
import { FindingsTableView } from "./FindingsTableView";
import { FindingDetailDrawer } from "./FindingDetailDrawer";
import { PatchPreviewModal } from "./PatchPreviewModal";
import { AuditAskAIChat } from "./AuditAskAIChat";
import { Button } from "../ui/button";
import { AlertCircle, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";

export function AuditPanel({
  cwd,
  stateKey = cwd,
  api,
}: {
  cwd: string;
  stateKey?: string;
  api: any;
}) {
  const {
    state,
    setActiveMode,
    setScopeKind,
    setDepth,
    setModelSelection,
    setSelectedFindingId,
    setFilterSeverity,
    setFilterCategory,
    setFilterVerification,
    setSearchQuery,
    openPatchModal,
    closePatchModal,
    openAskAIDrawer,
    closeAskAIDrawer,
    selectHistoryRecord,
    runAudit,
  } = useAuditStore(stateKey, cwd);

  // Custom confirmation modal state for interrupting active scans
  const [pendingNewAudit, setPendingNewAudit] = useState(false);

  const selectedFinding =
    state.scanResult?.findings.find((f) => f.id === state.selectedFindingId) ?? null;
  const isRunning = state.status === "running";

  const handleNewAuditClick = () => {
    if (isRunning) {
      setPendingNewAudit(true);
    } else {
      updateAuditState(stateKey, { scanResult: null, status: "idle" });
    }
  };

  const handleSelectRecord = (record: any) => {
    if (isRunning) {
      setPendingNewAudit(true);
    } else {
      selectHistoryRecord(record);
    }
  };

  return (
    <div
      className="flex h-full w-full overflow-hidden font-sans text-foreground"
      style={{ backgroundColor: "var(--bg-base)", color: "var(--fg)" }}
    >
      {/* 1. Left Chronology Rail (Persistent Audit History Timeline) */}
      <AuditHistorySidebar
        historyRecords={state.historyRecords}
        activeScanId={state.scanResult?.summary.auditId}
        isRunning={isRunning}
        activeStage={state.latestProgress?.stage}
        onSelectRecord={handleSelectRecord}
        onNewAudit={handleNewAuditClick}
      />

      {/* 2. Main Center Workspace Reading Surface */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto">
        {/* Slim top bar: just cwd context + model picker */}
        <div className="flex items-center justify-between border-b border-border px-8 py-2.5 shrink-0">
          <span className="text-[11px] font-mono text-muted-foreground truncate max-w-sm">
            {cwd}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-muted-foreground font-sans">AI Model:</span>
            <GitModelPicker selection={state.modelSelection} onSelect={setModelSelection} />
          </div>
        </div>

        {/* Workspace body */}
        <div className="flex-1 overflow-y-auto">
          {/* Config panel state: vertically centered in the available space */}
          {(state.status === "idle" || state.status === "error") && !state.scanResult ? (
            <div className="w-full px-12 py-10 space-y-6">
              <div className="w-full">
                {/* Error banner */}
                {state.status === "error" && (
                  <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5 flex items-start gap-3">
                    <AlertCircle
                      size={16}
                      className="text-red-600 dark:text-red-400 shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-semibold text-foreground font-sans">
                        Review Failed
                      </p>
                      <p className="text-xs text-muted-foreground font-mono leading-relaxed break-all">
                        {state.errorMessage ??
                          "An unknown error occurred. Check model configuration and try again."}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        updateAuditState(stateKey, {
                          status: "idle",
                          errorMessage: null,
                          scanResult: null,
                        })
                      }
                      className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 bg-muted/40 hover:bg-muted transition-colors cursor-pointer"
                    >
                      <RotateCcw size={11} />
                      Dismiss
                    </button>
                  </div>
                )}

                <AuditConfigPanel
                  activeMode={state.activeMode}
                  scopeKind={state.scopeKind}
                  depth={state.depth}
                  isRunning={isRunning}
                  cwd={cwd}
                  api={api}
                  onSelectMode={setActiveMode}
                  onScopeChange={setScopeKind}
                  onDepthChange={setDepth}
                  onRunScan={() => runAudit(api)}
                />
              </div>
            </div>
          ) : (
            /* Results / progress state: normal top-anchored flow */
            <div className="px-8 py-6">
              <div className="max-w-3xl w-full mx-auto space-y-6">
                {isRunning && (
                  <AuditProgressView
                    latestProgress={state.latestProgress}
                    progressLogs={state.progressLogs}
                  />
                )}
                {state.scanResult?.summary && (
                  <HealthScoreWidget summary={state.scanResult.summary} />
                )}
                {state.scanResult?.findings && (
                  <FindingsTableView
                    findings={state.scanResult.findings}
                    selectedFindingId={state.selectedFindingId}
                    filterSeverity={state.filterSeverity}
                    filterCategory={state.filterCategory}
                    filterVerification={state.filterVerification}
                    searchQuery={state.searchQuery}
                    onSelectFinding={(id) => {
                      setSelectedFindingId(id);
                    }}
                    onFilterSeverityChange={setFilterSeverity}
                    onFilterCategoryChange={setFilterCategory}
                    onFilterVerificationChange={setFilterVerification}
                    onSearchQueryChange={setSearchQuery}
                    onOpenPatchModal={openPatchModal}
                    onOpenAskAIDrawer={openAskAIDrawer}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Standard App Confirmation Dialog for Interrupting Active Scan */}
      <Dialog open={pendingNewAudit} onOpenChange={setPendingNewAudit}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground font-sans">
              Cancel Active Audit Scan?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed font-sans mt-1">
              An audit scan is currently running in the background. Starting a new audit will cancel
              the active scan and discard progress. Are you sure you want to proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              onClick={() => setPendingNewAudit(false)}
              className="text-xs text-foreground border-border cursor-pointer"
            >
              Keep Scanning
            </Button>
            <Button
              onClick={() => {
                setPendingNewAudit(false);
                updateAuditState(stateKey, { scanResult: null, status: "idle" });
              }}
              className="bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-4 py-2 cursor-pointer"
            >
              Cancel Scan & Start New
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3. Detail Drawers & Modals */}
      <FindingDetailDrawer
        finding={selectedFinding}
        isOpen={Boolean(selectedFinding && !state.isAskAIDrawerOpen)}
        onClose={() => setSelectedFindingId(null)}
        onOpenPatchModal={openPatchModal}
        onOpenAskAIDrawer={openAskAIDrawer}
      />

      <PatchPreviewModal
        finding={state.activePatchFinding}
        isOpen={state.isPatchModalOpen}
        onClose={closePatchModal}
      />

      <AuditAskAIChat
        selectedFinding={selectedFinding}
        isOpen={state.isAskAIDrawerOpen}
        onClose={closeAskAIDrawer}
      />
    </div>
  );
}
