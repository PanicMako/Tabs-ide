import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TestingService } from "./TestingService";

const runIntegration = process.env.TESTING_CRAWLER_INTEGRATION === "1";

describe.skipIf(!runIntegration)("TestingService Phase 2 integration", () => {
  it("imports the controlled workbook after crawling and persists reviewable results", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (request.url === "/profile") {
        response.end(
          '<main><h1>Profile</h1><button type="button" onclick="this.textContent=\'Saved\'">Save changes</button></main>',
        );
        return;
      }
      response.end('<main><h1>Home</h1><a href="/profile">Profile</a></main>');
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind");
    const stateDirectory = await mkdtemp(join(tmpdir(), "tabs-testing-service-phase2-"));
    const service = new TestingService(stateDirectory);
    try {
      const targetUrl = `http://127.0.0.1:${address.port}`;
      const crawl = await service.startExploration({
        projectId: "phase2-project",
        targetUrl,
        maxStates: 4,
        maxDurationSeconds: 30,
      });
      expect(crawl.edgeCount).toBeGreaterThanOrEqual(2);

      const result = await service.importWorkbook({
        projectId: "phase2-project",
        targetUrl,
        workbookPath: resolve(
          import.meta.dirname,
          "../../../../../testing/fixtures/phase2-controlled.xlsx",
        ),
      });
      expect(result).toMatchObject({
        importedCount: 6,
        matchesCount: 1,
        needsReviewCount: 1,
        blockedCount: 4,
      });
      const valid = result.cases.find((testCase) => testCase.externalId === "QA-003");
      expect(valid).toMatchObject({ status: "matches", sourceSheet: "QA Cases", sourceRow: 9 });
      const mismatch = result.cases.find((testCase) => testCase.externalId === "QA-002");
      expect(mismatch?.mismatches[0]).toMatchObject({ kind: "unreachable" });
    } finally {
      service.close();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
      await rm(stateDirectory, { recursive: true, force: true });
    }
  }, 90_000);
});
