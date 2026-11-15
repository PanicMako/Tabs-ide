import { CheckCheckIcon } from "lucide-react";

/**
 * Double tick on a sent prompt. It is only visible over a wallpaper (see wallpaper-labs.css);
 * everywhere else it stays hidden, so the regular chat looks exactly as before.
 */
export function UserReadReceipt({ seen }: { readonly seen: boolean }) {
  return (
    <span
      className="user-message-receipt"
      data-seen={seen ? "true" : "false"}
      role="img"
      aria-label={seen ? "Seen by the agent" : "Sent"}
    >
      <CheckCheckIcon className="size-3.5" aria-hidden="true" />
    </span>
  );
}

/** A prompt counts as seen once anything from the agent follows it in the timeline. */
export function seenUserMessageIds(
  rows: ReadonlyArray<{
    readonly kind: string;
    readonly id: string;
    readonly message?: { readonly id: string; readonly role: string };
  }>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  let agentActivityAfter = false;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === "message" && row.message?.role === "user") {
      if (agentActivityAfter) seen.add(row.message.id);
    } else if (row.kind !== "message" || row.message?.role === "assistant") {
      agentActivityAfter = true;
    }
  }
  return seen;
}
