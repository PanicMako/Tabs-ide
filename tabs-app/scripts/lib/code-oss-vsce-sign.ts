import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Directories that can hold `@vscode/vsce-sign` in a Code-OSS source checkout.
 * Before 1.148 it was a direct dependency of `build/`, so pnpm linked it at
 * `build/node_modules/@vscode`. Since 1.148 it is only a dependency of
 * `@vscode/vsce`, and the isolated linker links it in pnpm's hidden hoist
 * directory, `build/node_modules/.pnpm/node_modules/@vscode`.
 */
export function vsceSignScopeCandidates(sourceRoot: string): string[] {
  const buildModules = path.join(sourceRoot, "build", "node_modules");
  return [
    path.join(buildModules, "@vscode"),
    path.join(buildModules, ".pnpm", "node_modules", "@vscode"),
  ];
}

/** The `@vscode` scope directory that holds the verifier, or undefined. */
export function findVsceSignScope(sourceRoot: string): string | undefined {
  return vsceSignScopeCandidates(sourceRoot).find((scope) =>
    fs.existsSync(path.join(scope, "vsce-sign", "src", "main.js")),
  );
}

/**
 * Copies `@vscode/vsce-sign` and its installed platform package into the
 * runtime's `node_modules/@vscode`. pnpm links them as symlinks, so the copy
 * dereferences them into real directories. Returns the copied package names.
 */
export function copyVsceSignModules(sourceRoot: string, runtimeRoot: string): string[] {
  const scope = findVsceSignScope(sourceRoot);
  if (!scope) {
    throw new Error(
      `@vscode/vsce-sign is missing from ${sourceRoot}/build/node_modules. ` +
        "Run `pnpm --dir build install` in tabs-code-oss.",
    );
  }
  const destination = path.join(runtimeRoot, "node_modules", "@vscode");
  fs.mkdirSync(destination, { recursive: true });
  const copied: string[] = [];
  for (const entry of fs.readdirSync(scope)) {
    if (!entry.startsWith("vsce-sign")) continue;
    fs.cpSync(path.join(scope, entry), path.join(destination, entry), {
      recursive: true,
      dereference: true,
    });
    copied.push(`@vscode/${entry}`);
  }
  return copied;
}
