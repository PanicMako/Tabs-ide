export interface ThreadHoverCardInput {
  readonly statusLabel?: string | null | undefined;
  readonly branch?: string | null | undefined;
  readonly updatedAt: string;
  readonly pinned?: boolean | undefined;
  readonly snoozed?: boolean | undefined;
}

export interface ThreadHoverCardRow {
  readonly label: string;
  readonly value: string;
}

/** The facts worth a glance before opening a thread, in the order they are shown. */
export function threadHoverCardRows(
  input: ThreadHoverCardInput,
  formatTime: (iso: string) => string = (iso) => new Date(iso).toLocaleString(),
): ReadonlyArray<ThreadHoverCardRow> {
  const rows: ThreadHoverCardRow[] = [];
  if (input.statusLabel) rows.push({ label: "Status", value: input.statusLabel });
  else if (input.snoozed) rows.push({ label: "Status", value: "Snoozed" });
  else if (input.pinned) rows.push({ label: "Status", value: "Pinned" });
  const branch = input.branch?.trim();
  if (branch) rows.push({ label: "Branch", value: branch });
  const updated = Date.parse(input.updatedAt);
  if (Number.isFinite(updated))
    rows.push({ label: "Last activity", value: formatTime(input.updatedAt) });
  return rows;
}
