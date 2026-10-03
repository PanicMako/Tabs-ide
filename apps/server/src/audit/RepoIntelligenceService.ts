/**
 * RepoIntelligenceService — AST Symbol Indexing, Dependency Graph Extraction,
 * SHA-256 Content-Addressed Caching & Token-Budgeted Context Packing.
 *
 * @module audit/RepoIntelligenceService
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import type {
  RepoFileInventory,
  RepoFileMetaData,
  RepoImportReference,
  RepoSymbolDefinition,
  SymbolKind,
  TokenBudgetedContextPack,
} from "@tabs/contracts";
import { loadTabsReviewJson } from "../repoContext/RepoContextService.ts";
import { runProcess } from "../processRunner.ts";

export const DEFAULT_CONTEXT_BUDGET_CHARS = 16_000; // ~4,000 tokens

export const IGNORED_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  ".vscode",
  ".idea",
  "coverage",
]);

// ---------------------------------------------------------------------------
// In-memory SHA-256 Content-Addressed Cache
// ---------------------------------------------------------------------------

const contentHashCache = new Map<string, RepoFileMetaData>();

export function getCachedFileMetadata(hash: string): RepoFileMetaData | undefined {
  return contentHashCache.get(hash);
}

export function setCachedFileMetadata(hash: string, metadata: RepoFileMetaData): void {
  contentHashCache.set(hash, metadata);
}

// ---------------------------------------------------------------------------
// Language Detection
// ---------------------------------------------------------------------------

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    case ".c":
    case ".h":
      return "c";
    case ".cpp":
    case ".hpp":
    case ".cc":
    case ".cxx":
      return "cpp";
    case ".json":
      return "json";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".md":
    case ".mdx":
      return "markdown";
    case ".sql":
      return "sql";
    case ".sh":
    case ".bash":
    case ".zsh":
      return "shell";
    default:
      return "plaintext";
  }
}

// ---------------------------------------------------------------------------
// AST Symbol Parser Engine (Deterministic AST Extraction)
// ---------------------------------------------------------------------------

export function extractASTSymbols(
  filePath: string,
  content: string,
  language: string,
): RepoSymbolDefinition[] {
  const lines = content.split("\n");
  const symbols: RepoSymbolDefinition[] = [];

  if (
    language === "typescript" ||
    language === "typescriptreact" ||
    language === "javascript" ||
    language === "javascriptreact"
  ) {
    const tsSymbolRe =
      /^(export\s+)?(async\s+|abstract\s+|declare\s+)*(function|class|interface|type|const|let|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const m = tsSymbolRe.exec(line);
      if (m) {
        const isExported = Boolean(m[1]);
        const keyword = m[3]!;
        const name = m[4]!;

        let kind: SymbolKind = "variable";
        if (keyword === "function") kind = "function";
        else if (keyword === "class") kind = "class";
        else if (keyword === "interface") kind = "interface";
        else if (keyword === "type") kind = "type";
        else if (keyword === "enum") kind = "enum";
        else if (keyword === "const") kind = "const";

        // Find end line by bracket counting heuristic or next line
        let endLine = i + 1;
        let braceCount = 0;
        let foundOpen = false;

        for (let j = i; j < Math.min(i + 200, lines.length); j++) {
          const l = lines[j]!;
          if (l.includes("{")) {
            braceCount += (l.match(/\{/g) || []).length;
            foundOpen = true;
          }
          if (l.includes("}")) {
            braceCount -= (l.match(/\}/g) || []).length;
          }
          if (foundOpen && braceCount <= 0) {
            endLine = j + 1;
            break;
          }
        }

        symbols.push({
          id: `${filePath}#${name}`,
          name,
          kind,
          filePath,
          startLine: i + 1,
          endLine: Math.max(i + 1, endLine),
          isExported,
          signature: line.slice(0, 120),
        });
      }
    }
  } else if (language === "python") {
    const pySymbolRe = /^(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const m = pySymbolRe.exec(line);
      if (m) {
        const keyword = m[1]!;
        const name = m[2]!;
        const kind: SymbolKind = keyword === "class" ? "class" : "function";
        const isExported = !name.startsWith("_");

        symbols.push({
          id: `${filePath}#${name}`,
          name,
          kind,
          filePath,
          startLine: i + 1,
          endLine: i + 1,
          isExported,
          signature: line,
        });
      }
    }
  } else if (language === "go") {
    const goSymbolRe =
      /^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)|^type\s+([A-Za-z0-9_]+)\s+(struct|interface)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const m = goSymbolRe.exec(line);
      if (m) {
        const name = m[1] || m[2] || "unknown";
        const isExported = /^[A-Z]/.test(name);
        const kind: SymbolKind =
          m[3] === "interface" ? "interface" : m[3] === "struct" ? "struct" : "function";

        symbols.push({
          id: `${filePath}#${name}`,
          name,
          kind,
          filePath,
          startLine: i + 1,
          endLine: i + 1,
          isExported,
          signature: line,
        });
      }
    }
  }

  return symbols;
}

// ---------------------------------------------------------------------------
// Import Dependency Extractor
// ---------------------------------------------------------------------------

export function extractImports(
  filePath: string,
  content: string,
  language: string,
): RepoImportReference[] {
  const lines = content.split("\n");
  const imports: RepoImportReference[] = [];

  if (language.includes("typescript") || language.includes("javascript")) {
    const importRe =
      /import\s+?(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z0-9_$]+))\s+from\s+["']([^"']+)["']/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const m = importRe.exec(line);
      if (m) {
        const namedSymbols = m[1]
          ? m[1]
              .split(",")
              .map((s) => s.trim().split(" as ")[0]!)
              .filter(Boolean)
          : [];
        const defaultSymbol = m[2] ? [m[2].trim()] : [];
        const modulePath = m[3]!;
        const isRelative = modulePath.startsWith("./") || modulePath.startsWith("../");

        let resolvedFilePath: string | undefined = undefined;
        if (isRelative) {
          const dir = path.dirname(filePath);
          const rawResolved = path.normalize(path.join(dir, modulePath)).replace(/\\/g, "/");
          resolvedFilePath =
            rawResolved.endsWith(".ts") ||
            rawResolved.endsWith(".tsx") ||
            rawResolved.endsWith(".js")
              ? rawResolved
              : `${rawResolved}.ts`;
        }

        imports.push({
          sourceFile: filePath,
          importedModule: modulePath,
          importedSymbols: [...defaultSymbol, ...namedSymbols],
          isRelative,
          ...(resolvedFilePath ? { resolvedFilePath } : {}),
          line: i + 1,
        });
      }
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Repository File Inventory & AST Index Builder
// ---------------------------------------------------------------------------

export interface InventoryOptions {
  readonly cwd: string;
  readonly maxFiles?: number | undefined;
  readonly excludedPaths?: ReadonlyArray<string> | undefined;
}

export async function buildRepositoryInventory(
  options: InventoryOptions,
): Promise<RepoFileInventory> {
  const repoPath = path.resolve(options.cwd).replace(/\\/g, "/");
  const maxFiles = options.maxFiles ?? 10_000;

  // Load .tabs-review.json rules
  const tabsReview = loadTabsReviewJson(repoPath);
  const extraExcludes = new Set([
    ...(options.excludedPaths ?? []),
    ...(tabsReview.config?.excludedPaths ?? []),
  ]);

  const files: RepoFileMetaData[] = [];
  let ignoredPathsCount = 0;
  let totalLines = 0;

  async function walkDir(currentDir: string): Promise<void> {
    if (files.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(repoPath, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || extraExcludes.has(relPath)) {
          ignoredPathsCount++;
          continue;
        }
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        if (extraExcludes.has(relPath)) {
          ignoredPathsCount++;
          continue;
        }

        let content: string;
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(fullPath);
          // Skip binary or giant files (> 2MB)
          if (stat.size > 2 * 1024 * 1024) {
            ignoredPathsCount++;
            continue;
          }
          content = await fs.promises.readFile(fullPath, "utf8");
        } catch {
          continue;
        }

        // SHA-256 hash for content-addressed caching
        const contentHash = crypto.createHash("sha256").update(content).digest("hex");
        const cached = getCachedFileMetadata(contentHash);

        if (cached) {
          files.push(cached);
          totalLines += cached.lineCount;
          continue;
        }

        const language = detectLanguage(relPath);
        const lineCount = content.split("\n").length;
        totalLines += lineCount;

        const symbols = extractASTSymbols(relPath, content, language);
        const imports = extractImports(relPath, content, language);

        const meta: RepoFileMetaData = {
          filePath: relPath,
          sizeBytes: stat.size,
          contentHash,
          language,
          lineCount,
          symbols,
          imports,
          lastModifiedMs: stat.mtimeMs,
        };

        setCachedFileMetadata(contentHash, meta);
        files.push(meta);
      }
    }
  }

  await walkDir(repoPath);

  return {
    repoPath,
    totalFiles: files.length,
    totalLines,
    files,
    ignoredPathsCount,
    scannedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Token-Budgeted Context Packer
// ---------------------------------------------------------------------------

export interface ContextPackerInput {
  readonly cwd: string;
  readonly inventory: RepoFileInventory;
  readonly targetFilePath: string;
  readonly budgetChars?: number | undefined;
}

export async function buildTokenBudgetedContextPack(
  input: ContextPackerInput,
): Promise<TokenBudgetedContextPack> {
  const budgetChars = input.budgetChars ?? DEFAULT_CONTEXT_BUDGET_CHARS;
  const normTarget = input.targetFilePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const targetMeta = input.inventory.files.find((f) => f.filePath === normTarget);

  let primaryFileContent = "";
  const fullPath = path.join(input.cwd, normTarget);
  try {
    primaryFileContent = await fs.promises.readFile(fullPath, "utf8");
  } catch {
    primaryFileContent = `// File '${normTarget}' could not be read.`;
  }

  // 1. AST Symbol Summary
  const symbols = targetMeta?.symbols ?? [];
  const symbolDefsText =
    symbols.length > 0
      ? symbols
          .map(
            (s) =>
              `- ${s.kind} ${s.name} (L${s.startLine}-L${s.endLine}) ${s.isExported ? "[exported]" : ""}`,
          )
          .join("\n")
      : "No AST symbols extracted.";

  // 2. Imported Symbol Definitions from Dependencies
  const importsTextLines: string[] = [];
  if (targetMeta && targetMeta.imports.length > 0) {
    for (const imp of targetMeta.imports) {
      if (imp.resolvedFilePath) {
        const depMeta = input.inventory.files.find((f) => f.filePath === imp.resolvedFilePath);
        if (depMeta && depMeta.symbols.length > 0) {
          const exported = depMeta.symbols
            .filter((s) => s.isExported)
            .map((s) => s.name)
            .join(", ");
          importsTextLines.push(`Dependency '${imp.resolvedFilePath}': exports [${exported}]`);
        }
      }
    }
  }
  const importedContextText =
    importsTextLines.length > 0 ? importsTextLines.join("\n") : "No local dependencies.";

  // 3. Reverse Callers (Files that import targetFilePath)
  const callerFiles = input.inventory.files
    .filter((f) =>
      f.imports.some(
        (imp) => imp.resolvedFilePath === normTarget || imp.importedModule.includes(normTarget),
      ),
    )
    .map((f) => f.filePath);
  const callerReferencesText =
    callerFiles.length > 0 ? `Callers: ${callerFiles.join(", ")}` : "No callers detected.";

  // Packing & Compression
  let totalChars =
    primaryFileContent.length +
    symbolDefsText.length +
    importedContextText.length +
    callerReferencesText.length;
  let isComplete = true;
  let truncatedReason: string | undefined = undefined;

  if (totalChars > budgetChars) {
    isComplete = false;
    const maxPrimaryLen = Math.max(1_000, budgetChars - 3_000);
    primaryFileContent =
      primaryFileContent.slice(0, maxPrimaryLen) +
      "\n[... file content truncated to fit token budget ...]";
    truncatedReason = `Context packed to fit ${budgetChars} char budget limit (~${Math.round(budgetChars / 4)} tokens).`;
    totalChars = budgetChars;
  }

  const coverageRatio = isComplete ? 1.0 : Math.round((budgetChars / totalChars) * 100) / 100;

  return {
    targetScope: normTarget,
    packedChars: totalChars,
    budgetChars,
    estimatedTokens: Math.round(totalChars / 4),
    primaryFileContent,
    symbolDefinitionsText: symbolDefsText,
    importedContextText,
    callerReferencesText,
    isComplete,
    ...(truncatedReason ? { truncatedReason } : {}),
    coverageRatio,
  };
}

// ---------------------------------------------------------------------------
// Effect Entry Points
// ---------------------------------------------------------------------------

export const runRepoInventory = (options: InventoryOptions): Effect.Effect<RepoFileInventory> =>
  Effect.promise(() => buildRepositoryInventory(options));

export const runContextPacker = (
  input: ContextPackerInput,
): Effect.Effect<TokenBudgetedContextPack> =>
  Effect.promise(() => buildTokenBudgetedContextPack(input));
