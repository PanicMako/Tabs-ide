import type { RuntimeAction } from "./runtimeResponse.ts";

/**
 * One line telling the agent whether an action's effect was confirmed. A write that the runtime
 * read back is verified; everything else is unverified, and an accessibility call that left the
 * tree untouched is flagged as a probable no-op. An unverified action must never be reported as
 * success.
 */
export function describeVerification(action: RuntimeAction, treeUnchanged: boolean): string {
  if (action.verification) {
    return `${action.verification.state}: ${action.verification.detail}`;
  }
  if (treeUnchanged) {
    return action.path === "accessibility"
      ? "unverified (suspected no-op): the call succeeded but the window tree did not change. Web and Electron controls often ignore it; do not repeat the same click, try another element, key or action."
      : "unverified (no visible change): the input was sent but the window tree did not change. It may be asynchronous; use computer_wait or take a snapshot.";
  }
  return action.path === "accessibility"
    ? "unverified (action unasserted): the tree changed, but nothing confirms it was this action's effect."
    : "unverified (synthetic input): the tree changed, but synthetic input cannot be confirmed.";
}
