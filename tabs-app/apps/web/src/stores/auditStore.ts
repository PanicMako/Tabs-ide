import { useEffect, useState } from "react";
import type {
  AuditCategory,
  AuditFinding,
  AuditScanDepth,
  AuditScanInput,
  AuditScanResult,
  AuditSeverity,
  FindingVerificationState,
  ModelSelection,
  ReviewProgressEvent,
} from "@tabs/contracts";
import { toastManager } from "../components/ui/toast";

export type AuditMode = "pr_review" | "full_audit" | "security" | "architecture" | "refactoring";

export interface AuditHistoryRecord {
  id: string;
  timestamp: string;
  mode: AuditMode;
  depth: AuditScanDepth;
  scopeKind: string;
  modelUsed: string;
  result: AuditScanResult;
}

export interface AuditStoreState {
  activeMode: AuditMode;
  status: "idle" | "running" | "done" | "error";
  scopeKind:
    | "full_repository"
    | "workspace_package"
    | "folder"
    | "selected_files"
    | "changed_files_only";
  depth: AuditScanDepth;
  targetPaths: string[];
  enabledCategories: AuditCategory[];
  modelSelection: ModelSelection;
  latestProgress: ReviewProgressEvent | null;
  progressLogs: ReviewProgressEvent[];
  scanResult: AuditScanResult | null;
  historyRecords: AuditHistoryRecord[];
  selectedFindingId: string | null;
  filterSeverity: AuditSeverity | "all";
  filterCategory: AuditCategory | "all";
  filterVerification: FindingVerificationState | "all";
  searchQuery: string;
  isPatchModalOpen: boolean;
  isAskAIDrawerOpen: boolean;
  activePatchFinding: AuditFinding | null;
  errorMessage: string | null;
  startedAt: number | null;
}

const defaultState: AuditStoreState = {
  activeMode: "full_audit",
  status: "idle",
  scopeKind: "full_repository",
  depth: "standard",
  targetPaths: [],
  enabledCategories: ["correctness", "security", "performance", "architecture"],
  modelSelection: {
    instanceId: "gemini" as any,
    model: "gemini-3.6-flash",
  },
  latestProgress: null,
  progressLogs: [],
  scanResult: null,
  historyRecords: [],
  selectedFindingId: null,
  filterSeverity: "all",
  filterCategory: "all",
  filterVerification: "all",
  searchQuery: "",
  isPatchModalOpen: false,
  isAskAIDrawerOpen: false,
  activePatchFinding: null,
  errorMessage: null,
  startedAt: null,
};

const storeByCwd: Record<string, AuditStoreState> = {};
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function getAuditState(cwd: string): AuditStoreState {
  return storeByCwd[cwd] ?? { ...defaultState };
}

export function updateAuditState(
  cwd: string,
  updater: Partial<AuditStoreState> | ((prev: AuditStoreState) => AuditStoreState),
): void {
  const current = getAuditState(cwd);
  const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
  storeByCwd[cwd] = next;
  notify();
}

export function useAuditStore(cwd: string, runtimeCwd: string = cwd) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const state = getAuditState(cwd);

  return {
    state,
    setActiveMode: (activeMode: AuditMode) => updateAuditState(cwd, { activeMode }),
    setScopeKind: (scopeKind: AuditStoreState["scopeKind"]) => updateAuditState(cwd, { scopeKind }),
    setDepth: (depth: AuditScanDepth) => updateAuditState(cwd, { depth }),
    setTargetPaths: (targetPaths: string[]) => updateAuditState(cwd, { targetPaths }),
    setModelSelection: (modelSelection: ModelSelection) =>
      updateAuditState(cwd, { modelSelection }),
    setSelectedFindingId: (selectedFindingId: string | null) =>
      updateAuditState(cwd, { selectedFindingId }),
    setFilterSeverity: (filterSeverity: AuditSeverity | "all") =>
      updateAuditState(cwd, { filterSeverity }),
    setFilterCategory: (filterCategory: AuditCategory | "all") =>
      updateAuditState(cwd, { filterCategory }),
    setFilterVerification: (filterVerification: FindingVerificationState | "all") =>
      updateAuditState(cwd, { filterVerification }),
    setSearchQuery: (searchQuery: string) => updateAuditState(cwd, { searchQuery }),
    openPatchModal: (activePatchFinding: AuditFinding) =>
      updateAuditState(cwd, { isPatchModalOpen: true, activePatchFinding }),
    closePatchModal: () =>
      updateAuditState(cwd, { isPatchModalOpen: false, activePatchFinding: null }),
    openAskAIDrawer: (selectedFindingId?: string) =>
      updateAuditState(cwd, {
        isAskAIDrawerOpen: true,
        ...(selectedFindingId ? { selectedFindingId } : {}),
      }),
    closeAskAIDrawer: () => updateAuditState(cwd, { isAskAIDrawerOpen: false }),
    selectHistoryRecord: (record: AuditHistoryRecord) => {
      updateAuditState(cwd, {
        scanResult: record.result,
        activeMode: record.mode,
        depth: record.depth,
        status: "done",
      });
      toastManager.add({
        type: "info",
        title: "Loaded Historical Audit",
        description: `Loaded audit run from ${new Date(record.timestamp).toLocaleTimeString()} (${record.result.findings?.length ?? 0} findings).`,
      });
    },
    runAudit: async (api: any) => {
      const startedAt = Date.now();
      const initialLog: ReviewProgressEvent = {
        cwd: runtimeCwd,
        stage: "assembling_context",
        message: `Starting Codebase Audit (${state.depth} mode via ${state.modelSelection.model})...`,
        timestamp: new Date().toISOString(),
      };

      updateAuditState(cwd, {
        status: "running",
        errorMessage: null,
        latestProgress: initialLog,
        progressLogs: [initialLog],
        startedAt,
      });

      try {
        const result: AuditScanResult = await api.git.generateReview({
          cwd: runtimeCwd,
          target: {
            kind: state.scopeKind === "changed_files_only" ? "working_tree" : "full_codebase",
          },
          modelSelection: state.modelSelection,
        });

        const newRecord: AuditHistoryRecord = {
          id: `record-${Date.now()}`,
          timestamp: new Date().toISOString(),
          mode: state.activeMode,
          depth: state.depth,
          scopeKind: state.scopeKind,
          modelUsed: state.modelSelection.model,
          result,
        };

        updateAuditState(cwd, (prev) => ({
          ...prev,
          status: "done",
          scanResult: result,
          historyRecords: [newRecord, ...prev.historyRecords.slice(0, 19)],
          latestProgress: null,
        }));

        toastManager.add({
          type: "success",
          title: "Codebase Audit Complete",
          description: `Discovered ${result.findings?.length ?? 0} verified findings across repository files.`,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        updateAuditState(cwd, {
          status: "error",
          errorMessage: errorMsg,
          latestProgress: null,
        });
        toastManager.add({
          type: "error",
          title: "Audit Execution Failed",
          description: errorMsg,
        });
      }
    },
  };
}
