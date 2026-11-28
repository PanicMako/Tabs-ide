import type { BrowserSubmissionGuards } from "./browserWorkflowHostId";

const SUBMISSION_BREAKPOINT_MESSAGE =
  "This draft has a submission breakpoint. Use preview_workflow to check it or perform the guarded action.";

/** Generic input stays out of a draft whose journal owns the Submit action, at any alias of it. */
export function checkSubmissionGuard(
  guards: BrowserSubmissionGuards,
  partition: string,
  url: string,
): void {
  if (guards.has(partition, url)) throw new Error(SUBMISSION_BREAKPOINT_MESSAGE);
}

/** The same draft can be reached by another address; its visible ID still names it. */
export async function checkSubmissionIdentity(
  guards: BrowserSubmissionGuards,
  partition: string,
  contents: Electron.WebContents,
): Promise<void> {
  for (const { selector, resourceId } of guards.identitiesFor(partition, contents.getURL())) {
    let matches: unknown;
    try {
      matches = await contents.executeJavaScriptInIsolatedWorld(999, [
        {
          code: `(() => {
              const nodes = document.querySelectorAll(${JSON.stringify(selector)});
              const node = nodes[0];
              return nodes.length === 1 && node instanceof HTMLElement &&
                node.getClientRects().length > 0 && node.innerText.trim() === ${JSON.stringify(resourceId)};
            })()`,
        },
      ]);
    } catch {
      continue;
    }
    if (matches === true) throw new Error(SUBMISSION_BREAKPOINT_MESSAGE);
  }
}
