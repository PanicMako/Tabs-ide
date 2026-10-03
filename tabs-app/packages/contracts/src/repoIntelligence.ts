/**
 * RepoIntelligence Contracts — Data structures for AST symbol indexing,
 * dependency graph extraction, file inventorying, and context packing.
 *
 * @module repoIntelligence
 */

import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SymbolKind = Schema.Literals([
  "function",
  "class",
  "interface",
  "type",
  "const",
  "method",
  "variable",
  "struct",
  "enum",
  "module",
]);
export type SymbolKind = typeof SymbolKind.Type;

export const RepoSymbolDefinition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  kind: SymbolKind,
  filePath: TrimmedNonEmptyString,
  startLine: Schema.Number,
  endLine: Schema.Number,
  startColumn: Schema.optional(Schema.Number),
  endColumn: Schema.optional(Schema.Number),
  isExported: Schema.Boolean,
  signature: Schema.optional(Schema.String),
  docComment: Schema.optional(Schema.String),
});
export type RepoSymbolDefinition = typeof RepoSymbolDefinition.Type;

export const RepoImportReference = Schema.Struct({
  sourceFile: TrimmedNonEmptyString,
  importedModule: TrimmedNonEmptyString,
  importedSymbols: Schema.Array(TrimmedNonEmptyString),
  isRelative: Schema.Boolean,
  resolvedFilePath: Schema.optional(TrimmedNonEmptyString),
  line: Schema.Number,
});
export type RepoImportReference = typeof RepoImportReference.Type;

export const RepoFileMetaData = Schema.Struct({
  filePath: TrimmedNonEmptyString,
  sizeBytes: Schema.Number,
  contentHash: TrimmedNonEmptyString, // SHA-256
  language: TrimmedNonEmptyString,
  lineCount: Schema.Number,
  symbols: Schema.Array(RepoSymbolDefinition),
  imports: Schema.Array(RepoImportReference),
  lastModifiedMs: Schema.Number,
});
export type RepoFileMetaData = typeof RepoFileMetaData.Type;

export const RepoFileInventory = Schema.Struct({
  repoPath: TrimmedNonEmptyString,
  totalFiles: Schema.Number,
  totalLines: Schema.Number,
  files: Schema.Array(RepoFileMetaData),
  ignoredPathsCount: Schema.Number,
  scannedAt: Schema.String,
});
export type RepoFileInventory = typeof RepoFileInventory.Type;

export const TokenBudgetedContextPack = Schema.Struct({
  targetScope: TrimmedNonEmptyString,
  packedChars: Schema.Number,
  budgetChars: Schema.Number,
  estimatedTokens: Schema.Number,
  primaryFileContent: Schema.String,
  symbolDefinitionsText: Schema.String,
  importedContextText: Schema.String,
  callerReferencesText: Schema.String,
  isComplete: Schema.Boolean,
  truncatedReason: Schema.optional(Schema.String),
  coverageRatio: Schema.Number, // 0.0 to 1.0
});
export type TokenBudgetedContextPack = typeof TokenBudgetedContextPack.Type;
