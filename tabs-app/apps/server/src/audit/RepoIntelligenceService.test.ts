import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
  detectLanguage,
  extractASTSymbols,
  extractImports,
  buildRepositoryInventory,
  buildTokenBudgetedContextPack,
  getCachedFileMetadata,
} from "./RepoIntelligenceService.ts";

describe("RepoIntelligenceService Language Detector", () => {
  it("detects languages correctly from file extensions", () => {
    expect(detectLanguage("src/index.ts")).toBe("typescript");
    expect(detectLanguage("src/App.tsx")).toBe("typescriptreact");
    expect(detectLanguage("main.py")).toBe("python");
    expect(detectLanguage("main.go")).toBe("go");
    expect(detectLanguage("lib.rs")).toBe("rust");
    expect(detectLanguage("README.md")).toBe("markdown");
  });
});

describe("AST Symbol Extraction", () => {
  it("extracts TypeScript exported functions, classes, interfaces, and types", () => {
    const code = `
export function processOrder(id: string) { return id; }
export class PaymentManager {}
export interface OrderConfig { id: string; }
export type OrderStatus = "pending" | "shipped";
function internalHelper() {}
`;
    const symbols = extractASTSymbols("src/order.ts", code, "typescript");

    expect(symbols).toHaveLength(5);
    expect(symbols[0]?.name).toBe("processOrder");
    expect(symbols[0]?.kind).toBe("function");
    expect(symbols[0]?.isExported).toBe(true);

    expect(symbols[1]?.name).toBe("PaymentManager");
    expect(symbols[1]?.kind).toBe("class");

    expect(symbols[2]?.name).toBe("OrderConfig");
    expect(symbols[2]?.kind).toBe("interface");

    expect(symbols[4]?.name).toBe("internalHelper");
    expect(symbols[4]?.isExported).toBe(false);
  });

  it("extracts Python functions and classes", () => {
    const code = `
class UserAuth:
    pass

def validate_token(token):
    return True

def _private_calc():
    pass
`;
    const symbols = extractASTSymbols("auth.py", code, "python");
    expect(symbols).toHaveLength(3);
    expect(symbols[0]?.name).toBe("UserAuth");
    expect(symbols[0]?.kind).toBe("class");
    expect(symbols[1]?.name).toBe("validate_token");
    expect(symbols[1]?.isExported).toBe(true);
    expect(symbols[2]?.name).toBe("_private_calc");
    expect(symbols[2]?.isExported).toBe(false);
  });
});

describe("Import Extraction & Graph Resolution", () => {
  it("extracts TS imports and resolves relative file paths", () => {
    const code = `
import { OrderConfig } from "./types/order";
import React from "react";
`;
    const imports = extractImports("src/order.ts", code, "typescript");

    expect(imports).toHaveLength(2);
    expect(imports[0]?.importedModule).toBe("./types/order");
    expect(imports[0]?.isRelative).toBe(true);
    expect(imports[0]?.importedSymbols).toContain("OrderConfig");
    expect(imports[0]?.resolvedFilePath).toBe("src/types/order.ts");

    expect(imports[1]?.importedModule).toBe("react");
    expect(imports[1]?.isRelative).toBe(false);
  });
});

describe("Repository Inventory & Context Packer", () => {
  it("builds file inventory, obeys ignored directories, and packs context within budget", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-intel-test-"));
    const srcDir = path.join(tempDir, "src");
    const nodeModulesDir = path.join(tempDir, "node_modules");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(nodeModulesDir, { recursive: true });

    await fs.writeFile(path.join(srcDir, "main.ts"), "export function run() { return 42; }\n");
    await fs.writeFile(path.join(nodeModulesDir, "ignored.js"), "console.log('ignored');\n");

    const inventory = await buildRepositoryInventory({ cwd: tempDir });

    expect(inventory.totalFiles).toBe(1);
    expect(inventory.files[0]?.filePath).toBe("src/main.ts");
    expect(inventory.ignoredPathsCount).toBeGreaterThan(0);

    const pack = await buildTokenBudgetedContextPack({
      cwd: tempDir,
      inventory,
      targetFilePath: "src/main.ts",
      budgetChars: 1000,
    });

    expect(pack.targetScope).toBe("src/main.ts");
    expect(pack.isComplete).toBe(true);
    expect(pack.symbolDefinitionsText).toContain("run");

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
