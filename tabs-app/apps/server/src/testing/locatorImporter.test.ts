import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TestingGraphStore } from "./graphStore";
import { indexLocatorFolder } from "./locatorImporter";
import { LocatorLibraryStore } from "./locatorLibrary";

describe("static locator folder import", () => {
  it("reports recognized, warning, unsupported, and file coverage without execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-locator-import-"));
    const folder = join(root, "pages");
    await mkdir(folder);
    await writeFile(
      join(folder, "AccountPage.ts"),
      [
        "export class AccountPage {",
        "  save = this.page.getByRole('button', { name: 'Save' });",
        "  fragile = this.page.locator('.save').first();",
        "  dynamic = this.page.getByText(process.env.LABEL);",
        "}",
      ].join("\n"),
    );
    const databasePath = join(root, "testing.sqlite");
    const graph = new TestingGraphStore(databasePath);
    const library = new LocatorLibraryStore(databasePath);
    try {
      const result = await indexLocatorFolder({
        projectId: "project-a",
        projectPath: root,
        folderPath: folder,
        storageMode: "connected-repository",
        targetUrl: "https://example.test/account",
        store: library,
      });

      expect(result).toMatchObject({
        filesScanned: 1,
        filesParsed: 1,
        recognized: 1,
        warnings: 1,
        unsupportedDynamic: 1,
        fileParseCoverage: 100,
      });
      expect(result.recognitionRate).toBeCloseTo(100 / 3);
      expect(result.library.locatorCount).toBe(2);
    } finally {
      library.close();
      graph.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
