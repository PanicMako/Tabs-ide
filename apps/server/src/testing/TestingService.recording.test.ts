import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderInstanceId } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import { TestingService } from "./TestingService";

describe("no-AI recording handoff", () => {
  it("registers a reviewed recording as a runnable artifact without a model backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-recording-test-"));
    const service = new TestingService(root);
    try {
      const code =
        'import { test, expect } from "playwright/test"; test("recorded", () => { expect(1).toBe(1); });';
      const job = await service.generateTests({
        projectId: "recording",
        projectPath: root,
        engine: "recording",
        recordedCode: code,
        recordedExpectedResult: "One equals one",
        modelSelection: {
          instanceId: ProviderInstanceId.makeUnsafe("not-configured"),
          model: "not-used",
        },
      });
      expect(job.status).toBe("completed");
      expect(job.estimatedCostUsd).toBe(0);
      expect(job.artifacts).toHaveLength(1);
      expect(await readFile(job.artifacts[0]!.specPath, "utf8")).toBe(code);
    } finally {
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
