import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SESSION_SEARCH_MARK_END, SESSION_SEARCH_MARK_START } from "@tabs/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionSearchEngine } from "./engine.ts";
import { MARK_END, MARK_START } from "./marks.ts";
import { resumeCommandFor } from "./resume.ts";

const j = (value: unknown) => JSON.stringify(value);

let dir: string;
let engine: SessionSearchEngine | null = null;

const roots = () => ({
  claudeProjects: join(dir, "claude", "projects"),
  codexSessions: [join(dir, "codex", "sessions")],
  geminiTmp: join(dir, "gemini", "tmp"),
  opencodeDb: join(dir, "opencode.db"),
});

async function writeClaude(name: string, text: string, ts: string) {
  const project = join(dir, "claude", "projects", "-work-app");
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, `${name}.jsonl`),
    [
      j({
        type: "user",
        sessionId: name,
        cwd: "/work/app",
        timestamp: ts,
        message: { role: "user", content: text },
      }),
      j({
        type: "assistant",
        sessionId: name,
        timestamp: ts,
        message: { role: "assistant", content: [{ type: "text", text: "Sure thing." }] },
      }),
    ].join("\n"),
  );
}

async function open() {
  engine = await SessionSearchEngine.open({ dbPath: join(dir, "index.sqlite"), roots: roots() });
  return engine;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "session-search-"));
});
afterEach(async () => {
  await engine?.dispose();
  engine = null;
  await rm(dir, { recursive: true, force: true });
});

describe("SessionSearchEngine", () => {
  it("indexes transcripts and returns ranked, highlighted hits", async () => {
    await writeClaude("one", "Please debounce the sidebar search input", "2026-11-01T10:00:00Z");
    await writeClaude("two", "Unrelated question about git rebase", "2026-11-02T10:00:00Z");
    const e = await open();
    e.reindex();
    await e.whenIdle();

    const result = e.query({ query: "debounce sidebar" });
    expect(result.hits).toHaveLength(1);
    const hit = result.hits[0]!;
    expect(hit.agent).toBe("claude");
    expect(hit.sessionId).toBe("one");
    expect(hit.cwd).toBe("/work/app");
    expect(hit.snippet).toContain(SESSION_SEARCH_MARK_START);
    expect(e.status().sessions).toBe(2);
  });

  it("matches prefixes while typing and applies agent/cwd/date filters", async () => {
    await writeClaude("one", "refactor the websocket reconnect", "2026-11-01T10:00:00Z");
    const e = await open();
    e.reindex();
    await e.whenIdle();
    expect(e.query({ query: "reconn" }).hits).toHaveLength(1);
    expect(e.query({ query: "reconn", agents: ["codex"] }).hits).toHaveLength(0);
    expect(e.query({ query: "reconn", cwd: "work/app" }).hits).toHaveLength(1);
    expect(e.query({ query: "reconn", cwd: "elsewhere" }).hits).toHaveLength(0);
    expect(e.query({ query: "reconn", since: Date.parse("2026-12-01") }).hits).toHaveLength(0);
    expect(e.query({ query: "reconn", until: Date.parse("2026-12-01") }).hits).toHaveLength(1);
  });

  it("lists recent sessions for an empty query", async () => {
    await writeClaude("old", "older conversation", "2026-10-01T10:00:00Z");
    await writeClaude("new", "newer conversation", "2026-11-01T10:00:00Z");
    const e = await open();
    e.reindex();
    await e.whenIdle();
    expect(e.query({ query: "" }).hits.map((h) => h.sessionId)).toEqual(["new", "old"]);
  });

  it("re-indexes only changed files and drops deleted transcripts", async () => {
    await writeClaude("one", "alpha topic", "2026-11-01T10:00:00Z");
    await writeClaude("two", "beta topic", "2026-11-01T11:00:00Z");
    const e = await open();
    e.reindex();
    await e.whenIdle();
    expect(e.query({ query: "alpha" }).hits).toHaveLength(1);

    await writeClaude("one", "gamma topic", "2026-11-03T10:00:00Z");
    const later = new Date(Date.now() + 5000);
    await utimes(join(dir, "claude", "projects", "-work-app", "one.jsonl"), later, later);
    await rm(join(dir, "claude", "projects", "-work-app", "two.jsonl"));
    e.reindex();
    await e.whenIdle();

    expect(e.query({ query: "alpha" }).hits).toHaveLength(0);
    expect(e.query({ query: "gamma" }).hits).toHaveLength(1);
    expect(e.query({ query: "beta" }).hits).toHaveLength(0);
    expect(e.status().sessions).toBe(1);
  });

  it("finds Codex sessions and resolves how to resume them", async () => {
    const day = join(dir, "codex", "sessions", "2026", "11", "02");
    await mkdir(day, { recursive: true });
    await writeFile(
      join(day, "rollout-2026-11-02T08-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
      [
        j({
          type: "session_meta",
          payload: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", cwd: "/work/api" },
        }),
        j({
          type: "response_item",
          timestamp: "2026-11-02T08:00:02Z",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "add exponential backoff" }],
          },
        }),
      ].join("\n"),
    );
    const e = await open();
    e.reindex();
    await e.whenIdle();
    const [hit] = e.query({ query: "backoff", agents: ["codex"] }).hits;
    expect(hit?.sessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const stored = e.getSession("codex", hit!.sessionId);
    expect(stored?.cwd).toBe("/work/api");
    expect(resumeCommandFor("codex", hit!.sessionId)).toBe(`codex resume ${hit!.sessionId}`);
  });

  it("full reindex rebuilds from scratch", async () => {
    await writeClaude("one", "persistent", "2026-11-01T10:00:00Z");
    const e = await open();
    e.reindex();
    await e.whenIdle();
    e.reindex(true);
    await e.whenIdle();
    expect(e.query({ query: "persistent" }).hits).toHaveLength(1);
  });
});

describe("marks", () => {
  it("match the contract constants", () => {
    expect([MARK_START, MARK_END]).toEqual([SESSION_SEARCH_MARK_START, SESSION_SEARCH_MARK_END]);
  });
});

describe("resumeCommandFor", () => {
  it("builds commands per agent and refuses unsafe ids", () => {
    expect(resumeCommandFor("claude", "abc-123")).toBe("claude --resume abc-123");
    expect(resumeCommandFor("opencode", "ses_1")).toBe("opencode --session ses_1");
    expect(resumeCommandFor("gemini", "x")).toBeNull();
    expect(resumeCommandFor("claude", "a; rm -rf /")).toBeNull();
  });
});
