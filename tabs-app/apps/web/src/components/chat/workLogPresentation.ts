import type { WorkLogEntry } from "../../session-logic";

export type WorkStepKind =
  | "command"
  | "edit"
  | "read"
  | "search"
  | "tool"
  | "agent"
  | "thinking"
  | "error"
  | "info";

type StepSource = Pick<
  WorkLogEntry,
  "tone" | "itemType" | "requestKind" | "command" | "changedFiles"
>;

export function workStepKind(entry: StepSource): WorkStepKind {
  if (entry.tone === "error") return "error";
  if (entry.requestKind === "command") return "command";
  if (entry.requestKind === "file-read") return "read";
  if (entry.requestKind === "file-change") return "edit";
  if (entry.itemType === "command_execution" || entry.command) return "command";
  if (entry.itemType === "file_change" || (entry.changedFiles?.length ?? 0) > 0) return "edit";
  if (entry.itemType === "web_search") return "search";
  if (entry.itemType === "image_view") return "read";
  if (entry.itemType === "collab_agent_tool_call") return "agent";
  if (entry.itemType === "mcp_tool_call" || entry.itemType === "dynamic_tool_call") return "tool";
  if (entry.tone === "thinking") return "thinking";
  if (entry.tone === "tool") return "tool";
  return "info";
}

const SUMMARY_PHRASES: Partial<Record<WorkStepKind, readonly [string, string, string]>> = {
  command: ["Ran", "command", "commands"],
  edit: ["Edited", "file", "files"],
  read: ["Read", "file", "files"],
  search: ["Searched", "time", "times"],
  tool: ["Used", "tool", "tools"],
  agent: ["Delegated to", "agent", "agents"],
};

const SUMMARY_ORDER: readonly WorkStepKind[] = [
  "edit",
  "command",
  "read",
  "search",
  "tool",
  "agent",
];

/** A plain-language line such as "Edited 3 files · Ran 2 commands", most consequential first. */
export function summarizeWorkSteps(entries: ReadonlyArray<StepSource>): string {
  const counts = new Map<WorkStepKind, number>();
  let failures = 0;
  for (const entry of entries) {
    const kind = workStepKind(entry);
    if (kind === "error") {
      failures += 1;
      continue;
    }
    // An edit counts the files it touched; every other step counts once.
    const weight = kind === "edit" ? Math.max(1, entry.changedFiles?.length ?? 1) : 1;
    counts.set(kind, (counts.get(kind) ?? 0) + weight);
  }
  const parts = SUMMARY_ORDER.flatMap((kind) => {
    const count = counts.get(kind);
    const phrase = SUMMARY_PHRASES[kind];
    if (!count || !phrase) return [];
    return [`${phrase[0]} ${count} ${count === 1 ? phrase[1] : phrase[2]}`];
  });
  if (failures > 0) parts.push(`${failures} failed`);
  if (parts.length === 0) return entries.length === 1 ? "1 step" : `${entries.length} steps`;
  return parts.join(" · ");
}

/** Splits a path into a dimmed directory and an emphasized file name. */
export function splitDisplayPath(path: string): {
  readonly directory: string;
  readonly name: string;
} {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index === -1
    ? { directory: "", name: normalized }
    : { directory: normalized.slice(0, index + 1), name: normalized.slice(index + 1) };
}
