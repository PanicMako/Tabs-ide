import type { GitResolvedPullRequest, GitStatusResult } from "@tabs/contracts";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  GitForkIcon,
  GitPullRequestIcon,
  XCircleIcon,
} from "lucide-react";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { toastManager } from "../ui/toast";
import { summarizePullRequestChecks } from "../git/PullRequestChecksSummary";

export function effectiveChecksState(
  pr: GitResolvedPullRequest,
): "passing" | "failing" | "pending" | "unknown" | null {
  if (pr.checksState) return pr.checksState;
  if (!pr.checks || pr.checks.length === 0) return null;
  const summary = summarizePullRequestChecks(pr.checks);
  if (summary.state === "failure") return "failing";
  if (summary.state === "pending") return "pending";
  if (summary.state === "success") return "passing";
  return "unknown";
}

export function pullRequestReadiness(pr: GitResolvedPullRequest): string {
  if (pr.state !== "open") return pr.state === "merged" ? "Merged" : "Closed";
  if (pr.isDraft) return "Draft";
  if (pr.mergeability === "conflicting") return "Conflicts";

  const checks = effectiveChecksState(pr);
  if (checks === "failing") return "Checks failing";
  if (pr.reviewDecision === "changes_requested") return "Changes requested";
  if (checks === "pending") return "Checks running";
  if (pr.reviewDecision === "review_required") return "Review needed";

  // Ready requires passing checks, approved review, and mergeable status
  if (pr.mergeability === "mergeable" && checks === "passing" && pr.reviewDecision === "approved") {
    return "Ready";
  }

  return "Open";
}

export function WorkspacePullRequest({
  summary,
  details,
  pullRequests,
  unavailable,
  pending = false,
  readonly = false,
  environmentId,
}: {
  summary: NonNullable<GitStatusResult["pr"]>;
  details?: GitResolvedPullRequest | undefined;
  pullRequests?: ReadonlyArray<GitResolvedPullRequest> | undefined;
  unavailable?: boolean | undefined;
  pending?: boolean;
  readonly?: boolean;
  environmentId?: string | undefined;
}) {
  const prs = pullRequests && pullRequests.length > 0 ? pullRequests : details ? [details] : [];

  const handleOpenPr = (url: string) => {
    void environmentApi(environmentId)
      .then((api) => api.shell.openExternal(url))
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not open pull request",
          description: error instanceof Error ? error.message : String(error),
        });
      });
  };

  if (prs.length === 0) {
    return (
      <button
        type="button"
        disabled={readonly}
        aria-label={`Open pull request #${summary.number}`}
        onClick={() => handleOpenPr(summary.url)}
        className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-75"
      >
        <GitPullRequestIcon
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs leading-relaxed">{summary.title}</span>
          <span className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
            <span>#{summary.number}</span>
            <span className="capitalize">
              {pending ? "Loading" : unavailable ? "Status unavailable" : summary.state}
            </span>
          </span>
          {unavailable && (
            <span className="mt-1 block text-[10px] text-muted-foreground">
              Live checks unavailable
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-1" role="group" aria-label="Pull requests">
      {prs.map((pr) => {
        const readiness = unavailable ? "Status unavailable" : pullRequestReadiness(pr);
        const checks = unavailable ? null : effectiveChecksState(pr);
        const isFork = Boolean(
          pr.headRepositoryNameWithOwner &&
          !pr.url.toLowerCase().includes(`/${pr.headRepositoryNameWithOwner.toLowerCase()}/`),
        );

        return (
          <button
            key={pr.number}
            type="button"
            disabled={readonly}
            aria-label={`Open pull request #${pr.number}`}
            onClick={() => handleOpenPr(pr.url || summary.url)}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-75"
          >
            <GitPullRequestIcon
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs leading-relaxed">{pr.title}</span>
              <span className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span>#{pr.number}</span>
                  {isFork && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/80">
                      <GitForkIcon className="size-2.5" />
                      <span className="max-w-28 truncate">{pr.headRepositoryNameWithOwner}</span>
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  {checks === "passing" && (
                    <CheckCircle2Icon
                      className="size-3 text-emerald-500"
                      aria-label="Checks passed"
                    />
                  )}
                  {checks === "pending" && (
                    <ClockIcon
                      className="size-3 text-amber-500 animate-pulse"
                      aria-label="Checks running"
                    />
                  )}
                  {checks === "failing" && (
                    <XCircleIcon className="size-3 text-rose-500" aria-label="Checks failed" />
                  )}
                  {pr.mergeability === "conflicting" && (
                    <AlertTriangleIcon className="size-3 text-rose-500" aria-label="Conflicts" />
                  )}
                  <span className="capitalize font-medium">{readiness}</span>
                </span>
              </span>
              {unavailable && (
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  Live checks unavailable
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
