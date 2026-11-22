// Pure windowing for the preview pane: pick the messages around the first query match.
import type { SessionSearchPreviewResult } from "@tabs/contracts";

import { tokenizeQuery } from "./ranking.ts";

export interface PreviewSourceMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly ts: number | null;
}

const BEFORE = 3;
const AFTER = 5;
const MAX_PREVIEW_CHARS = 2_500;

function matches(text: string, terms: ReadonlyArray<string>): boolean {
  if (terms.length === 0) return false;
  const lower = text.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

export function buildPreview(
  messages: ReadonlyArray<PreviewSourceMessage>,
  query: string,
): SessionSearchPreviewResult {
  const terms = tokenizeQuery(query);
  let center = messages.findIndex((message) => matches(message.text, terms));
  // Prefix search can match words the substring check misses; fall back to any term.
  if (center === -1 && terms.length > 0) {
    center = messages.findIndex((message) =>
      terms.some((term) => message.text.toLowerCase().includes(term)),
    );
  }
  const anchor = center === -1 ? 0 : center;
  const start = Math.max(0, anchor - BEFORE);
  const end = Math.min(messages.length, anchor + AFTER + 1);
  return {
    messages: messages.slice(start, end).map((message) => ({
      role: message.role,
      text:
        message.text.length > MAX_PREVIEW_CHARS
          ? `${message.text.slice(0, MAX_PREVIEW_CHARS)}…`
          : message.text,
      timestamp: message.ts,
      matched: matches(message.text, terms),
    })),
    totalMessages: messages.length,
    hiddenBefore: start,
    hiddenAfter: messages.length - end,
    terms,
  };
}
