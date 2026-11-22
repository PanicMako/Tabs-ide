// Pure helpers for the Session Search panel: snippet highlighting, labels, and the shell
// command used to continue a hit in a terminal.
import {
  SESSION_SEARCH_MARK_END,
  SESSION_SEARCH_MARK_START,
  type SessionSearchAgent,
  type SessionSearchResumeResult,
} from "@tabs/contracts";

import { quoteShellArg } from "../../agentCli";

export interface SnippetSegment {
  readonly text: string;
  readonly match: boolean;
}

/** Splits a server snippet into plain and matched runs (markers are private-use characters). */
export function splitHighlight(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let match = false;
  let buffer = "";
  const flush = () => {
    if (buffer.length > 0) segments.push({ text: buffer, match });
    buffer = "";
  };
  for (const char of snippet) {
    if (char === SESSION_SEARCH_MARK_START) {
      flush();
      match = true;
    } else if (char === SESSION_SEARCH_MARK_END) {
      flush();
      match = false;
    } else {
      buffer += char;
    }
  }
  flush();
  return segments;
}

export const SESSION_SEARCH_AGENT_LABELS: Readonly<Record<SessionSearchAgent, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};

/** Last path segment, for a compact project label. */
export function projectLabel(cwd: string | null): string {
  if (!cwd) return "";
  const parts = cwd.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.at(-1) ?? cwd;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(timestamp: number, now: number): string {
  const age = Math.max(0, now - timestamp);
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < 30 * DAY) return `${Math.floor(age / DAY)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: age > 330 * DAY ? "numeric" : undefined,
  });
}

/** `cd <cwd> && <resume command>`, or the bare command when the session has no directory. */
export function terminalResumeCommand(resume: SessionSearchResumeResult): string | null {
  if (!resume.command) return null;
  return resume.cwd ? `cd ${quoteShellArg(resume.cwd)} && ${resume.command}` : resume.command;
}

/** Wraps an arrow-key move through `count` rows; returns -1 when there are none. */
export function moveSelection(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

export function toggleAgent(
  selected: ReadonlyArray<SessionSearchAgent>,
  agent: SessionSearchAgent,
): SessionSearchAgent[] {
  return selected.includes(agent) ? selected.filter((a) => a !== agent) : [...selected, agent];
}

/** Splits transcript text into plain and matched runs for the given lowercase terms (prefix match). */
export function highlightTerms(text: string, terms: ReadonlyArray<string>): SnippetSegment[] {
  const usable = terms.filter((term) => term.length > 0);
  if (usable.length === 0 || text.length === 0) return [{ text, match: false }];
  const escaped = usable
    .toSorted((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "giu");
  const segments: SnippetSegment[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const at = found.index ?? 0;
    if (at > last) segments.push({ text: text.slice(last, at), match: false });
    segments.push({ text: found[0], match: true });
    last = at + found[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}

export const SESSION_SEARCH_SOURCE_HINT =
  "Claude Code, Codex, Gemini and OpenCode keep transcripts in your home folder.";

/** Indexing progress as 0..1, or null when the total is unknown. */
export function indexingProgress(status: {
  sessions: number;
  pending: number;
  state: string;
}): number | null {
  if (status.state !== "indexing") return null;
  const total = status.sessions + status.pending;
  return total === 0 ? null : status.sessions / total;
}
