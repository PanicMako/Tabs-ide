import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type {
  TestingLocatorFolderResult,
  TestingLocatorImportWarning,
  TestingLocatorStorageMode,
} from "@tabs/contracts";
import * as ts from "typescript";

import type { LocatorCandidate } from "./locatorLibrary";
import { LocatorLibraryStore } from "./locatorLibrary";

const SUPPORTED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;
const LOCATOR_METHODS = new Set([
  "getByRole",
  "getByLabel",
  "getByTestId",
  "getByText",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "locator",
]);

function staysInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

async function sourceFiles(folderPath: string): Promise<ReadonlyArray<string>> {
  const root = await realpath(folderPath);
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = resolve(directory, entry.name);
      if (!staysInside(root, path)) continue;
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        await visit(path);
      } else if (SUPPORTED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        files.push(path);
      }
    }
  };
  await visit(root);
  return files.toSorted();
}

function staticString(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isRegularExpressionLiteral(node)) return node.text;
  return null;
}

function objectString(object: ts.Expression | undefined, propertyName: string): string | null {
  if (!object || !ts.isObjectLiteralExpression(object)) return null;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText().replace(/^['"]|['"]$/g, "");
    if (name === propertyName) return staticString(property.initializer);
  }
  return null;
}

function assignedName(node: ts.CallExpression, fallback: string): string {
  const parent = node.parent;
  if (ts.isPropertyDeclaration(parent) && parent.name) return parent.name.getText();
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isBinaryExpression(parent) && ts.isPropertyAccessExpression(parent.left)) {
    return parent.left.name.text;
  }
  return fallback;
}

function normalizedKey(value: string): string {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "repository-locator"
  );
}

function pageNameForFile(file: string): string {
  const base = (file.split("/").at(-1) ?? "Page")
    .replace(/\.[^.]+$/u, "")
    .replace(/(?:PageObject|Page|POM)$/iu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  const label = (base || "Imported")
    .split(/\s+/u)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
  return `${label} page`;
}

function parseLocatorCall(
  node: ts.CallExpression,
  file: string,
  sourceFile: ts.SourceFile,
): {
  candidate?: LocatorCandidate;
  warning?: TestingLocatorImportWarning;
  unsupported?: boolean;
} | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text;
  if (!LOCATOR_METHODS.has(method)) return null;
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const first = staticString(node.arguments[0]);
  const fallback = first ? `${method}-${first}` : method;
  const source = { sourceFile: file, sourceLine: line };
  if (method === "getByRole") {
    const name = objectString(node.arguments[1], "name");
    if (!first || !name) {
      return {
        unsupported: true,
        warning: {
          file,
          line,
          category: "unsupported-dynamic",
          message: "getByRole requires static role and accessible-name values for safe import",
        },
      };
    }
    return {
      candidate: {
        locatorKey: normalizedKey(assignedName(node, fallback)),
        classification: "action",
        strategy: "role",
        arguments: { role: first, name },
        semanticContext: `${first} ${name}`,
        source: "repository",
        ...source,
      },
    };
  }
  if (!first) {
    return {
      unsupported: true,
      warning: {
        file,
        line,
        category: "unsupported-dynamic",
        message: `${method} uses a dynamic expression that cannot be indexed without executing code`,
      },
    };
  }
  const mapping = {
    getByLabel: ["label", "label"],
    getByTestId: ["test-id", "testId"],
    getByText: ["text", "text"],
    getByPlaceholder: ["placeholder", "placeholder"],
    getByAltText: ["alt-text", "altText"],
    getByTitle: ["title", "title"],
    locator: ["css", "selector"],
  } as const;
  const mapped = mapping[method as keyof typeof mapping];
  if (!mapped) return null;
  const fragile =
    method === "locator" || /\.\s*(?:first|last|nth)\s*\(/.test(node.parent.getText(sourceFile));
  return {
    candidate: {
      locatorKey: normalizedKey(assignedName(node, fallback)),
      classification: method === "getByText" || method === "getByTitle" ? "assertion" : "action",
      strategy: mapped[0],
      arguments: { [mapped[1]]: first },
      semanticContext: `${method} ${first}`,
      source: "repository",
      fragile,
      lifecycleStatus: fragile ? "draft" : "accepted",
      ...source,
    },
    ...(fragile
      ? {
          warning: {
            file,
            line,
            category: "warning" as const,
            message: "Implementation-detail or positional locator requires review",
          },
        }
      : {}),
  };
}

export async function indexLocatorFolder(input: {
  readonly projectId: string;
  readonly projectPath: string;
  readonly folderPath: string;
  readonly storageMode: TestingLocatorStorageMode;
  readonly targetUrl: string | null;
  readonly store: LocatorLibraryStore;
}): Promise<TestingLocatorFolderResult> {
  const projectRoot = await realpath(input.projectPath);
  const folderRoot = await realpath(input.folderPath);
  if (!staysInside(projectRoot, folderRoot)) {
    throw new Error("The locator folder must stay inside the selected project");
  }
  const files = await sourceFiles(folderRoot);
  const details: TestingLocatorImportWarning[] = [];
  let filesParsed = 0;
  let recognized = 0;
  let warnings = 0;
  let unsupportedDynamic = 0;
  let linked = 0;
  let repositoryOnly = 0;
  let conflicts = 0;
  const repositoryEntryIds = new Set<string>();
  for (const absoluteFile of files) {
    const file = relative(projectRoot, absoluteFile).replaceAll(sep, "/");
    let sourceFile: ts.SourceFile;
    try {
      const sourceText = await readFile(absoluteFile, "utf8");
      sourceFile = ts.createSourceFile(
        file,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        absoluteFile.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const parseDiagnostics =
        (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
          .parseDiagnostics ?? [];
      if (parseDiagnostics.length > 0) {
        details.push({
          file,
          line: null,
          category: "parse-error",
          message: String(parseDiagnostics[0]?.messageText ?? "Could not parse file"),
        });
        continue;
      }
      filesParsed += 1;
    } catch (error) {
      details.push({
        file,
        line: null,
        category: "parse-error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "filter"
        ) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          warnings += 1;
          details.push({
            file,
            line,
            category: "warning",
            message: "Filtered locator imported with its static base; review the filter scope",
          });
        }
        const parsed = parseLocatorCall(node, file, sourceFile);
        if (parsed?.warning) {
          details.push(parsed.warning);
          if (parsed.unsupported) unsupportedDynamic += 1;
          else warnings += 1;
        }
        if (parsed?.candidate) {
          if (!parsed.warning) recognized += 1;
          const result = input.store.addRepositoryCandidate({
            projectId: input.projectId,
            rawUrl: `https://repository.invalid/${file
              .replace(/\.[^.]+$/u, "")
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`,
            pageName: pageNameForFile(file),
            environmentLabel: "repository",
            candidate: parsed.candidate,
            storageMode: input.storageMode,
          });
          repositoryEntryIds.add(result.entryId);
          if (result.linked) linked += 1;
          else if (result.conflict) conflicts += 1;
          else repositoryOnly += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const managedOnly = input.store.markManagedOnly(input.projectId, repositoryEntryIds);
  input.store.saveSource({
    projectId: input.projectId,
    folderPath: folderRoot,
    storageMode: input.storageMode,
    filesScanned: files.length,
    filesParsed,
    recognized,
    warnings,
    unsupportedDynamic,
    details,
  });
  const denominator = recognized + warnings + unsupportedDynamic;
  return {
    filesScanned: files.length,
    filesParsed,
    recognized,
    warnings,
    unsupportedDynamic,
    recognitionRate: denominator === 0 ? null : (recognized / denominator) * 100,
    fileParseCoverage: files.length === 0 ? null : (filesParsed / files.length) * 100,
    linked,
    repositoryOnly,
    managedOnly,
    conflicts,
    details,
    library: input.store.library(input.projectId),
  };
}
