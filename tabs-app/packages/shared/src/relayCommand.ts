/**
 * The `@relay` language. People text Relay the way they'd text a friend:
 *
 *   @relay remind me to call Sam tomorrow at 4
 *   @relay todo fix the sidebar #bug
 *   @relay remember we deploy from main on Fridays
 *   @relay fetch the latest GitHub issues into my to-dos
 *
 * Quick things (a to-do, a reminder, context, a note, ticking something off) are saved
 * instantly without a model. Anything that reaches outside Relay, needs reasoning, or refers to
 * the conversation ("add this") goes to an agent, which uses the `relay` MCP tool.
 *
 * Pure and dependency-free so the chat composer, Quick Actions and the server share it.
 */

export type RelayQuickKind = "todo" | "reminder" | "context" | "note";

export type RelayIntent =
  | { readonly type: "empty" }
  | {
      readonly type: "create";
      readonly kind: RelayQuickKind;
      readonly title: string;
      readonly tags: ReadonlyArray<string>;
      /** Epoch ms, or null when there is no time. */
      readonly due: number | null;
      /** True when a reminder had no time and Relay picked tomorrow 9:00. */
      readonly guessedTime: boolean;
    }
  | { readonly type: "complete"; readonly query: string }
  | { readonly type: "agent"; readonly text: string };

const DAY = 86_400_000;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const UNITS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: DAY,
  day: DAY,
  days: DAY,
  w: 7 * DAY,
  week: 7 * DAY,
  weeks: 7 * DAY,
};

/** True when a message is addressed to Relay. */
export const RELAY_MENTION_PATTERN = /(^|\s)@relay\b/i;
export const isRelayMessage = (text: string): boolean => RELAY_MENTION_PATTERN.test(text);

/** The message with the `@relay` mention removed. */
export const stripRelayMention = (text: string): string =>
  text
    .replace(/(^|\s)@relay\b[:,]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

function atTime(base: number, hours: number, minutes: number): number {
  const date = new Date(base);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function parseClock(
  text: string,
): { readonly hours: number; readonly minutes: number; readonly source: string } | null {
  const match = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (match === null) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = (match[3] ?? "").toLowerCase();
  // A bare number is only a time when it says "at", has minutes, or has am/pm.
  if (meridiem === "" && match[2] === undefined && !/\bat\s/i.test(match[0])) return null;
  if (hours > 23 || minutes > 59) return null;
  // "at 4" means the afternoon: people rarely schedule 1–7 AM without saying so.
  if (meridiem === "" && hours >= 1 && hours <= 7) hours += 12;
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  return { hours, minutes, source: match[0] };
}

/** Finds a time phrase and returns the due time plus the text without it, or null. */
export function parseRelayWhen(
  text: string,
  now: number = Date.now(),
): { readonly due: number; readonly rest: string } | null {
  let rest = ` ${text} `;
  let due: number | null = null;
  const take = (pattern: RegExp, read: (match: RegExpExecArray) => number | null) => {
    if (due !== null) return;
    const match = pattern.exec(rest);
    if (match === null) return;
    const value = read(match);
    if (value === null) return;
    due = value;
    rest = rest.replace(match[0], " ");
  };
  take(/\bin\s+(an?|\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)\b/i, (m) => {
    const amount = /^an?$/i.test(m[1]!) ? 1 : Number(m[1]);
    return now + amount * UNITS[m[2]!.toLowerCase()]!;
  });
  take(/\b(later today|this evening|tonight)\b/i, (m) =>
    atTime(now, /later/i.test(m[1]!) ? Math.min(new Date(now).getHours() + 3, 22) : 19, 0),
  );
  take(/\b(tomorrow|tmrw|tmr)\b(?:\s+(morning|afternoon|evening|night))?/i, (m) => {
    const part = (m[2] ?? "").toLowerCase();
    const hour = { morning: 9, afternoon: 14, evening: 18, night: 20 }[part] ?? 9;
    return atTime(now + DAY, hour, 0);
  });
  take(/\bnext week\b/i, () => {
    const add = (8 - new Date(now).getDay()) % 7 || 7;
    return atTime(now + add * DAY, 9, 0);
  });
  take(
    /\b(?:on\s+|next\s+|this\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/i,
    (m) => {
      const target = WEEKDAYS.indexOf(m[1]!.toLowerCase().slice(0, 3));
      const add = (target - new Date(now).getDay() + 7) % 7 || 7;
      return atTime(now + add * DAY, 9, 0);
    },
  );
  const clock = parseClock(rest);
  if (clock !== null) {
    rest = rest.replace(clock.source, " ");
    if (due !== null) {
      due = atTime(due, clock.hours, clock.minutes);
    } else {
      due = atTime(now, clock.hours, clock.minutes);
      if (due <= now) due += DAY;
    }
  }
  if (due === null) return null;
  return {
    due,
    rest: rest
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?])/g, "$1")
      .trim(),
  };
}

const tidy = (text: string) => text.replace(/^[\s,:;-]+|[\s,:;.-]+$/g, "").replace(/\s+/g, " ");
const capital = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

/** Work that reaches outside Relay or needs the conversation: always an agent's job. */
const AGENT_WORK =
  /\b(github|issues?|pull requests?|prs?|repo|commits?|branch(?:es)?|fetch|sync|import|pull in|look up|from the (?:code|chat|thread)|codebase|this (?:chat|thread|conversation)|summari[sz]e)\b/i;
const REFERS_TO_CHAT = /^(?:add|save|keep|remember|note|todo)?\s*(?:this|that|it|these|those)\b/i;

/** Reads one message to Relay. */
export function parseRelayCommand(input: string, now: number = Date.now()): RelayIntent {
  let text = stripRelayMention(input);
  if (text === "") return { type: "empty" };
  const tags: string[] = [];
  text = text
    .replace(/(^|\s)#([\p{L}\p{N}_-]{1,40})/gu, (_, space: string, tag: string) => {
      tags.push(tag.toLowerCase());
      return space;
    })
    .trim();

  if (AGENT_WORK.test(text) || REFERS_TO_CHAT.test(text)) return { type: "agent", text };

  let match: RegExpExecArray | null;
  if (
    (match = /^(?:remind me|reminder|nudge me|ping me)\b(?:\s+(?:to|about|that)\b)?\s*(.*)$/i.exec(
      text,
    ))
  ) {
    const when = parseRelayWhen(match[1]!, now);
    const title = capital(tidy(when ? when.rest.replace(/^(to|about|that)\s+/i, "") : match[1]!));
    if (title === "") return { type: "agent", text };
    return {
      type: "create",
      kind: "reminder",
      title,
      tags,
      due: when ? when.due : atTime(now + DAY, 9, 0),
      guessedTime: when === null,
    };
  }
  if (
    (match =
      /^(?:remember(?: that)?|context|fyi|note that|keep in mind(?: that)?)\b[:\s]*(.+)$/i.exec(
        text,
      ))
  ) {
    return create("context", match[1]!, tags, null);
  }
  if ((match = /^(?:note|jot(?: down)?|write down|idea)\b[:\s]*(.+)$/i.exec(text))) {
    return create("note", match[1]!, tags, null);
  }
  if (
    (match =
      /^(?:done|did|finished|completed|tick off|check off|mark (?:as )?done)\b[:\s]*(.+)$/i.exec(
        text,
      ))
  ) {
    return { type: "complete", query: tidy(match[1]!) };
  }
  if (
    (match =
      /^(?:todo|to-do|to do|task|add(?: a)?(?: to-?do)?|i need to|need to|don'?t forget to)\b[:\s]*(?:to\s+)?(.+)$/i.exec(
        text,
      ))
  ) {
    const when = parseRelayWhen(match[1]!, now);
    return create("todo", when ? when.rest : match[1]!, tags, when ? when.due : null);
  }
  // Questions and requests are work for an agent; short statements become notes.
  if (
    /\?$/.test(text) ||
    /^(can|could|would|please|help|organi[sz]e|plan|update|clean|group|sort|prioriti[sz]e|what|why|how|list|show)\b/i.test(
      text,
    ) ||
    text.length > 180
  ) {
    return { type: "agent", text };
  }
  const when = parseRelayWhen(text, now);
  if (when !== null) return create("reminder", when.rest, tags, when.due);
  return create("note", text, tags, null);
}

function create(
  kind: RelayQuickKind,
  raw: string,
  tags: ReadonlyArray<string>,
  due: number | null,
): RelayIntent {
  const title = capital(tidy(raw)).slice(0, 300);
  return title === ""
    ? { type: "empty" }
    : { type: "create", kind, title, tags, due, guessedTime: false };
}

/** A short line for the composer while typing, e.g. "Reminder · tomorrow 4:00 PM". */
export function describeRelayIntent(intent: RelayIntent, now: number = Date.now()): string {
  switch (intent.type) {
    case "empty":
      return "Tell Relay what to keep";
    case "complete":
      return `Mark “${intent.query}” done`;
    case "agent":
      return "Your agent will handle this and update Relay";
    case "create": {
      const noun = { todo: "To-do", reminder: "Reminder", context: "Context", note: "Note" }[
        intent.kind
      ];
      return intent.due === null ? noun : `${noun} · ${formatRelayDue(intent.due, now)}`;
    }
  }
}

export function formatRelayDue(due: number, now: number = Date.now()): string {
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    due,
  );
  const days = Math.round((atTime(due, 0, 0) - atTime(now, 0, 0)) / DAY);
  if (due - now < 3_600_000 && due > now) {
    return `in ${Math.max(1, Math.round((due - now) / 60_000))} min`;
  }
  if (days === 0) return `today ${clock}`;
  if (days === 1) return `tomorrow ${clock}`;
  if (days > 1 && days < 7) {
    return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(due)} ${clock}`;
  }
  return `${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(due)} ${clock}`;
}

/**
 * Appended to an `@relay` message that goes to an agent, so it knows Relay is the target and
 * which tool to use. Kept short: it rides along on every such turn.
 */
export const RELAY_AGENT_NOTE =
  "(This message is addressed to Relay, the user's project notebook. Do what it asks, record the result with the `relay` tool, then reply in one short line.)";
