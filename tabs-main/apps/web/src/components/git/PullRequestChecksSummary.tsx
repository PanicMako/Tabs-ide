import { useMemo, useState } from "react";
import type { GitPullRequestCheck } from "@tabs/contracts";
import { CheckCircle2, XCircle, Clock, MinusCircle, HelpCircle, ExternalLink } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export interface PullRequestChecksSummaryStats {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
  readonly skipped: number;
  readonly state: "success" | "failure" | "pending" | "none";
}

export function summarizePullRequestChecks(
  checks: ReadonlyArray<GitPullRequestCheck>,
): PullRequestChecksSummaryStats {
  if (checks.length === 0) {
    return { total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, state: "none" };
  }

  let passed = 0;
  let failed = 0;
  let pending = 0;
  let skipped = 0;

  for (const check of checks) {
    const conclusion = check.conclusion?.toLowerCase();
    const status = check.status.toLowerCase();

    if (
      status === "queued" ||
      status === "in_progress" ||
      conclusion === "in_progress" ||
      conclusion === "queued"
    ) {
      pending++;
    } else if (
      conclusion === "failure" ||
      conclusion === "timed_out" ||
      conclusion === "action_required" ||
      conclusion === "cancelled"
    ) {
      failed++;
    } else if (conclusion === "success" || conclusion === "neutral") {
      passed++;
    } else if (conclusion === "skipped") {
      skipped++;
    } else {
      // Fallback on status
      if (status === "completed") {
        passed++;
      } else {
        pending++;
      }
    }
  }

  let state: PullRequestChecksSummaryStats["state"] = "none";
  if (failed > 0) {
    state = "failure";
  } else if (pending > 0) {
    state = "pending";
  } else if (passed > 0) {
    state = "success";
  }

  return {
    total: checks.length,
    passed,
    failed,
    pending,
    skipped,
    state,
  };
}

export function PullRequestCheckStatusIcon({
  check,
  className = "size-4",
}: {
  check: GitPullRequestCheck;
  className?: string;
}) {
  const conclusion = check.conclusion?.toLowerCase();
  const status = check.status.toLowerCase();

  if (status === "queued" || status === "in_progress" || conclusion === "in_progress") {
    return (
      <Clock
        className={`${className} text-amber-500 animate-pulse shrink-0`}
        aria-label="In progress"
      />
    );
  }
  if (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "action_required" ||
    conclusion === "cancelled"
  ) {
    return <XCircle className={`${className} text-red-500 shrink-0`} aria-label="Failed" />;
  }
  if (conclusion === "success" || conclusion === "neutral") {
    return (
      <CheckCircle2 className={`${className} text-emerald-500 shrink-0`} aria-label="Passed" />
    );
  }
  if (conclusion === "skipped") {
    return (
      <MinusCircle className={`${className} text-muted-foreground shrink-0`} aria-label="Skipped" />
    );
  }
  return (
    <HelpCircle className={`${className} text-muted-foreground shrink-0`} aria-label="Unknown" />
  );
}

export function PullRequestChecksRollupBadge({
  checks,
  onClick,
}: {
  checks: ReadonlyArray<GitPullRequestCheck>;
  onClick?: () => void;
}) {
  const summary = useMemo(() => summarizePullRequestChecks(checks), [checks]);

  if (summary.total === 0) return null;

  let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
  let label = "";
  let icon = null;

  if (summary.state === "failure") {
    badgeVariant = "destructive";
    label = `${summary.failed} failing`;
    icon = <XCircle className="size-3 shrink-0" />;
  } else if (summary.state === "pending") {
    label = `${summary.pending} pending`;
    icon = <Clock className="size-3 text-amber-500 shrink-0" />;
  } else if (summary.state === "success") {
    label = `${summary.passed}/${summary.total} passed`;
    icon = <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />;
  }

  return (
    <Badge
      variant={badgeVariant}
      className={`inline-flex items-center gap-1 text-xs cursor-pointer transition-colors ${
        onClick ? "hover:opacity-80" : ""
      }`}
      onClick={onClick}
      aria-label={`Checks: ${label}`}
    >
      {icon}
      <span>{label}</span>
    </Badge>
  );
}

export function PullRequestChecksView({ checks }: { checks: ReadonlyArray<GitPullRequestCheck> }) {
  const [filter, setFilter] = useState<"all" | "failed" | "pending" | "passed">("all");
  const summary = useMemo(() => summarizePullRequestChecks(checks), [checks]);

  const filteredChecks = useMemo(() => {
    if (filter === "all") return checks;
    return checks.filter((check) => {
      const conclusion = check.conclusion?.toLowerCase();
      const status = check.status.toLowerCase();
      if (filter === "failed") {
        return (
          conclusion === "failure" ||
          conclusion === "timed_out" ||
          conclusion === "action_required" ||
          conclusion === "cancelled"
        );
      }
      if (filter === "pending") {
        return (
          status === "queued" ||
          status === "in_progress" ||
          conclusion === "in_progress" ||
          conclusion === "queued"
        );
      }
      if (filter === "passed") {
        return (
          conclusion === "success" ||
          conclusion === "neutral" ||
          (status === "completed" && !conclusion)
        );
      }
      return true;
    });
  }, [checks, filter]);

  if (checks.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No checks reported for this pull request.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          {summary.state === "failure" ? (
            <XCircle className="size-5 text-red-500" />
          ) : summary.state === "pending" ? (
            <Clock className="size-5 text-amber-500 animate-pulse" />
          ) : (
            <CheckCircle2 className="size-5 text-emerald-500" />
          )}
          <div>
            <div className="text-sm font-medium text-foreground">
              {summary.state === "failure"
                ? `${summary.failed} of ${summary.total} checks failed`
                : summary.state === "pending"
                  ? `${summary.pending} of ${summary.total} checks pending`
                  : `All ${summary.total} checks passed`}
            </div>
            <div className="text-xs text-muted-foreground">
              {summary.passed} successful, {summary.failed} failed, {summary.pending} in progress
            </div>
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={filter === "all" ? "secondary" : "ghost"}
            className="h-7 text-xs px-2"
            onClick={() => setFilter("all")}
          >
            All ({summary.total})
          </Button>
          {summary.failed > 0 ? (
            <Button
              size="sm"
              variant={filter === "failed" ? "secondary" : "ghost"}
              className="h-7 text-xs px-2 text-red-600 dark:text-red-400"
              onClick={() => setFilter("failed")}
            >
              Failed ({summary.failed})
            </Button>
          ) : null}
          {summary.pending > 0 ? (
            <Button
              size="sm"
              variant={filter === "pending" ? "secondary" : "ghost"}
              className="h-7 text-xs px-2 text-amber-600 dark:text-amber-400"
              onClick={() => setFilter("pending")}
            >
              Pending ({summary.pending})
            </Button>
          ) : null}
          {summary.passed > 0 ? (
            <Button
              size="sm"
              variant={filter === "passed" ? "secondary" : "ghost"}
              className="h-7 text-xs px-2 text-emerald-600 dark:text-emerald-400"
              onClick={() => setFilter("passed")}
            >
              Passed ({summary.passed})
            </Button>
          ) : null}
        </div>
      </div>

      {/* Checks List */}
      <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-card overflow-hidden">
        {filteredChecks.map((check, index) => (
          <div
            key={`${index}:${check.workflowName ?? ""}:${check.name}`}
            className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <PullRequestCheckStatusIcon check={check} />
              <div className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">
                  {check.workflowName ? `${check.workflowName} / ` : ""}
                  {check.name}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-[11px] capitalize">
                {check.conclusion ?? check.status.replaceAll("_", " ")}
              </Badge>
              {check.detailsUrl ? (
                <a
                  href={check.detailsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-foreground hover:underline"
                  title="View details on source forge"
                >
                  <span>Details</span>
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
