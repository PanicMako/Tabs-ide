import * as Context from "effect/Context";
/**
 * Open - Browser/editor launch service interface.
 *
 * Owns process launch helpers for opening URLs in a browser and workspace
 * paths in a configured editor.
 *
 * @module Open
 */
import { spawn } from "node:child_process";
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { EDITORS, type EditorId } from "@tabs/contracts";
import { Schema, Effect, Layer } from "effect";

// ==============================
// Definitions
// ==============================

export class OpenError extends Schema.TaggedErrorClass<OpenError>()("OpenError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export interface OpenInEditorInput {
  readonly cwd: string;
  readonly editor: EditorId;
}

interface EditorLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

interface CommandAvailabilityOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}

const LINE_COLUMN_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;

function shouldUseGotoFlag(editorId: EditorId, target: string): boolean {
  return (
    (editorId === "cursor" || editorId === "vscode") && LINE_COLUMN_SUFFIX_PATTERN.test(target)
  );
}

function fileManagerCommandForPlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, "");
}

function resolvePathEnvironmentVariable(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? env.Path ?? env.path ?? "";
}

function resolveWindowsPathExtensions(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const rawValue = env.PATHEXT;
  const fallback = [".COM", ".EXE", ".BAT", ".CMD"];
  if (!rawValue) return fallback;

  const parsed = rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}

function resolveCommandCandidates(
  command: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (platform !== "win32") return [command];
  const extension = extname(command);
  const normalizedExtension = extension.toUpperCase();

  if (extension.length > 0 && windowsPathExtensions.includes(normalizedExtension)) {
    const commandWithoutExtension = command.slice(0, -extension.length);
    return Array.from(
      new Set([
        command,
        `${commandWithoutExtension}${normalizedExtension}`,
        `${commandWithoutExtension}${normalizedExtension.toLowerCase()}`,
      ]),
    );
  }

  const candidates: string[] = [];
  for (const extension of windowsPathExtensions) {
    candidates.push(`${command}${extension}`);
    candidates.push(`${command}${extension.toLowerCase()}`);
  }
  return Array.from(new Set(candidates));
}

function isExecutableFile(
  filePath: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === "win32") {
      const extension = extname(filePath);
      if (extension.length === 0) return false;
      return windowsPathExtensions.includes(extension.toUpperCase());
    }
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

export function isCommandAvailable(
  command: string,
  options: CommandAvailabilityOptions = {},
): boolean {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const windowsPathExtensions = platform === "win32" ? resolveWindowsPathExtensions(env) : [];
  const commandCandidates = resolveCommandCandidates(command, platform, windowsPathExtensions);

  if (command.includes("/") || command.includes("\\")) {
    return commandCandidates.some((candidate) =>
      isExecutableFile(candidate, platform, windowsPathExtensions),
    );
  }

  const pathValue = resolvePathEnvironmentVariable(env);
  if (pathValue.length === 0) return false;
  const pathEntries = pathValue
    .split(resolvePathDelimiter(platform))
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);

  for (const pathEntry of pathEntries) {
    for (const candidate of commandCandidates) {
      if (isExecutableFile(join(pathEntry, candidate), platform, windowsPathExtensions)) {
        return true;
      }
    }
  }
  return false;
}

const installNames: Partial<Record<EditorId, ReadonlyArray<string>>> = {
  vscode: ["Visual Studio Code"],
  "vscode-insiders": ["Visual Studio Code - Insiders"],
  vscodium: ["VSCodium"],
  cursor: ["Cursor"],
  trae: ["Trae"],
  kiro: ["Kiro"],
  zed: ["Zed", "Zed Preview"],
  antigravity: ["Antigravity", "Antigravity IDE"],
  idea: ["IntelliJ IDEA", "IntelliJ IDEA CE", "IntelliJ IDEA Ultimate"],
  pycharm: ["PyCharm", "PyCharm CE", "PyCharm Professional"],
  webstorm: ["WebStorm"],
  goland: ["GoLand"],
  clion: ["CLion"],
  rider: ["Rider", "JetBrains Rider"],
  phpstorm: ["PhpStorm"],
  rubymine: ["RubyMine"],
  rustrover: ["RustRover"],
  datagrip: ["DataGrip"],
  dataspell: ["DataSpell"],
  aqua: ["Aqua"],
};

export function resolveEditorExecutable(
  editor: (typeof EDITORS)[number],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { command: string } | null {
  if (editor.commands === null) return null;

  // 1. Check PATH
  for (const cmd of editor.commands) {
    if (isCommandAvailable(cmd, { platform, env })) {
      return { command: cmd };
    }
  }

  // 2. Check platform-specific application directories
  const home = env.HOME;
  const names = installNames[editor.id] ?? [editor.label];
  const command = editor.commands[0];
  const jetbrains = editor.launchStyle === "line-column";
  const candidates: string[] = [];
  const windowsPathExtensions = platform === "win32" ? resolveWindowsPathExtensions(env) : [];

  if (platform === "darwin") {
    const roots = [...(home ? [join(home, "Applications")] : []), "/Applications"];
    for (const root of roots) {
      for (const name of names) {
        const contents = join(root, `${name}.app`, "Contents");
        if (jetbrains || editor.id === "zed") {
          candidates.push(join(contents, "MacOS", editor.id === "zed" ? "cli" : command));
          if (editor.id === "zed") candidates.push(join(contents, "MacOS", "zed"));
        } else if (editor.id === "antigravity") {
          candidates.push(
            join(contents, "MacOS", "agy"),
            join(contents, "Resources", "app", "bin", "agy"),
            join(contents, "MacOS", "Antigravity"),
            join(contents, "MacOS", "Electron"),
          );
        } else {
          candidates.push(
            join(contents, "Resources/app/bin", command),
            join(contents, "Resources/app/bin/code"),
            join(contents, "MacOS", command),
            join(contents, "MacOS", name),
          );
        }
      }
    }
    if (home) {
      if (jetbrains) {
        candidates.push(
          join(home, "Library/Application Support/JetBrains/Toolbox/scripts", command),
        );
      }
      if (editor.id === "antigravity") {
        candidates.push(join(home, ".local/bin/agy"));
      }
    }
  } else if (platform === "win32") {
    const roots = [
      ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Programs")] : []),
      ...[env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432].filter(
        (root): root is string => !!root,
      ),
    ];
    if (jetbrains) {
      if (env.LOCALAPPDATA) {
        candidates.push(join(env.LOCALAPPDATA, "JetBrains/Toolbox/scripts", `${command}.cmd`));
      }
      for (const directory of roots.flatMap((root) => [root, join(root, "JetBrains")])) {
        try {
          const entries = readdirSync(directory);
          for (const entry of entries) {
            if (names.some((name) => entry === name || entry.startsWith(`${name} `))) {
              candidates.push(join(directory, entry, "bin", `${command}64.exe`));
              candidates.push(join(directory, entry, "bin", `${command}.exe`));
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
    } else {
      const name =
        editor.id === "vscode"
          ? "Microsoft VS Code"
          : editor.id === "vscode-insiders"
            ? "Microsoft VS Code Insiders"
            : editor.label;
      for (const root of roots) {
        candidates.push(
          join(root, name, "resources/app/bin", `${command}.cmd`),
          join(root, name, "resources/app/bin/code.cmd"),
          join(root, name, "bin", `${command}.cmd`),
          join(root, name, "bin/code.cmd"),
        );
      }
    }
  } else if (platform === "linux") {
    const dirs = [
      ...(home ? [join(home, ".local/bin")] : []),
      "/usr/local/bin",
      "/usr/bin",
      "/snap/bin",
    ];
    if (jetbrains) {
      const dataHome = env.XDG_DATA_HOME || (home ? join(home, ".local/share") : undefined);
      if (dataHome) dirs.push(join(dataHome, "JetBrains/Toolbox/scripts"));
    }
    for (const dir of dirs) {
      for (const name of editor.commands) candidates.push(join(dir, name));
    }
  }

  for (const candidate of candidates) {
    if (isExecutableFile(candidate, platform, windowsPathExtensions)) {
      return { command: candidate };
    }
  }

  return null;
}

export function resolveAvailableEditors(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ReadonlyArray<EditorId> {
  const available: EditorId[] = [];

  for (const editor of EDITORS) {
    if (editor.commands === null) {
      const command = fileManagerCommandForPlatform(platform);
      if (isCommandAvailable(command, { platform, env })) {
        available.push(editor.id);
      }
      continue;
    }

    if (resolveEditorExecutable(editor, platform, env) !== null) {
      available.push(editor.id);
    }
  }

  return available;
}

/**
 * OpenShape - Service API for browser and editor launch actions.
 */
export interface OpenShape {
  /**
   * Open a URL target in the default browser.
   */
  readonly openBrowser: (target: string) => Effect.Effect<void, OpenError>;

  /**
   * Open a workspace path in a selected editor integration.
   *
   * Launches the editor as a detached process so server startup is not blocked.
   */
  readonly openInEditor: (input: OpenInEditorInput) => Effect.Effect<void, OpenError>;
}

/**
 * Open - Service tag for browser/editor launch operations.
 */
export class Open extends Context.Service<Open, OpenShape>()("tabs/open") {}

// ==============================
// Implementations
// ==============================

export const resolveEditorLaunch = Effect.fnUntraced(function* (
  input: OpenInEditorInput,
  platform: NodeJS.Platform = process.platform,
): Effect.fn.Return<EditorLaunch, OpenError> {
  const editorDef = EDITORS.find((editor) => editor.id === input.editor);
  if (!editorDef) {
    return yield* new OpenError({ message: `Unknown editor: ${input.editor}` });
  }

  if (editorDef.commands) {
    const env = process.env;
    const resolved = resolveEditorExecutable(editorDef, platform, env);
    const command = resolved ? resolved.command : editorDef.commands[0];
    const baseArgs = "baseArgs" in editorDef && editorDef.baseArgs ? editorDef.baseArgs : [];
    const args = shouldUseGotoFlag(editorDef.id, input.cwd)
      ? [...baseArgs, "--goto", input.cwd]
      : [...baseArgs, input.cwd];
    return { command, args };
  }

  if (editorDef.id !== "file-manager") {
    return yield* new OpenError({ message: `Unsupported editor: ${input.editor}` });
  }

  return { command: fileManagerCommandForPlatform(platform), args: [input.cwd] };
});

export const launchDetached = (launch: EditorLaunch) =>
  Effect.gen(function* () {
    if (!isCommandAvailable(launch.command)) {
      return yield* new OpenError({ message: `Editor command not found: ${launch.command}` });
    }

    yield* Effect.callback<void, OpenError>((resume) => {
      let child;
      try {
        child = spawn(launch.command, [...launch.args], {
          detached: true,
          stdio: "ignore",
          shell: process.platform === "win32",
        });
      } catch (error) {
        return resume(
          Effect.fail(new OpenError({ message: "failed to spawn detached process", cause: error })),
        );
      }

      const handleSpawn = () => {
        child.unref();
        resume(Effect.void);
      };

      child.once("spawn", handleSpawn);
      child.once("error", (cause) =>
        resume(Effect.fail(new OpenError({ message: "failed to spawn detached process", cause }))),
      );
    });
  });

const make = Effect.gen(function* () {
  const open = yield* Effect.tryPromise({
    try: () => import("open"),
    catch: (cause) => new OpenError({ message: "failed to load browser opener", cause }),
  });

  return {
    openBrowser: (target) =>
      Effect.tryPromise({
        try: () => open.default(target),
        catch: (cause) => new OpenError({ message: "Browser auto-open failed", cause }),
      }),
    openInEditor: (input) => Effect.flatMap(resolveEditorLaunch(input), launchDetached),
  } satisfies OpenShape;
});

export const OpenLive = Layer.effect(Open, make);
