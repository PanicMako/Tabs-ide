import type { ResponseStreamingMode } from "@tabs/contracts";
import type { ProviderAdapterV2Event } from "./ProviderAdapter.ts";

// An opening fence may sit at any indentation, since fences inside list
// items are indented past the marker. A closing fence may be indented at most
// three spaces more than its opener. Deeper lines are content in the block.
const MARKDOWN_FENCE_PATTERN = /^( *)(`{3,}|~{3,})/;
// CommonMark blank lines hold only spaces and tabs. Other whitespace, such as
// a no-break space, is paragraph content.
const BLANK_LINE_PATTERN = /^[ \t]*$/;
// A bullet or ordered marker followed by whitespace, at any indentation so
// nested items count. The trailing space is required, so a partial `-` or
// `1.` never matches before the model finishes the marker.
const LIST_ITEM_START_PATTERN = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/;
// A section title: an ATX heading, or a line of only bold text, which models
// often use as a heading.
const SECTION_TITLE_PATTERN = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|\*\*(?:[^*]|\*(?!\*))+\*\*:?$)/;
// An unindented ATX heading ends the paragraph or list above it, even with no
// blank line between them. A bold line would continue the paragraph instead.
const TOP_LEVEL_HEADING_PATTERN = /^#{1,6}(?:[ \t]|$)/;

/**
 * Splits buffered assistant text at the last blank line, closing code fence,
 * or list item start that is not inside an open fenced code block. `ready` is
 * safe to deliver now because the markdown before it will not change shape as
 * more text arrives. `rest` stays buffered until the next boundary or
 * completion. Only fully terminated lines count, so a trailing partial line
 * never leaks; a list item start is the one lookahead that may sit on the
 * partial line, since tight lists have no blank lines between items and would
 * otherwise land all at once.
 *
 * A section title holds the boundary until a content line follows it, so a
 * title never lands alone and waits above a block that is still streaming.
 */
export function splitBufferedAssistantText(text: string): { ready: string; rest: string } {
  let openFence: { marker: string; indent: number } | null = null;
  let boundary = -1;
  let lineStart = 0;
  let titleAwaitingContent = false;
  for (;;) {
    const newline = text.indexOf("\n", lineStart);
    const line = text
      .slice(lineStart, newline === -1 ? text.length : newline)
      .replace(/[ \t\r]+$/, "");
    if (
      openFence === null &&
      lineStart > 0 &&
      !titleAwaitingContent &&
      LIST_ITEM_START_PATTERN.test(line)
    ) {
      boundary = lineStart;
    }
    if (newline === -1) {
      break;
    }
    const fenceMatch = MARKDOWN_FENCE_PATTERN.exec(line);
    if (fenceMatch) {
      const indent = fenceMatch[1]!.length;
      const marker = fenceMatch[2]!;
      if (openFence === null) {
        openFence = { marker, indent };
        titleAwaitingContent = false;
      } else if (
        marker[0] === openFence.marker[0] &&
        marker.length >= openFence.marker.length &&
        indent <= openFence.indent + 3 &&
        line.length === indent + marker.length
      ) {
        // CommonMark: a closing fence carries no info string.
        openFence = null;
        boundary = newline + 1;
      }
    } else if (openFence === null && BLANK_LINE_PATTERN.test(line) && lineStart > 0) {
      if (!titleAwaitingContent) {
        boundary = newline + 1;
      }
    } else if (openFence === null) {
      if (lineStart > 0 && !titleAwaitingContent && TOP_LEVEL_HEADING_PATTERN.test(line)) {
        boundary = lineStart;
      }
      titleAwaitingContent = SECTION_TITLE_PATTERN.test(line);
    }
    lineStart = newline + 1;
  }
  if (boundary === -1) {
    return { ready: "", rest: text };
  }
  return { ready: text.slice(0, boundary), rest: text.slice(boundary) };
}

/**
 * How long a held snapshot may sit before it is delivered whole. Long enough to ride out normal
 * gaps between chunks; short enough that text written before a long tool call or background wait
 * does not look lost.
 */
export const ASSISTANT_IDLE_FLUSH_MS = 1_200;

/**
 * Respect explicit buffering modes; token delivery exposes the first provider text immediately.
 * A snapshot held back is delivered whole by `takeIdleFlushes` once its message has been idle.
 */
export function makeAssistantStreamingFilter(
  mode: ResponseStreamingMode,
  idleFlushMs = ASSISTANT_IDLE_FLUSH_MS,
) {
  const delivered = new Map<string, { text: string; at: number }>();
  const held = new Map<string, { event: ProviderAdapterV2Event; dueAt: number }>();
  const filter = (event: ProviderAdapterV2Event, now: number): ProviderAdapterV2Event | null => {
    if (
      event.type === "node.updated" &&
      event.node.kind === "assistant_message" &&
      event.node.status === "running"
    )
      return null;
    const message = streamedMessage(event);
    if (!message) return event;
    const key = `${event.type}:${message.id}`;
    if (!message.streaming) {
      delivered.delete(key);
      held.delete(key);
      return event;
    }
    if (mode === "turn") return null;
    const previous = delivered.get(key);
    // Anything the provider wrote that has not been delivered waits here for its idle deadline.
    const hold = (): null => {
      if (message.text !== (previous?.text ?? "")) {
        held.set(key, { event, dueAt: now + idleFlushMs });
      }
      return null;
    };
    if (mode === "token") {
      if (!message.text || message.text === previous?.text) return null;
      // The first update is immediate; later cumulative updates are coalesced
      // without waiting for a paragraph boundary or the end of the turn.
      if (previous && now - previous.at < 50) return hold();
      delivered.set(key, { text: message.text, at: now });
      held.delete(key);
      return event;
    }
    if (previous && now - previous.at < 400) return hold();
    const { ready } = splitBufferedAssistantText(message.text);
    // An idle delivery may already show more than the next boundary; never shrink it.
    if (!ready || previous?.text.startsWith(ready)) return hold();
    delivered.set(key, { text: ready, at: now });
    if (ready !== message.text) held.set(key, { event, dueAt: now + idleFlushMs });
    else held.delete(key);
    return withText(event, ready);
  };
  return Object.assign(filter, {
    /** The earliest time a held snapshot comes due, or null when nothing is held. */
    nextIdleFlushAt: (): number | null => {
      let next: number | null = null;
      for (const { dueAt } of held.values()) if (next === null || dueAt < next) next = dueAt;
      return next;
    },
    /** Returns the held snapshots due by `now` and counts them as delivered. */
    takeIdleFlushes: (now: number): ReadonlyArray<ProviderAdapterV2Event> => {
      const due: ProviderAdapterV2Event[] = [];
      for (const [key, entry] of held) {
        if (entry.dueAt > now) continue;
        held.delete(key);
        due.push(entry.event);
        delivered.set(key, { text: streamedMessage(entry.event)?.text ?? "", at: now });
      }
      return due;
    },
  });
}

function streamedMessage(event: ProviderAdapterV2Event) {
  return event.type === "message.updated" && event.message.role === "assistant"
    ? event.message
    : event.type === "turn_item.updated" &&
        (event.turnItem.type === "assistant_message" || event.turnItem.type === "reasoning")
      ? event.turnItem
      : null;
}

function withText(event: ProviderAdapterV2Event, text: string): ProviderAdapterV2Event {
  if (event.type === "message.updated") return { ...event, message: { ...event.message, text } };
  if (
    event.type === "turn_item.updated" &&
    (event.turnItem.type === "assistant_message" || event.turnItem.type === "reasoning")
  )
    return { ...event, turnItem: { ...event.turnItem, text } };
  return event;
}
