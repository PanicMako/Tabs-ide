import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import type { TestingTestInventoryNode, TestingTestInventoryResult } from "@tabs/contracts";
import * as ts from "typescript";

const SUPPORTED_TEST_FILE = /(?:^|\.)((?:spec)|(?:test))\.[cm]?[jt]sx?$/i;
const IGNORED_DIRECTORIES = new Set([".git", ".turbo", "build", "dist", "node_modules", "out"]);
const MAX_FILES = 2_000;

function testCallKind(expression: ts.Expression): "suite" | "test" | null {
  if (ts.isIdentifier(expression)) {
    if (expression.text === "describe") return "suite";
    if (expression.text === "test" || expression.text === "it") return "test";
    return null;
  }
  if (!ts.isPropertyAccessExpression(expression)) return null;
  if (expression.name.text === "describe") return "suite";
  const baseKind = testCallKind(expression.expression);
  if (baseKind === "suite") return "suite";
  if (baseKind === "test") return "test";
  return null;
}

function stringTitle(call: ts.CallExpression): string | null {
  const first = call.arguments[0];
  return first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
    ? first.text.trim()
    : null;
}

function scanFile(projectRoot: string, filePath: string): TestingTestInventoryNode | null {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const fileId = `repository:file:${relative(projectRoot, filePath)}`;
  const visit = (node: ts.Node, parentId: string): ReadonlyArray<TestingTestInventoryNode> => {
    const results: TestingTestInventoryNode[] = [];
    ts.forEachChild(node, (child) => {
      if (ts.isCallExpression(child)) {
        const kind = testCallKind(child.expression);
        const title = kind ? stringTitle(child) : null;
        if (kind && title) {
          const line = source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1;
          const id = `${fileId}:${line}:${kind}:${title}`;
          const nested = kind === "suite" ? visit(child, id) : [];
          results.push({
            id,
            parentId,
            kind,
            label: title,
            source: "repository",
            status: "unknown",
            filePath,
            line,
            externalCaseId: title.match(/\b(?:TC-|QA-)?\d{2,}\b/i)?.[0] ?? null,
            runnable: kind === "test",
            children: nested,
          });
          return;
        }
      }
      results.push(...visit(child, parentId));
    });
    return results;
  };
  const children = visit(source, fileId);
  if (children.length === 0) return null;
  return {
    id: fileId,
    parentId: "repository",
    kind: "file",
    label: relative(projectRoot, filePath),
    source: "repository",
    status: "unknown",
    filePath,
    line: 1,
    externalCaseId: null,
    runnable: false,
    children,
  };
}

export function scanTestingInventory(input: {
  readonly projectId: string;
  readonly projectPath: string;
  readonly managedCases: ReadonlyArray<{
    readonly id: string;
    readonly externalId: string;
    readonly description: string;
    readonly status: string;
  }>;
}): TestingTestInventoryResult {
  const projectRoot = resolve(input.projectPath);
  if (!statSync(projectRoot).isDirectory()) throw new Error("Testing project path is not a folder");
  const files: string[] = [];
  const walk = (directory: string) => {
    if (files.length >= MAX_FILES) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name);
      const relativePath = relative(projectRoot, absolute);
      if (relativePath.startsWith("..")) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(absolute);
      } else if (SUPPORTED_TEST_FILE.test(entry.name)) {
        files.push(absolute);
      }
      if (files.length >= MAX_FILES) break;
    }
  };
  walk(projectRoot);

  const warnings: string[] = [];
  const repositoryChildren = files.flatMap((filePath) => {
    try {
      const node = scanFile(projectRoot, filePath);
      return node ? [node] : [];
    } catch (error) {
      warnings.push(
        `${relative(projectRoot, filePath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  });
  const managedChildren: TestingTestInventoryNode[] = input.managedCases.map((testCase) => ({
    id: `managed:${testCase.id}`,
    parentId: "managed",
    kind: "case",
    label: `${testCase.externalId}: ${testCase.description}`,
    source: "managed",
    status:
      testCase.status === "matches"
        ? "passed"
        : testCase.status === "blocked"
          ? "failed"
          : "unknown",
    filePath: null,
    line: null,
    externalCaseId: testCase.externalId,
    runnable: true,
    children: [],
  }));
  const root = (
    id: string,
    label: string,
    source: "managed" | "repository",
    children: ReadonlyArray<TestingTestInventoryNode>,
  ): TestingTestInventoryNode => ({
    id,
    parentId: null,
    kind: "root",
    label,
    source,
    status: "unknown",
    filePath: null,
    line: null,
    externalCaseId: null,
    runnable: false,
    children,
  });
  return {
    projectId: input.projectId,
    generatedAt: new Date().toISOString(),
    repositoryFilesScanned: files.length,
    parseWarnings: warnings,
    editorProviderConnected: false,
    roots: [
      root("managed", "Managed and imported cases", "managed", managedChildren),
      root(
        "repository",
        `Repository tests (${basename(projectRoot)})`,
        "repository",
        repositoryChildren,
      ),
    ],
  };
}
