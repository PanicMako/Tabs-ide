import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveWorkerUrl, SessionSearchWorkerClient } from "./WorkerClient.ts";

let dir: string;
let client: SessionSearchWorkerClient | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "session-search-worker-"));
});
afterEach(async () => {
  await client?.shutdown();
  client = null;
  await rm(dir, { recursive: true, force: true });
});

describe("SessionSearchWorkerClient", () => {
  it("resolves the worker entry from source", () => {
    expect(resolveWorkerUrl().pathname).toMatch(/sessionSearchWorker\.(ts|mjs)$/);
  });

  it("indexes and queries inside a real worker thread", async () => {
    const project = join(dir, "projects", "-w");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "s1.jsonl"),
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        cwd: "/w",
        timestamp: "2026-11-01T10:00:00Z",
        message: { role: "user", content: "investigate flaky websocket reconnect" },
      }),
    );
    client = new SessionSearchWorkerClient({
      dbPath: join(dir, "index.sqlite"),
      roots: {
        claudeProjects: join(dir, "projects"),
        codexSessions: [],
        geminiTmp: join(dir, "gemini"),
        opencodeDb: join(dir, "none.db"),
      },
    });
    // The first request spawns the worker, which starts indexing on its own.
    let hits = (await client.query({ query: "reconnect" })).hits;
    for (let attempt = 0; hits.length === 0 && attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      hits = (await client.query({ query: "reconnect" })).hits;
    }
    expect(hits[0]?.sessionId).toBe("s1");
    expect((await client.status()).sessions).toBe(1);
    expect((await client.getSession("claude", "s1"))?.cwd).toBe("/w");
  });
});
