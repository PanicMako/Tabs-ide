import type {
  GitResolvedPullRequest,
  GitStatusResult,
  ThreadPullRequestLink,
} from "@tabs/contracts";
import { useQueries } from "@tanstack/react-query";
import { gitResolvePullRequestQueryOptions } from "../../lib/gitReactQuery";
import { WorkspacePullRequest } from "./WorkspacePullRequest";

/** Resolve each linked PR on its owning machine; the branch lookup remains the fallback. */
export function WorkspacePullRequests({
  links,
  cwd,
  environmentId,
  summary,
  details,
  unavailable,
}: {
  links: ReadonlyArray<ThreadPullRequestLink>;
  cwd: string | null;
  environmentId?: string | undefined;
  summary?: NonNullable<GitStatusResult["pr"]> | undefined;
  details?: GitResolvedPullRequest | undefined;
  unavailable?: boolean | undefined;
}) {
  const visible = [
    ...new Map(
      links
        .filter((link) => link.source !== "stack-dismissed")
        .map((link) => [`${link.host}/${link.repository}/${link.number}`, link]),
    ).values(),
  ];
  const queries = useQueries({
    queries: visible.map((link) => ({
      ...gitResolvePullRequestQueryOptions({ cwd, reference: link.url, environmentId }),
      retry: false,
    })),
  });
  if (visible.length === 0) {
    return summary ? (
      <WorkspacePullRequest
        summary={summary}
        details={details}
        unavailable={unavailable}
        environmentId={environmentId}
      />
    ) : null;
  }
  return (
    <div role="group" aria-label="Linked pull requests" className="space-y-1">
      {summary && !visible.some((link) => link.url === summary.url) && (
        <WorkspacePullRequest
          summary={summary}
          details={details}
          unavailable={unavailable}
          environmentId={environmentId}
        />
      )}
      {visible.map((link, index) => {
        const query = queries[index]!;
        const pr = query.data?.pullRequest;
        const snapshot = link.snapshot;
        return (
          <WorkspacePullRequest
            key={`${link.host}/${link.repository}/${link.number}`}
            summary={{
              number: link.number,
              url: link.url,
              title: pr?.title ?? snapshot?.title ?? `Pull request #${link.number}`,
              baseBranch: pr?.baseBranch ?? snapshot?.baseBranch ?? "",
              headBranch: pr?.headBranch ?? snapshot?.headBranch ?? "",
              state: pr?.state ?? snapshot?.state ?? "open",
            }}
            details={pr}
            pending={query.isPending && query.fetchStatus !== "idle"}
            unavailable={query.isError || query.isPlaceholderData || !pr}
            environmentId={environmentId}
          />
        );
      })}
    </div>
  );
}
