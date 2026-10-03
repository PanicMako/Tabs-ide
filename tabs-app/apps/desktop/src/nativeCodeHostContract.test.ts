import { readFileSync } from "node:fs";
import Path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

function collectNativeHostMethods(sourcePath: string): Set<string> {
  const source = readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const methods = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "ICommonNativeHostService") {
      for (const member of node.members) {
        if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) {
          methods.add(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return methods;
}

function collectHandledCommands(source: string): Set<string> {
  const commands = new Set<string>();
  for (const match of source.matchAll(/command\s*===\s*["']([^"']+)["']/g)) {
    commands.add(match[1]!);
  }
  for (const match of source.matchAll(/case\s*["']([^"']+)["']\s*:/g)) {
    commands.add(match[1]!);
  }
  return commands;
}

describe("embedded Code native-host contract", () => {
  it("gives every upstream callable method an explicit policy", () => {
    const repositoryRoot = Path.resolve(import.meta.dirname, "../../../..");
    const methods = collectNativeHostMethods(
      Path.join(repositoryRoot, "tabs-code-oss/src/vs/platform/native/common/native.ts"),
    );
    const implementation = [
      Path.join(import.meta.dirname, "nativeCodeHostMain.ts"),
      Path.join(import.meta.dirname, "nativeCodeHostCommand.ts"),
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const handled = collectHandledCommands(implementation);
    const missing = [...methods].filter((method) => !handled.has(method));

    expect(methods.size).toBe(104);
    expect(missing).toEqual([]);
  });
});
