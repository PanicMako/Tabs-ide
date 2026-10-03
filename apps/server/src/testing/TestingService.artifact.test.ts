import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProviderInstanceId } from "@tabs/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { TestingGraphStore } from "./graphStore";
import { TestingService } from "./TestingService";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createFixture(options?: { readonly escapingDataPath?: boolean }) {
  const stateDirectory = await mkdtemp(join(tmpdir(), "tabs-testing-artifact-state-"));
  const outputDirectory = await mkdtemp(join(tmpdir(), "tabs-testing-artifact-output-"));
  cleanupPaths.push(stateDirectory, outputDirectory);
  await mkdir(join(stateDirectory, "testing"), { recursive: true });
  const store = new TestingGraphStore(join(stateDirectory, "testing", "state-graph.sqlite"));
  const testCase = store.createCase({
    projectId: "project-a",
    externalId: "TC-00001",
    description: "Preview generated artifact",
    steps: ["Open the page"],
    expectedResult: "The page is visible",
  }).cases[0]!;
  const jobId = "job-1";
  store.createGenerationJob({
    id: jobId,
    projectId: "project-a",
    outputDirectory,
    totalCases: 1,
    modelSelection: {
      instanceId: ProviderInstanceId.makeUnsafe("codex"),
      model: "gpt-5",
    },
  });
  const specPath = join(outputDirectory, "case.spec.ts");
  const pagePath = join(outputDirectory, "case.page.ts");
  const dataPath = join(outputDirectory, "case.data.ts");
  await Promise.all([
    writeFile(specPath, "export const spec = true;\n"),
    writeFile(pagePath, "export class Page {}\n"),
  ]);
  if (options?.escapingDataPath) {
    const externalDirectory = await mkdtemp(join(tmpdir(), "tabs-testing-artifact-external-"));
    cleanupPaths.push(externalDirectory);
    const externalPath = join(externalDirectory, "secret.data.ts");
    await writeFile(externalPath, "export const secret = true;\n");
    await symlink(externalPath, dataPath);
  } else {
    await writeFile(dataPath, "export const expected = 'visible';\n");
  }
  store.addGeneratedArtifact({
    jobId,
    caseId: testCase.id,
    externalId: testCase.externalId,
    featureSlug: "preview-generated-artifact",
    pageObjectPath: pagePath,
    dataPath,
    specPath,
    fingerprints: [],
    captureReplay: false,
  });
  store.updateGenerationJob(jobId, { status: "completed", completedCases: 1 });
  store.close();
  return { stateDirectory, jobId, caseId: testCase.id };
}

describe("TestingService.readArtifact", () => {
  it("returns a registered artifact's contents", async () => {
    const fixture = await createFixture();
    const service = new TestingService(fixture.stateDirectory);
    try {
      await expect(
        service.readArtifact({
          projectId: "project-a",
          generationJobId: fixture.jobId,
          caseId: fixture.caseId,
          artifactKind: "data",
        }),
      ).resolves.toEqual({ contents: "export const expected = 'visible';\n" });
    } finally {
      service.close();
    }
  });

  it("rejects a job belonging to a different project", async () => {
    const fixture = await createFixture();
    const service = new TestingService(fixture.stateDirectory);
    try {
      await expect(
        service.readArtifact({
          projectId: "project-b",
          generationJobId: fixture.jobId,
          caseId: fixture.caseId,
          artifactKind: "data",
        }),
      ).rejects.toThrow("Generation job was not found in this project");
    } finally {
      service.close();
    }
  });

  it("rejects a registered symlink that escapes the job output directory", async () => {
    const fixture = await createFixture({ escapingDataPath: true });
    const service = new TestingService(fixture.stateDirectory);
    try {
      await expect(
        service.readArtifact({
          projectId: "project-a",
          generationJobId: fixture.jobId,
          caseId: fixture.caseId,
          artifactKind: "data",
        }),
      ).rejects.toThrow("Generated artifact path escapes the generation output directory");
    } finally {
      service.close();
    }
  });

  it("rejects missing jobs and cases with specific errors", async () => {
    const fixture = await createFixture();
    const service = new TestingService(fixture.stateDirectory);
    try {
      await expect(
        service.readArtifact({
          projectId: "project-a",
          generationJobId: "missing-job",
          caseId: fixture.caseId,
          artifactKind: "spec",
        }),
      ).rejects.toThrow("Generation job was not found in this project");
      await expect(
        service.readArtifact({
          projectId: "project-a",
          generationJobId: fixture.jobId,
          caseId: "missing-case",
          artifactKind: "spec",
        }),
      ).rejects.toThrow("Generated artifact was not found for this case");
    } finally {
      service.close();
    }
  });
});
