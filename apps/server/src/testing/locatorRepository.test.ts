import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TestingGraphStore } from "./graphStore";
import { LocatorLibraryStore } from "./locatorLibrary";
import { applyLocatorRepositoryWrite, previewLocatorRepositoryWrite } from "./locatorRepository";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tabs-locator-repository-"));
  roots.push(root);
  const projectPath = join(root, "project");
  const destinationFolder = join(projectPath, "tests", "pages");
  await mkdir(destinationFolder, { recursive: true });
  const databasePath = join(root, "testing.sqlite");
  const graph = new TestingGraphStore(databasePath);
  const store = new LocatorLibraryStore(databasePath);
  store.saveCapturedPage({
    projectId: "project-a",
    sessionId: null,
    rawUrl: "https://example.test/",
    environmentLabel: "uat",
    fingerprint: "landing",
    captureSource: "manual",
    observedElements: 1,
    truncatedElements: 0,
    candidates: [
      {
        locatorKey: "sign-in",
        classification: "action",
        strategy: "role",
        arguments: { role: "button", name: "Sign in" },
        semanticContext: "Sign in",
        source: "manual",
        lifecycleStatus: "accepted",
      },
    ],
  });
  const pageId = store.library("project-a").pages[0]!.id;
  return { root, projectPath, destinationFolder, graph, store, pageId };
}

describe("locator repository output", () => {
  it("previews and atomically applies only the reviewed generated file", async () => {
    const value = await fixture();
    try {
      const proposal = await previewLocatorRepositoryWrite({
        projectId: "project-a",
        projectPath: value.projectPath,
        pageId: value.pageId,
        destinationFolder: value.destinationFolder,
        fileName: "landing.page.ts",
        store: value.store,
      });
      expect(proposal).toMatchObject({
        changeKind: "create",
        relativePath: "tests/pages/landing.page.ts",
        selectedLocatorCount: 1,
      });
      const result = await applyLocatorRepositoryWrite({
        projectId: "project-a",
        projectPath: value.projectPath,
        pageId: value.pageId,
        destinationFolder: value.destinationFolder,
        fileName: "landing.page.ts",
        expectedArtifactSourceHash: proposal.artifactSourceHash,
        expectedDestinationSourceHash: proposal.destinationSourceHash,
        store: value.store,
      });
      expect(await readFile(join(value.destinationFolder, "landing.page.ts"), "utf8")).toBe(
        proposal.proposedCode,
      );
      expect(result.library.pages[0]?.repositoryTarget?.relativePath).toBe(
        "tests/pages/landing.page.ts",
      );
    } finally {
      value.store.close();
      value.graph.close();
    }
  });

  it("rejects folders outside the project and symbolic-link destinations", async () => {
    const value = await fixture();
    try {
      await expect(
        previewLocatorRepositoryWrite({
          projectId: "project-a",
          projectPath: value.projectPath,
          pageId: value.pageId,
          destinationFolder: value.root,
          fileName: "outside.page.ts",
          store: value.store,
        }),
      ).rejects.toThrow(/inside the selected project/);

      const external = join(value.root, "external.ts");
      await writeFile(external, "external");
      await symlink(external, join(value.destinationFolder, "linked.page.ts"));
      await expect(
        previewLocatorRepositoryWrite({
          projectId: "project-a",
          projectPath: value.projectPath,
          pageId: value.pageId,
          destinationFolder: value.destinationFolder,
          fileName: "linked.page.ts",
          store: value.store,
        }),
      ).rejects.toThrow(/symbolic link/);
    } finally {
      value.store.close();
      value.graph.close();
    }
  });

  it("stops when the destination changed after review", async () => {
    const value = await fixture();
    try {
      const file = join(value.destinationFolder, "landing.page.ts");
      await writeFile(file, "// original\n");
      const proposal = await previewLocatorRepositoryWrite({
        projectId: "project-a",
        projectPath: value.projectPath,
        pageId: value.pageId,
        destinationFolder: value.destinationFolder,
        fileName: "landing.page.ts",
        store: value.store,
      });
      await writeFile(file, "// changed elsewhere\n");
      await expect(
        applyLocatorRepositoryWrite({
          projectId: "project-a",
          projectPath: value.projectPath,
          pageId: value.pageId,
          destinationFolder: value.destinationFolder,
          fileName: "landing.page.ts",
          expectedArtifactSourceHash: proposal.artifactSourceHash,
          expectedDestinationSourceHash: proposal.destinationSourceHash,
          store: value.store,
        }),
      ).rejects.toThrow(/changed after this proposal was reviewed/);
      expect(await readFile(file, "utf8")).toBe("// changed elsewhere\n");
    } finally {
      value.store.close();
      value.graph.close();
    }
  });
});
