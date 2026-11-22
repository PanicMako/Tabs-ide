// Pure transcript parsers for external agent CLIs. Formats follow Orca's scanners
// (MIT, (c) 2026 Lovecast Inc.) — orca-main/src/main/ai-vault/scanners/{claude,codex,gemini}.
// Only conversational text is kept: tool calls, tool output, thinking and system noise are dropped
// so search results match what a person actually said or read.
import type { SessionSearchAgent } from "@tabs/contracts";

export interface ParsedMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly ts: number | null;
}

export interface ParsedSession {
  readonly agent: SessionSearchAgent;
  readonly sessionId: string;
  readonly cwd: string | null;
  readonly title: string;
  readonly startedAt: number | null;
  readonly updatedAt: number | null;
  readonly messages: ReadonlyArray<ParsedMessage>;
}

/** Per-message and per-session caps keep one huge transcript from dominating the index. */
export const MAX_MESSAGE_CHARS = 6_000;
export const MAX_SESSION_CHARS = 600_000;

const NOISE_PREFIXES = [
  "<system-reminder>",
  "<command-name>",
  "<session_context>",
  "<command-message>",
  "<local-command",
  "<environment_context>",
  "<user_instructions>",
  "<user-prompt-submit-hook>",
  "# AGENTS.md instructions",
  "Caveat: The messages below were generated",
  "[Request interrupted",
];

const SYSTEM_REMINDER_BLOCK = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Strips injected scaffolding; returns "" when nothing human-written is left. */
export function cleanMessageText(raw: string): string {
  const stripped = raw.replace(SYSTEM_REMINDER_BLOCK, "").trim();
  if (stripped.length === 0) return "";
  for (const prefix of NOISE_PREFIXES) {
    if (stripped.startsWith(prefix)) return "";
  }
  return stripped.length > MAX_MESSAGE_CHARS ? stripped.slice(0, MAX_MESSAGE_CHARS) : stripped;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed[0] !== "{") return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/** Joins the text blocks of a content value (string, or array of {text} / {type:"text"} blocks). */
function contentText(content: unknown, textTypes: ReadonlySet<string>): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    const record = asRecord(block);
    if (!record || typeof record.text !== "string") continue;
    const type = record.type;
    if (type === undefined || (typeof type === "string" && textTypes.has(type))) {
      parts.push(record.text);
    }
  }
  return parts.join("\n");
}

function deriveTitle(messages: ReadonlyArray<ParsedMessage>, explicit: string | null): string {
  const source = explicit?.trim() || messages.find((m) => m.role === "user")?.text || "";
  const oneLine = source.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? `${oneLine.slice(0, 99)}…` : oneLine || "Untitled session";
}

class MessageSink {
  readonly messages: ParsedMessage[] = [];
  private chars = 0;
  startedAt: number | null = null;
  updatedAt: number | null = null;

  touch(ts: number | null) {
    if (ts === null) return;
    if (this.startedAt === null || ts < this.startedAt) this.startedAt = ts;
    if (this.updatedAt === null || ts > this.updatedAt) this.updatedAt = ts;
  }

  add(role: "user" | "assistant", rawText: string, ts: number | null) {
    this.touch(ts);
    if (this.chars >= MAX_SESSION_CHARS) return;
    const text = cleanMessageText(rawText);
    if (text.length === 0) return;
    this.chars += text.length;
    this.messages.push({ role, text, ts });
  }
}

const CLAUDE_TEXT_TYPES: ReadonlySet<string> = new Set(["text"]);

export function parseClaudeTranscript(
  lines: Iterable<string>,
  fallbackSessionId: string,
): ParsedSession | null {
  const sink = new MessageSink();
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let explicitTitle: string | null = null;
  for (const line of lines) {
    const record = parseJsonLine(line);
    if (!record) continue;
    const type = record.type;
    if (typeof record.sessionId === "string" && sessionId === null) sessionId = record.sessionId;
    if (typeof record.cwd === "string" && cwd === null) cwd = record.cwd;
    if (type === "custom-title" && typeof record.customTitle === "string") {
      explicitTitle = record.customTitle;
      continue;
    }
    if (type === "summary" && typeof record.summary === "string" && explicitTitle === null) {
      explicitTitle = record.summary;
      continue;
    }
    if (type !== "user" && type !== "assistant") continue;
    if (record.isMeta === true) continue;
    const message = asRecord(record.message);
    if (!message) continue;
    sink.add(
      type,
      contentText(message.content, CLAUDE_TEXT_TYPES),
      parseTimestamp(record.timestamp),
    );
  }
  if (sink.messages.length === 0) return null;
  return {
    agent: "claude",
    sessionId: sessionId ?? fallbackSessionId,
    cwd,
    title: deriveTitle(sink.messages, explicitTitle),
    startedAt: sink.startedAt,
    updatedAt: sink.updatedAt,
    messages: sink.messages,
  };
}

const CODEX_TEXT_TYPES: ReadonlySet<string> = new Set(["input_text", "output_text", "text"]);

export function parseCodexTranscript(
  lines: Iterable<string>,
  fallbackSessionId: string,
): ParsedSession | null {
  const sink = new MessageSink();
  let sessionId: string | null = null;
  let cwd: string | null = null;
  for (const line of lines) {
    const record = parseJsonLine(line);
    if (!record) continue;
    const payload = asRecord(record.payload);
    if (!payload) continue;
    const ts = parseTimestamp(record.timestamp);
    if (record.type === "session_meta") {
      if (typeof payload.id === "string") sessionId = payload.id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      sink.touch(parseTimestamp(payload.timestamp));
      continue;
    }
    if (record.type === "turn_context" && cwd === null && typeof payload.cwd === "string") {
      cwd = payload.cwd;
      continue;
    }
    if (record.type !== "response_item" || payload.type !== "message") continue;
    const role = payload.role;
    // `developer` and `system` carry harness instructions, not conversation.
    if (role !== "user" && role !== "assistant") continue;
    sink.add(role, contentText(payload.content, CODEX_TEXT_TYPES), ts);
  }
  if (sink.messages.length === 0) return null;
  return {
    agent: "codex",
    sessionId: sessionId ?? fallbackSessionId,
    cwd,
    title: deriveTitle(sink.messages, null),
    startedAt: sink.startedAt,
    updatedAt: sink.updatedAt,
    messages: sink.messages,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEMINI_TEXT_TYPES: ReadonlySet<string> = new Set(["text"]);

const GEMINI_WORKSPACE = /Workspace Directories:\*{0,2}\s*\n\s*-\s*(\/\S[^\n]*)/;

/**
 * Handles the JSONL chat format (message lines plus `{"$set": {"messages": [...]}}` snapshots,
 * which replace everything before them) and the older single-document `{messages: [...]}` JSON.
 */
export function parseGeminiTranscript(
  text: string,
  fallbackSessionId: string,
): ParsedSession | null {
  const sink = new MessageSink();
  let sessionId: string | null = null;
  let cwd: string | null = null;
  const entries = new Map<string, Record<string, unknown>>();
  let anonymous = 0;
  const remember = (entry: unknown) => {
    const record = asRecord(entry);
    if (!record) return;
    const id = typeof record.id === "string" ? record.id : `anon-${anonymous++}`;
    entries.set(id, record);
  };
  const trimmed = text.trimStart();
  const whole = trimmed.startsWith("{") ? tryParseObject(text) : null;
  if (whole && Array.isArray(whole.messages)) {
    if (typeof whole.sessionId === "string") sessionId = whole.sessionId;
    sink.touch(parseTimestamp(whole.startTime));
    sink.touch(parseTimestamp(whole.lastUpdated));
    for (const entry of whole.messages) remember(entry);
  } else {
    for (const line of text.split("\n")) {
      const record = parseJsonLine(line);
      if (!record) continue;
      const patch = asRecord(record.$set);
      if (patch) {
        if (Array.isArray(patch.messages)) {
          entries.clear();
          for (const entry of patch.messages) remember(entry);
        }
        continue;
      }
      if (typeof record.sessionId === "string" && sessionId === null && record.type === undefined) {
        sessionId = record.sessionId;
        sink.touch(parseTimestamp(record.startTime));
        continue;
      }
      remember(record);
    }
  }
  for (const record of entries.values()) {
    const role = record.type === "user" ? "user" : record.type === "gemini" ? "assistant" : null;
    if (role === null) continue;
    const raw = contentText(record.content, GEMINI_TEXT_TYPES);
    if (cwd === null) cwd = GEMINI_WORKSPACE.exec(raw)?.[1]?.trim() ?? null;
    sink.add(role, raw, parseTimestamp(record.timestamp));
  }
  if (sink.messages.length === 0) return null;
  return {
    agent: "gemini",
    // Some Gemini frontends reuse a constant id (e.g. "a2a-server") across files; only trust UUIDs.
    sessionId: sessionId !== null && UUID_PATTERN.test(sessionId) ? sessionId : fallbackSessionId,
    cwd,
    title: deriveTitle(sink.messages, null),
    startedAt: sink.startedAt,
    updatedAt: sink.updatedAt,
    messages: sink.messages,
  };
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

export interface OpenCodeSessionRow {
  readonly id: string;
  readonly directory: string | null;
  readonly title: string | null;
  readonly timeCreated: number;
  readonly timeUpdated: number;
}

export interface OpenCodePartRow {
  readonly messageId: string;
  readonly messageData: string;
  readonly partData: string;
  readonly timeCreated: number;
}

/** Joins OpenCode `message` + `part` rows (ordered by part creation) into a session. */
export function buildOpenCodeSession(
  session: OpenCodeSessionRow,
  parts: ReadonlyArray<OpenCodePartRow>,
): ParsedSession | null {
  const sink = new MessageSink();
  sink.touch(session.timeCreated);
  sink.touch(session.timeUpdated);
  const order: string[] = [];
  const byMessage = new Map<string, { role: "user" | "assistant"; ts: number; text: string[] }>();
  for (const part of parts) {
    const part_ = tryParseObject(part.partData);
    if (!part_ || part_.type !== "text" || typeof part_.text !== "string") continue;
    if (part_.synthetic === true) continue;
    let entry = byMessage.get(part.messageId);
    if (!entry) {
      const message = tryParseObject(part.messageData);
      const role = message?.role;
      if (role !== "user" && role !== "assistant") continue;
      entry = { role, ts: part.timeCreated, text: [] };
      byMessage.set(part.messageId, entry);
      order.push(part.messageId);
    }
    entry.text.push(part_.text);
  }
  for (const id of order) {
    const entry = byMessage.get(id)!;
    sink.add(entry.role, entry.text.join("\n"), entry.ts);
  }
  if (sink.messages.length === 0) return null;
  return {
    agent: "opencode",
    sessionId: session.id,
    cwd: session.directory,
    title: deriveTitle(sink.messages, session.title),
    startedAt: sink.startedAt,
    updatedAt: sink.updatedAt,
    messages: sink.messages,
  };
}
