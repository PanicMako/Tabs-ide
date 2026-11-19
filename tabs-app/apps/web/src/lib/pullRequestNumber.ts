import { resolveThreadCurrentPullRequestLink } from "@tabs/shared/threadPullRequests";
import type { ThreadLinkedPullRequest, ThreadPullRequestLink } from "@tabs/contracts";

/** The number of the pull request a thread is working on, or null when it has none. */
export function currentPullRequestNumber(thread: {
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly linkedPullRequest?: Pick<ThreadLinkedPullRequest, "number"> | null | undefined;
}): number | null {
  const link = resolveThreadCurrentPullRequestLink(thread.pullRequests ?? []);
  return link?.number ?? thread.linkedPullRequest?.number ?? null;
}
