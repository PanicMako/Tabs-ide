import React from "react";
import type {
  AuditCategory,
  AuditFinding,
  AuditSeverity,
  FindingVerificationState,
} from "@tabs/contracts";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { CheckCircle2, ShieldCheck, FilterX } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";

export interface FindingsTableProps {
  readonly findings: ReadonlyArray<AuditFinding>;
  readonly selectedFindingId: string | null;
  readonly filterSeverity: AuditSeverity | "all";
  readonly filterCategory: AuditCategory | "all";
  readonly filterVerification: FindingVerificationState | "all";
  readonly searchQuery: string;
  readonly onSelectFinding: (id: string) => void;
  readonly onFilterSeverityChange: (sev: AuditSeverity | "all") => void;
  readonly onFilterCategoryChange: (cat: AuditCategory | "all") => void;
  readonly onFilterVerificationChange: (ver: FindingVerificationState | "all") => void;
  readonly onSearchQueryChange: (q: string) => void;
  readonly onOpenPatchModal: (finding: AuditFinding) => void;
  readonly onOpenAskAIDrawer: (id: string) => void;
}

export function FindingsTableView({
  findings,
  selectedFindingId,
  filterSeverity,
  filterCategory,
  filterVerification,
  searchQuery,
  onSelectFinding,
  onFilterSeverityChange,
  onFilterCategoryChange,
  onFilterVerificationChange,
  onSearchQueryChange,
  onOpenPatchModal,
  onOpenAskAIDrawer,
}: FindingsTableProps) {
  const filtered = findings.filter((f) => {
    if (filterSeverity !== "all" && f.severity !== filterSeverity) return false;
    if (filterCategory !== "all" && f.category !== filterCategory) return false;
    if (filterVerification !== "all" && f.verificationState !== filterVerification) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = `${f.title} ${f.filePath} ${f.explanation} ${f.sourceTool}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    return true;
  });

  const hasActiveFilters =
    filterSeverity !== "all" ||
    filterCategory !== "all" ||
    filterVerification !== "all" ||
    searchQuery.trim() !== "";

  const handleResetFilters = () => {
    onFilterSeverityChange("all");
    onFilterCategoryChange("all");
    onFilterVerificationChange("all");
    onSearchQueryChange("");
  };

  return (
    <div className="space-y-4 text-foreground font-sans">
      {/* Custom Dropdowns & Search Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3 border border-border rounded-xl">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search findings, files, rules..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-64 text-xs bg-background border-border text-foreground font-sans"
          />

          {/* Custom App Select Dropdown: Severity */}
          <Select
            value={filterSeverity}
            onValueChange={(val) => onFilterSeverityChange(val as any)}
          >
            <SelectTrigger className="w-36 text-xs font-sans bg-background border-border">
              <SelectValue placeholder="All Severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom App Select Dropdown: Category */}
          <Select
            value={filterCategory}
            onValueChange={(val) => onFilterCategoryChange(val as any)}
          >
            <SelectTrigger className="w-40 text-xs font-sans bg-background border-border">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="correctness">Correctness</SelectItem>
              <SelectItem value="security">Security</SelectItem>
              <SelectItem value="performance">Performance</SelectItem>
              <SelectItem value="architecture">Architecture</SelectItem>
              <SelectItem value="test_gap">Test Gap</SelectItem>
              <SelectItem value="dependency_secret">Dependency/Secret</SelectItem>
              <SelectItem value="refactoring">Refactoring</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom App Select Dropdown: Verification */}
          <Select
            value={filterVerification}
            onValueChange={(val) => onFilterVerificationChange(val as any)}
          >
            <SelectTrigger className="w-44 text-xs font-sans bg-background border-border">
              <SelectValue placeholder="All Verification States" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Verification States</SelectItem>
              <SelectItem value="verified_passed">Verified Passed</SelectItem>
              <SelectItem value="verified_disproven">Disproven</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <span className="text-xs text-muted-foreground font-mono">
          Found {filtered.length} issue{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Zero Findings (Clean Audit Passed) vs Active Filter Empty State */}
      {findings.length === 0 ? (
        <div
          className="p-10 text-center border border-border rounded-xl space-y-4 shadow-sm"
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/30 mx-auto text-emerald-500">
            <CheckCircle2 size={30} />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-lg font-bold text-foreground tracking-tight font-sans">
              Clean Audit Passed
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              No security vulnerabilities, correctness bugs, or performance issues were detected in
              this codebase scan scope.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-[11px] font-mono text-muted-foreground">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted border border-border">
              <ShieldCheck size={12} className="text-emerald-500" />
              AST Symbol Graph Verified
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted border border-border">
              Disproof Agent Verified
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted border border-border">
              0 False Positives
            </span>
          </div>
        </div>
      ) : filtered.length === 0 && hasActiveFilters ? (
        <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground text-xs space-y-3">
          <p>No findings match your active filter criteria.</p>
          <button
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-muted text-foreground hover:bg-accent border border-border transition-colors cursor-pointer"
          >
            <FilterX size={13} />
            <span>Reset Filters</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((finding) => {
            const isSelected = selectedFindingId === finding.id;
            let sevBadgeClass = "bg-muted text-muted-foreground border-border";
            if (finding.severity === "critical")
              sevBadgeClass = "bg-red-500/10 text-red-500 border-red-500/30";
            else if (finding.severity === "error")
              sevBadgeClass = "bg-orange-500/10 text-orange-500 border-orange-500/30";
            else if (finding.severity === "warning")
              sevBadgeClass = "bg-amber-500/10 text-amber-500 border-amber-500/30";
            else if (finding.severity === "info")
              sevBadgeClass = "bg-blue-500/10 text-blue-500 border-blue-500/30";

            return (
              <div
                key={finding.id}
                onClick={() => onSelectFinding(finding.id)}
                className={`p-5 rounded-xl border transition-all cursor-pointer space-y-3 ${
                  isSelected
                    ? "bg-primary/5 border-primary shadow-sm"
                    : "border-border hover:border-border/80 hover:bg-muted/30"
                }`}
                style={{ backgroundColor: isSelected ? undefined : "var(--bg-surface)" }}
              >
                {/* Finding Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 ${sevBadgeClass}`}
                    >
                      {finding.severity}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-muted text-muted-foreground border border-border"
                    >
                      {finding.category}
                    </Badge>
                    <h3 className="text-sm font-semibold text-foreground">{finding.title}</h3>
                  </div>

                  <span
                    className={`inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded border ${
                      finding.verificationState === "verified_passed"
                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                        : finding.verificationState === "verified_disproven"
                          ? "bg-muted text-muted-foreground border-border line-through"
                          : "bg-amber-500/10 text-amber-500 border-amber-500/30"
                    }`}
                  >
                    {finding.verificationState}
                  </span>
                </div>

                {/* File Location */}
                <div className="text-xs font-mono text-muted-foreground">
                  {finding.filePath}:{finding.startLine}-{finding.endLine} • {finding.sourceTool}
                </div>

                {/* Explanation */}
                <p className="text-xs text-foreground/90 leading-relaxed font-sans">
                  {finding.explanation}
                </p>

                {/* Code Evidence Snippet */}
                {finding.evidenceSnippet && (
                  <pre className="font-mono text-xs p-3.5 rounded-lg bg-muted/50 border border-border text-foreground overflow-x-auto">
                    <code>{finding.evidenceSnippet}</code>
                  </pre>
                )}

                {/* Card Action Bar */}
                <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
                  <span className="text-muted-foreground text-[11px] font-mono">
                    Confidence: {(finding.confidence * 100).toFixed(0)}%
                  </span>
                  <div className="flex items-center gap-3">
                    {finding.suggestedFix && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenPatchModal(finding);
                        }}
                        className="text-xs font-semibold text-foreground hover:underline cursor-pointer"
                      >
                        Preview Patch
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenAskAIDrawer(finding.id);
                      }}
                      className="text-xs font-semibold text-purple-500 hover:underline cursor-pointer"
                    >
                      Ask AI
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
