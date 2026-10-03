import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, assert, describe, it, vi } from "vitest";

import { searchWorkspaceContents, searchWorkspaceEntries } from "./workspaceEntries";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(cwd: string, relativePath: string, contents = ""): void {
  const absolutePath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}

describe("searchWorkspaceEntries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns files and directories relative to cwd", async () => {
    const cwd = makeTempDir("tabs-workspace-entries-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/index.ts");
    writeFile(cwd, "README.md");
    writeFile(cwd, ".git/HEAD");
    writeFile(cwd, "node_modules/pkg/index.js");

    const result = await searchWorkspaceEntries({ cwd, query: "", limit: 100 });
    const paths = result.entries.map((entry) => entry.path);

    assert.include(paths, "src");
    assert.include(paths, "src/components");
    assert.include(paths, "src/components/Composer.tsx");
    assert.include(paths, "README.md");
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith(".git")));
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith("node_modules")));
    assert.isFalse(result.truncated);
  });

  it("filters and ranks entries by query", async () => {
    const cwd = makeTempDir("tabs-workspace-query-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/components/composePrompt.ts");
    writeFile(cwd, "docs/composition.md");

    const result = await searchWorkspaceEntries({ cwd, query: "compo", limit: 5 });

    assert.isAbove(result.entries.length, 0);
    assert.isTrue(result.entries.some((entry) => entry.path === "src/components"));
    assert.isTrue(result.entries.every((entry) => entry.path.toLowerCase().includes("compo")));
  });

  it("supports fuzzy subsequence queries for composer path search", async () => {
    const cwd = makeTempDir("tabs-workspace-fuzzy-query-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/components/composePrompt.ts");
    writeFile(cwd, "docs/composition.md");

    const result = await searchWorkspaceEntries({ cwd, query: "cmp", limit: 10 });
    const paths = result.entries.map((entry) => entry.path);

    assert.isAbove(result.entries.length, 0);
    assert.include(paths, "src/components");
    assert.include(paths, "src/components/Composer.tsx");
  });

  it("tracks truncation without sorting every fuzzy match", async () => {
    const cwd = makeTempDir("tabs-workspace-fuzzy-limit-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/components/composePrompt.ts");
    writeFile(cwd, "docs/composition.md");

    const result = await searchWorkspaceEntries({ cwd, query: "cmp", limit: 1 });

    assert.lengthOf(result.entries, 1);
    assert.isTrue(result.truncated);
  });

  it("excludes gitignored paths for git repositories", async () => {
    const cwd = makeTempDir("tabs-workspace-gitignore-");
    runGit(cwd, ["init"]);
    writeFile(cwd, ".gitignore", ".convex/\nconvex/\nignored.txt\n");
    writeFile(cwd, "src/keep.ts", "export {};");
    writeFile(cwd, "ignored.txt", "ignore me");
    writeFile(cwd, ".convex/local-storage/data.json", "{}");
    writeFile(cwd, "convex/UOoS-l/convex_local_storage/modules/data.json", "{}");

    const result = await searchWorkspaceEntries({ cwd, query: "", limit: 100 });
    const paths = result.entries.map((entry) => entry.path);

    assert.include(paths, "src");
    assert.include(paths, "src/keep.ts");
    assert.notInclude(paths, "ignored.txt");
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith(".convex/")));
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith("convex/")));
  });

  it("excludes tracked paths that match ignore rules", async () => {
    const cwd = makeTempDir("tabs-workspace-tracked-gitignore-");
    runGit(cwd, ["init"]);
    writeFile(cwd, ".convex/local-storage/data.json", "{}");
    writeFile(cwd, "src/keep.ts", "export {};");
    runGit(cwd, ["add", ".convex/local-storage/data.json", "src/keep.ts"]);
    writeFile(cwd, ".gitignore", ".convex/\n");

    const result = await searchWorkspaceEntries({ cwd, query: "", limit: 100 });
    const paths = result.entries.map((entry) => entry.path);

    assert.include(paths, "src");
    assert.include(paths, "src/keep.ts");
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith(".convex/")));
  });

  it("excludes .convex in non-git workspaces", async () => {
    const cwd = makeTempDir("tabs-workspace-non-git-convex-");
    writeFile(cwd, ".convex/local-storage/data.json", "{}");
    writeFile(cwd, "src/keep.ts", "export {};");

    const result = await searchWorkspaceEntries({ cwd, query: "", limit: 100 });
    const paths = result.entries.map((entry) => entry.path);

    assert.include(paths, "src");
    assert.include(paths, "src/keep.ts");
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith(".convex/")));
  });

  it("deduplicates concurrent index builds for the same cwd", async () => {
    const cwd = makeTempDir("tabs-workspace-concurrent-build-");
    writeFile(cwd, "src/components/Composer.tsx");

    let rootReadCount = 0;
    const originalReaddir = fsPromises.readdir.bind(fsPromises);
    vi.spyOn(fsPromises, "readdir").mockImplementation((async (
      ...args: Parameters<typeof fsPromises.readdir>
    ) => {
      if (args[0] === cwd) {
        rootReadCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return originalReaddir(...args);
    }) as typeof fsPromises.readdir);

    await Promise.all([
      searchWorkspaceEntries({ cwd, query: "", limit: 100 }),
      searchWorkspaceEntries({ cwd, query: "comp", limit: 100 }),
      searchWorkspaceEntries({ cwd, query: "src", limit: 100 }),
    ]);

    assert.equal(rootReadCount, 1);
  });

  it("limits concurrent directory reads while walking the filesystem", async () => {
    const cwd = makeTempDir("tabs-workspace-read-concurrency-");
    for (let index = 0; index < 80; index += 1) {
      writeFile(cwd, `group-${index}/entry-${index}.ts`, "export {};");
    }

    let activeReads = 0;
    let peakReads = 0;
    const originalReaddir = fsPromises.readdir.bind(fsPromises);
    vi.spyOn(fsPromises, "readdir").mockImplementation((async (
      ...args: Parameters<typeof fsPromises.readdir>
    ) => {
      const target = args[0];
      if (typeof target === "string" && target.startsWith(cwd)) {
        activeReads += 1;
        peakReads = Math.max(peakReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 4));
        try {
          return await originalReaddir(...args);
        } finally {
          activeReads -= 1;
        }
      }
      return originalReaddir(...args);
    }) as typeof fsPromises.readdir);

    await searchWorkspaceEntries({ cwd, query: "", limit: 200 });

    assert.isAtMost(peakReads, 32);
  });
});

describe("searchWorkspaceContents", () => {
  it("searches file contents matching case-insensitively and returns matchRanges", async () => {
    const cwd = makeTempDir("ws-search-contents-");
    writeFile(cwd, "src/hello.ts", "const greeting = 'Hello World';\nconsole.log(greeting);\n");
    writeFile(cwd, "src/other.ts", "const test = 123;\n");

    const result = await searchWorkspaceContents({
      cwd,
      query: "hello",
      limit: 10,
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
    });

    assert.strictEqual(result.matches.length, 1);
    const firstMatch = result.matches[0]!;
    assert.strictEqual(firstMatch.path, "src/hello.ts");
    assert.strictEqual(firstMatch.lineNumber, 1);
    assert.strictEqual(firstMatch.lineContent, "const greeting = 'Hello World';");
    assert.deepEqual(firstMatch.matchRanges, [{ start: 18, end: 23 }]);
    assert.strictEqual(result.truncated, false);
  });

  it("respects case sensitivity and whole word filters", async () => {
    const cwd = makeTempDir("ws-search-contents-case-");
    writeFile(cwd, "test.txt", "Foo foobar FOO foo\n");

    const caseMatch = await searchWorkspaceContents({
      cwd,
      query: "FOO",
      limit: 10,
      caseSensitive: true,
      wholeWord: false,
      useRegex: false,
    });
    assert.strictEqual(caseMatch.matches.length, 1);
    assert.strictEqual(caseMatch.matches[0]!.matchRanges.length, 1);

    const wholeWordMatch = await searchWorkspaceContents({
      cwd,
      query: "foo",
      limit: 10,
      caseSensitive: false,
      wholeWord: true,
      useRegex: false,
    });
    // Should match "Foo", "FOO", "foo" but NOT "foobar"
    assert.strictEqual(wholeWordMatch.matches.length, 1);
    assert.strictEqual(wholeWordMatch.matches[0]!.matchRanges.length, 3);
  });

  it("supports regular expressions and falls back safely on invalid regex", async () => {
    const cwd = makeTempDir("ws-search-contents-regex-");
    writeFile(cwd, "code.ts", "const a = 1;\nlet b = 2;\nvar c = 3;\n");

    const regexMatch = await searchWorkspaceContents({
      cwd,
      query: "(const|let)\\s+[a-z]",
      limit: 10,
      caseSensitive: false,
      wholeWord: false,
      useRegex: true,
    });
    assert.strictEqual(regexMatch.matches.length, 2);

    const invalidRegex = await searchWorkspaceContents({
      cwd,
      query: "[unclosed",
      limit: 10,
      caseSensitive: false,
      wholeWord: false,
      useRegex: true,
    });
    assert.isDefined(invalidRegex.regexFallbackError);
    assert.strictEqual(invalidRegex.matches.length, 0);
  });
});
