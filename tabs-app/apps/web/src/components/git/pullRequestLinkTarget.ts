import type { PullRequestRef } from "@tabs/contracts";
import { parseChangeRequestUrl } from "@tabs/shared/changeRequestUrl";

/**
 * The reference a hover card can ask the host about, for a link that names a pull request of the
 * very repository the page is showing. A link to anywhere else gets no card: the host only
 * answers for a project's own repository, and a doubtful match is worse than none.
 */
export function pullRequestLinkTarget(
  href: string,
  page: { readonly projectId: string | null; readonly repository: string; readonly host?: string },
): PullRequestRef | null {
  if (page.projectId === null || page.repository.length === 0) return null;
  const parsed = parseChangeRequestUrl(href);
  if (parsed === null) return null;
  if (parsed.repository.toLowerCase() !== page.repository.toLowerCase()) return null;
  if (page.host && parsed.host.toLowerCase() !== page.host.toLowerCase()) return null;
  return {
    projectId: page.projectId as PullRequestRef["projectId"],
    repository: page.repository,
    number: parsed.number,
    ...(page.host ? { host: page.host } : {}),
  };
}
