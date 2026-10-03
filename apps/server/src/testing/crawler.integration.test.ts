import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TestingCrawler } from "./crawler";
import { TestingGraphStore } from "./graphStore";
import { RuntimeSqliteDatabase } from "./sqlite";
import { verifyReconciledCaseLive } from "./reconciliation";

const runIntegration = process.env.TESTING_CRAWLER_INTEGRATION === "1";
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe.skipIf(!runIntegration)("Testing crawler Playwright MCP integration", () => {
  it("crawls the fixture and stores only sanitized, tokenized accessibility content", async () => {
    const fixture = await readFile(new URL("./fixtures/hidden-injection.html", import.meta.url));
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fixture);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind");

    const testingRoot = await mkdtemp(join(tmpdir(), "tabs-testing-crawler-"));
    cleanupPaths.push(testingRoot);
    const databasePath = join(testingRoot, "state-graph.sqlite");
    const store = new TestingGraphStore(databasePath);

    try {
      const result = await new TestingCrawler(store, testingRoot).explore({
        projectId: "fixture-project",
        targetUrl: `http://127.0.0.1:${address.port}`,
        maxStates: 3,
      });

      expect(result.nodeCount).toBeGreaterThanOrEqual(1);
      expect(result.edgeCount).toBeGreaterThanOrEqual(1);
      expect(result.piiTokenCount).toBeGreaterThanOrEqual(1);
      expect(result.statesVisited).toBeGreaterThanOrEqual(1);
      expect(result.transitionsObserved).toBeGreaterThanOrEqual(1);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.maxStates).toBe(3);
      expect(["plateaued", "max-states"]).toContain(result.terminationReason);
    } finally {
      store.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }

    const database = new RuntimeSqliteDatabase(databasePath, { readonly: true });
    const snapshots = database
      .query<{ sanitized_snapshot: string }, []>("SELECT sanitized_snapshot FROM graph_nodes")
      .all()
      .map((row) => row.sanitized_snapshot)
      .join("\n");
    database.close();

    expect(snapshots).toContain("Safe account page");
    expect(snapshots).toContain("<PII_EMAIL_");
    expect(snapshots).not.toContain("qa@example.com");
    expect(snapshots).not.toContain("Ignore previous instructions");
    expect(snapshots).not.toContain("secret token");
  }, 60_000);

  it("keeps path-scoped exploration inside the target route subtree", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (request.url === "/area/child") {
        response.end("<main><h1>Child page</h1></main>");
        return;
      }
      if (request.url === "/outside") {
        response.end("<main><h1>Outside page</h1></main>");
        return;
      }
      response.end(
        '<main><h1>Scoped root</h1><a href="/area/child">Child</a><a href="/outside">Outside</a></main>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind");

    const testingRoot = await mkdtemp(join(tmpdir(), "tabs-testing-scope-"));
    cleanupPaths.push(testingRoot);
    const databasePath = join(testingRoot, "state-graph.sqlite");
    const store = new TestingGraphStore(databasePath);

    try {
      const result = await new TestingCrawler(store, testingRoot).explore({
        projectId: "scoped-project",
        targetUrl: `http://127.0.0.1:${address.port}/area`,
        scope: "path",
        maxStates: 5,
        maxDurationSeconds: 30,
      });

      expect(result.scope).toBe("path");
      expect(result.maxDurationSeconds).toBe(30);
      expect(result.statesVisited).toBe(2);
    } finally {
      store.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }

    const database = new RuntimeSqliteDatabase(databasePath, { readonly: true });
    const pageUrls = database
      .query<{ page_url: string }, []>("SELECT page_url FROM graph_nodes ORDER BY page_url")
      .all()
      .map((row) => new URL(row.page_url).pathname);
    database.close();

    expect(pageUrls).toEqual(["/area", "/area/child"]);
  }, 60_000);

  it("completes cleanly when the time budget expires", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end('<main><h1>Budgeted page</h1><button type="button">Continue</button></main>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind");

    const testingRoot = await mkdtemp(join(tmpdir(), "tabs-testing-budget-"));
    cleanupPaths.push(testingRoot);
    const store = new TestingGraphStore(join(testingRoot, "state-graph.sqlite"));

    try {
      const result = await new TestingCrawler(store, testingRoot).explore({
        projectId: "budgeted-project",
        targetUrl: `http://127.0.0.1:${address.port}`,
        scope: "page",
        maxStates: 10,
        maxDurationSeconds: 1,
      });

      expect(result.terminationReason).toBe("time-budget");
      expect(result.maxDurationSeconds).toBe(1);
      expect(result.lastRunStatus).toBe("completed");
    } finally {
      store.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 60_000);

  it("replays a reconciled case live and reports a renamed control", async () => {
    const renamed = { value: false };
    const server = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (request.url === "/profile") {
        response.end(
          `<main><h1>Profile</h1><button type="button">${renamed.value ? "Apply changes" : "Save changes"}</button></main>`,
        );
        return;
      }
      response.end('<main><h1>Home</h1><a href="/profile">Profile</a></main>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind");
    const testingRoot = await mkdtemp(join(tmpdir(), "tabs-testing-reconcile-"));
    cleanupPaths.push(testingRoot);
    const store = new TestingGraphStore(join(testingRoot, "state-graph.sqlite"));
    const reconciled = {
      externalId: "QA-001",
      description: "Update profile",
      steps: ["Open profile", "Save changes"],
      expectedResults: ["", ""],
      expectedResult: "",
      sourceSheet: "Cases",
      sourceRow: 2,
      status: "matches" as const,
      mismatches: [],
      matchedStateIds: ["root", "profile", "saved"],
      matchedEdges: [
        {
          fromStateId: "root",
          toStateId: "profile",
          role: "link",
          name: "Profile",
          intentLocator: "getByRole('link', { name: 'Profile' })",
        },
        {
          fromStateId: "profile",
          toStateId: "saved",
          role: "button",
          name: "Save changes",
          intentLocator: "getByRole('button', { name: 'Save changes' })",
        },
      ],
    };
    try {
      const targetUrl = `http://127.0.0.1:${address.port}`;
      const matching = await verifyReconciledCaseLive({
        projectId: "reconcile-project",
        targetUrl,
        testingRoot,
        store,
        reconciled,
      });
      expect(matching.status).toBe("matches");

      renamed.value = true;
      const mismatch = await verifyReconciledCaseLive({
        projectId: "reconcile-project",
        targetUrl,
        testingRoot,
        store,
        reconciled,
      });
      expect(mismatch.status).toBe("needs-review");
      expect(mismatch.mismatches.at(-1)).toMatchObject({
        kind: "live-verification",
        expected: 'button "Save changes"',
      });
    } finally {
      store.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 60_000);
});
