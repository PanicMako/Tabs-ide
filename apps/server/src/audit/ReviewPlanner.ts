/**
 * ReviewPlanner — Stage 1 of the Multi-Pass Audit Engine.
 *
 * Inspects repository inventory, scan scope, and static analysis outputs to create
 * a bounded, context-aware execution plan for downstream review passes.
 *
 * @module audit/ReviewPlanner
 */

import type {
  AuditCategory,
  AuditScanDepth,
  AuditScanInput,
  RepoFileInventory,
} from "@tabs/contracts";
import type { StaticAnalyzerRegistryResult } from "./StaticAnalyzerRegistry.ts";

export interface ExecutionPlan {
  readonly auditId: string;
  readonly targetFiles: ReadonlyArray<string>;
  readonly passesToRun: ReadonlyArray<AuditCategory>;
  readonly budgetCharsPerFile: number;
  readonly concurrencyLimit: number;
  readonly staticFindingCount: number;
  readonly isIncremental: boolean;
}

export function resolvePassesForDepth(
  depth: AuditScanDepth,
  enabledCategories?: ReadonlyArray<AuditCategory> | undefined,
): ReadonlyArray<AuditCategory> {
  let passes: AuditCategory[];

  if (depth === "quick") {
    // Quick depth relies primarily on static analyzers + basic correctness check
    passes = ["correctness", "security"];
  } else if (depth === "standard") {
    passes = ["correctness", "security", "performance", "architecture"];
  } else {
    // Deep scan includes all audit categories
    passes = [
      "correctness",
      "security",
      "performance",
      "architecture",
      "test_gap",
      "dependency_secret",
      "refactoring",
    ];
  }

  if (enabledCategories && enabledCategories.length > 0) {
    return passes.filter((p) => enabledCategories.includes(p));
  }

  return passes;
}

/**
 * Filter files based on scan scope (e.g. folder, selected files, changed files).
 */
export function filterFilesForScope(
  inventory: RepoFileInventory,
  input: AuditScanInput,
): ReadonlyArray<string> {
  const scope = input.scope;

  if (scope.kind === "selected_files" || scope.kind === "changed_files_only") {
    if (scope.targetPaths && scope.targetPaths.length > 0) {
      const normTargets = new Set(
        scope.targetPaths.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "")),
      );
      return inventory.files.map((f) => f.filePath).filter((fp) => normTargets.has(fp));
    }
  }

  if (scope.kind === "folder" || scope.kind === "workspace_package") {
    if (scope.targetPaths && scope.targetPaths.length > 0) {
      const prefixes = scope.targetPaths.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""));
      return inventory.files
        .map((f) => f.filePath)
        .filter((fp) => prefixes.some((prefix) => fp.startsWith(prefix)));
    }
  }

  // Default / full_repository: return all inventory source files
  return inventory.files.map((f) => f.filePath);
}

/**
 * Build execution plan for an audit scan.
 */
export function createExecutionPlan(
  input: AuditScanInput,
  inventory: RepoFileInventory,
  staticResult: StaticAnalyzerRegistryResult,
): ExecutionPlan {
  const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const targetFiles = filterFilesForScope(inventory, input);
  const passesToRun = resolvePassesForDepth(input.depth, input.enabledCategories);

  // Budget allocations based on depth
  const budgetCharsPerFile = input.depth === "deep" ? 32_000 : 16_000;
  const concurrencyLimit = input.depth === "quick" ? 8 : 4;

  return {
    auditId,
    targetFiles,
    passesToRun,
    budgetCharsPerFile,
    concurrencyLimit,
    staticFindingCount: staticResult.findings.length,
    isIncremental: input.scope.kind === "changed_files_only" || input.scope.kind === "pull_request",
  };
}
