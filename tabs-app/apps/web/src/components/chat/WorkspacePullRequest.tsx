import type { GitResolvedPullRequest, GitStatusResult } from "@tabs/contracts";
import { GitPullRequestIcon } from "lucide-react";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { toastManager } from "../ui/toast";

export function pullRequestReadiness(pr: GitResolvedPullRequest): string {
  if (pr.state !== "open") return pr.state === "merged" ? "Merged" : "Closed";
  if (pr.isDraft) return "Draft";
  if (pr.mergeability === "conflicting") return "Conflicts";
  if (pr.checksState === "failing") return "Checks failing";
  if (pr.reviewDecision === "changes_requested") return "Changes requested";
  if (pr.checksState === "pending") return "Checks running";
  if (pr.reviewDecision === "review_required") return "Review needed";
  if (
    pr.mergeability === "mergeable" &&
    pr.checksState === "passing" &&
    pr.reviewDecision === "approved"
  )
    return "Ready";
  return "Open";
}

export function WorkspacePullRequest({
  summary,
  details,
  unavailable,
  environmentId,
}: {
  summary: NonNullable<GitStatusResult["pr"]>;
  details?: GitResolvedPullRequest | undefined;
  unavailable?: boolean;
  environmentId?: string | undefined;
}) {
  const pr = details;
  return (
    <button
      type="button"
      aria-label={`Open pull request #${summary.number}`}
      onClick={() => {
        void environmentApi(environmentId)
          .then((api) => api.shell.openExternal(summary.url))
          .catch((error) => {
            toastManager.add({
              type: "error",
              title: "Could not open pull request",
              description: String(error),
            });
          });
      }}
      className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted/60"
    >
      <GitPullRequestIcon
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs leading-relaxed">{pr?.title ?? summary.title}</span>
        <span className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
          <span>#{summary.number}</span>
          <span className="capitalize">{pr ? pullRequestReadiness(pr) : summary.state}</span>
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
