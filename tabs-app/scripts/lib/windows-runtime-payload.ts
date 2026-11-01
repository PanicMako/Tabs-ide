import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export const WINDOWS_RUNTIME_MAX_FILES = 50_000;

/** Code-OSS classifies some modules used by our embedded runtime as dev-only. */
export function readAdditionalRuntimeDependencyPaths(sourceRoot: string): string[] {
  const manifestPath = path.join(sourceRoot, "remote", "package.json");
  const desktop = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const server = (
    fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {}
  ) as {
    dependencies?: Record<string, string>;
  };
  const result = new Set<string>();
  function collect(name: string, from: string, optional: boolean): void {
    let directory = from;
    while (true) {
      const candidate = path.join(directory, "node_modules", name);
      const manifest = path.join(candidate, "package.json");
      if (fs.existsSync(manifest)) {
        if (result.has(candidate)) return;
        result.add(candidate);
        const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };
        for (const child of Object.keys(pkg.dependencies ?? {}))
          collect(child, candidate, child in (pkg.optionalDependencies ?? {}));
        for (const child of Object.keys(pkg.optionalDependencies ?? {}))
          collect(child, candidate, true);
        return;
      }
      if (directory === sourceRoot) break;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (!optional) throw new Error(`Missing Code-OSS server runtime dependency: ${name}`);
  }
  for (const name of Object.keys(server.dependencies ?? {})) {
    if (!(name in (desktop.dependencies ?? {}))) collect(name, sourceRoot, false);
  }
  // Tabs embeds source product configuration without Microsoft's SDK CDN
  // metadata, so its agent host uses the local bare-import fallback.
  if (desktop.devDependencies?.["@anthropic-ai/claude-agent-sdk"]) {
    collect("@anthropic-ai/claude-agent-sdk", sourceRoot, false);
  }
  return [...result];
}

/** Use the same production dependency inventory as Code-OSS' packaging tasks. */
export function readProductionDependencyPaths(sourceRoot: string): string[] {
  const result = spawnSync("npm", ["ls", "--all", "--omit=dev", "--parseable"], {
    cwd: sourceRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  // npm also returns ELSPROBLEMS for installed prerelease versions that do not
  // satisfy their declared range. Accept those inventories, never missing deps.
  const errors = result.stderr.split(/\r?\n/).filter((line) => /^npm (?:error|ERR!)/.test(line));
  if (
    result.status !== 0 &&
    (errors.length === 0 ||
      errors.some(
        (line) => !/^npm (?:error|ERR!) (?:code ELSPROBLEMS|invalid:|A complete log)/.test(line),
      ))
  ) {
    throw new Error(`Cannot inventory Code-OSS production dependencies: ${result.stderr}`);
  }
  return validateProductionDependencyPaths(sourceRoot, [
    ...result.stdout.split(/\r?\n/),
    ...readAdditionalRuntimeDependencyPaths(sourceRoot),
  ]);
}

export function validateProductionDependencyPaths(sourceRoot: string, entries: string[]): string[] {
  const root = path.resolve(sourceRoot);
  const dependencies = [
    ...new Set(entries.filter((entry) => entry.trim() && path.resolve(entry) !== root)),
  ];
  if (dependencies.length === 0)
    throw new Error("Code-OSS production dependency inventory is empty.");
  for (const entry of dependencies) {
    const relative = path.relative(root, entry);
    if (
      !relative.startsWith(`node_modules${path.sep}`) ||
      relative.split(path.sep).includes("..")
    ) {
      throw new Error(`Production dependency is outside Code-OSS node_modules: ${entry}`);
    }
  }
  return dependencies;
}

export function copyWindowsProductionDependencies(
  sourceRoot: string,
  targetRoot: string,
  dependencies = readProductionDependencyPaths(sourceRoot),
): void {
  for (const dependency of validateProductionDependencyPaths(sourceRoot, dependencies)) {
    const target = path.join(targetRoot, path.relative(sourceRoot, dependency));
    // Nested dependencies are copied from the inventory separately. Copying a
    // whole nested node_modules would reintroduce development-only packages.
    fs.cpSync(dependency, target, {
      recursive: true,
      dereference: true,
      filter: (entry) => entry === dependency || path.basename(entry) !== "node_modules",
    });
  }
  fs.mkdirSync(path.join(targetRoot, "out-build"), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, "out"), { recursive: true });
  for (const name of ["nls.messages.json", "nls.messages.js"]) {
    const source = path.join(sourceRoot, "out-build", name);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(targetRoot, "out-build", name));
      // Tabs reads out-build; standalone server/extension-host bootstrap reads out.
      fs.copyFileSync(source, path.join(targetRoot, "out", name));
    }
  }
  if (!fs.existsSync(path.join(targetRoot, "out-build", "nls.messages.json"))) {
    throw new Error("Code-OSS localization messages are missing.");
  }
}

export function includeWindowsCompiledFile(sourceRoot: string, entry: string): boolean {
  const segments = path.relative(sourceRoot, entry).split(path.sep);
  return (
    !segments.some((segment) => segment === "test" || segment === "tests") &&
    !entry.endsWith(".map") &&
    !entry.endsWith(".tsbuildinfo")
  );
}

/** Remove debug data at build time; runtime JavaScript remains unchanged. */
export function stripInlineSourceMap(source: string): string {
  return source.replace(
    /\r?\n\/\/[#@] sourceMappingURL=data:application\/json(?:;charset=[\w-]+)?;base64,[A-Za-z0-9+/=]+(?:\r?\n)?$/,
    "\n",
  );
}

export function finalizeWindowsRuntimePayload(runtimeRoot: string): {
  files: number;
  bytes: number;
  sourceMapBytesRemoved: number;
} {
  const report = { files: 0, bytes: 0, sourceMapBytesRemoved: 0 };
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filename);
      } else if (entry.isFile()) {
        if (
          filename.startsWith(path.join(runtimeRoot, "out") + path.sep) &&
          filename.endsWith(".js")
        ) {
          const source = fs.readFileSync(filename, "utf8");
          const stripped = stripInlineSourceMap(source);
          if (stripped !== source) {
            fs.writeFileSync(filename, stripped);
            report.sourceMapBytesRemoved += Buffer.byteLength(source) - Buffer.byteLength(stripped);
          }
        }
        report.files++;
        report.bytes += fs.statSync(filename).size;
      }
    }
  }
  visit(runtimeRoot);
  if (report.files > WINDOWS_RUNTIME_MAX_FILES) {
    throw new Error(
      `Windows editor payload has ${report.files} files (limit ${WINDOWS_RUNTIME_MAX_FILES}). Review runtime packaging before shipping.`,
    );
  }
  fs.writeFileSync(
    path.join(runtimeRoot, "tabs-payload.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}

export function verifyWindowsRuntimePayload(runtimeRoot: string): void {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(runtimeRoot, "tabs-payload.json"), "utf8"),
  ) as {
    files: number;
  };
  if (
    !Number.isInteger(manifest.files) ||
    manifest.files < 1 ||
    manifest.files > WINDOWS_RUNTIME_MAX_FILES
  ) {
    throw new Error("Invalid Windows editor payload file budget.");
  }
  const allowedLocalizationFiles = new Set(["nls.messages.json", "nls.messages.js"]);
  for (const entry of fs.readdirSync(path.join(runtimeRoot, "out-build"))) {
    if (!allowedLocalizationFiles.has(entry))
      throw new Error(`Redundant Windows editor build output: ${entry}`);
  }
  for (const entry of ["remote", "out-vscode"]) {
    if (fs.existsSync(path.join(runtimeRoot, entry)))
      throw new Error(`Development runtime shipped: ${entry}`);
  }
  let files = 0;
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) files++;
    }
  }
  visit(runtimeRoot);
  if (files > WINDOWS_RUNTIME_MAX_FILES + 1)
    throw new Error(`Packaged Windows editor exceeds its file budget: ${files}`);
  const messages = JSON.parse(
    fs.readFileSync(path.join(runtimeRoot, "out-build", "nls.messages.json"), "utf8"),
  );
  if (!Array.isArray(messages) || messages.length === 0)
    throw new Error("Windows editor localization messages are invalid.");
}
