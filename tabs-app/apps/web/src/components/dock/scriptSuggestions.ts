/**
 * Commands the Dock suggests for an empty project: the project's own scripts
 * (package.json, Cargo, Go), written for the package manager it uses.
 */
export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export interface ScriptSuggestion {
  /** Stable key, also the preset label. */
  readonly name: string;
  readonly command: string;
  /** What the script runs, shown as a hint. */
  readonly detail: string;
}

/** Root files that tell us which package manager and toolchain the project uses. */
export const SCRIPT_MARKER_FILES = [
  "package.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "Cargo.toml",
  "go.mod",
] as const;

export function detectPackageManager(rootNames: ReadonlySet<string>): PackageManager {
  if (rootNames.has("bun.lock") || rootNames.has("bun.lockb")) return "bun";
  if (rootNames.has("pnpm-lock.yaml")) return "pnpm";
  if (rootNames.has("yarn.lock")) return "yarn";
  return "npm";
}

export function scriptCommand(manager: PackageManager, script: string): string {
  if (manager === "yarn") return `yarn ${script}`;
  return `${manager} run ${script}`;
}

/** Scripts people reach for first, in the order they are usually run. */
const PRIORITY = [
  "dev",
  "start",
  "serve",
  "watch",
  "build",
  "test",
  "lint",
  "typecheck",
  "preview",
];
/** Hooks that npm runs by itself; nobody starts these from a Dock. */
const LIFECYCLE = /^(pre|post)|^(prepare|prepublishOnly|install|uninstall|version)$/;

export const MAX_SCRIPT_SUGGESTIONS = 6;

export function suggestScripts(input: {
  rootNames: ReadonlySet<string>;
  packageJson?: string | null | undefined;
  /** Commands already saved as presets; they are not suggested again. */
  existingCommands?: ReadonlySet<string> | undefined;
}): ScriptSuggestion[] {
  const suggestions: ScriptSuggestion[] = [];
  if (input.packageJson) {
    let scripts: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(input.packageJson) as { scripts?: unknown };
      if (parsed.scripts && typeof parsed.scripts === "object") {
        scripts = parsed.scripts as Record<string, unknown>;
      }
    } catch {
      scripts = {};
    }
    const manager = detectPackageManager(input.rootNames);
    const rank = (name: string) => {
      const index = PRIORITY.indexOf(name);
      return index === -1 ? PRIORITY.length : index;
    };
    const names = Object.keys(scripts)
      .filter((name) => typeof scripts[name] === "string" && !LIFECYCLE.test(name))
      .toSorted((left, right) => rank(left) - rank(right));
    for (const name of names) {
      suggestions.push({
        name,
        command: scriptCommand(manager, name),
        detail: String(scripts[name]),
      });
    }
  }
  if (input.rootNames.has("Cargo.toml")) {
    suggestions.push(
      { name: "cargo run", command: "cargo run", detail: "Build and run the crate" },
      { name: "cargo test", command: "cargo test", detail: "Run the test suite" },
    );
  }
  if (input.rootNames.has("go.mod")) {
    suggestions.push(
      { name: "go run", command: "go run .", detail: "Build and run the module" },
      { name: "go test", command: "go test ./...", detail: "Run every package's tests" },
    );
  }
  return suggestions
    .filter((suggestion) => !input.existingCommands?.has(suggestion.command))
    .slice(0, MAX_SCRIPT_SUGGESTIONS);
}
