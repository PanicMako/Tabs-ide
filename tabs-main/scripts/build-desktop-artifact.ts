#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import rootPackageJson from "../package.json" with { type: "json" };
import desktopPackageJson from "../apps/desktop/package.json" with { type: "json" };
import serverPackageJson from "../apps/server/package.json" with { type: "json" };

import { BRAND_LOGO_SVG_PATHS } from "./lib/brand-assets.ts";
import { renderSvgToIcoFile, renderSvgToPngFile } from "./lib/icon-assets.ts";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";
import { updateMacUpdateMetadata } from "./lib/mac-update-artifact.ts";
import { sanitizeMacAppSymlinks } from "./lib/mac-symlink-sanitizer.ts";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Config,
  Data,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Logger,
  Option,
  Path,
  Schema,
} from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const BuildPlatform = Schema.Literals(["mac", "linux", "win"]);
const BuildArch = Schema.Literals(["arm64", "x64", "universal"]);

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);
const LightBrandLogoSource = Effect.zipWith(RepoRoot, Effect.service(Path.Path), (repoRoot, path) =>
  path.join(repoRoot, BRAND_LOGO_SVG_PATHS.light),
);
const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);

interface PlatformConfig {
  readonly cliFlag: "--mac" | "--linux" | "--win";
  readonly defaultTarget: string;
  readonly archChoices: ReadonlyArray<typeof BuildArch.Type>;
}

const PLATFORM_CONFIG: Record<typeof BuildPlatform.Type, PlatformConfig> = {
  mac: {
    cliFlag: "--mac",
    defaultTarget: "dmg",
    archChoices: ["arm64", "x64", "universal"],
  },
  linux: {
    cliFlag: "--linux",
    defaultTarget: "AppImage",
    archChoices: ["x64", "arm64"],
  },
  win: {
    cliFlag: "--win",
    defaultTarget: "nsis",
    archChoices: ["x64", "arm64"],
  },
};

interface BuildCliInput {
  readonly platform: Option.Option<typeof BuildPlatform.Type>;
  readonly target: Option.Option<string>;
  readonly arch: Option.Option<typeof BuildArch.Type>;
  readonly buildVersion: Option.Option<string>;
  readonly outputDir: Option.Option<string>;
  readonly skipBuild: Option.Option<boolean>;
  readonly keepStage: Option.Option<boolean>;
  readonly signed: Option.Option<boolean>;
  readonly verbose: Option.Option<boolean>;
  readonly thin: Option.Option<boolean>;
}

function detectHostBuildPlatform(hostPlatform: string): typeof BuildPlatform.Type | undefined {
  if (hostPlatform === "darwin") return "mac";
  if (hostPlatform === "linux") return "linux";
  if (hostPlatform === "win32") return "win";
  return undefined;
}

function getDefaultArch(platform: typeof BuildPlatform.Type): typeof BuildArch.Type {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    return "x64";
  }

  if (process.arch === "arm64" && config.archChoices.includes("arm64")) {
    return "arm64";
  }
  if (process.arch === "x64" && config.archChoices.includes("x64")) {
    return "x64";
  }

  return config.archChoices[0] ?? "x64";
}

class BuildScriptError extends Data.TaggedError("BuildScriptError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function resolveGitCommitHash(repoRoot: string): string {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "unknown";
  }
  const hash = result.stdout.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
    return "unknown";
  }
  return hash.toLowerCase();
}

function resolvePythonForNodeGyp(): string | undefined {
  const configured = process.env.npm_config_python ?? process.env.PYTHON;
  if (configured && existsSync(configured)) {
    return configured;
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      for (const version of ["Python313", "Python312", "Python311", "Python310"]) {
        const candidate = join(localAppData, "Programs", "Python", version, "python.exe");
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  const probe = spawnSync("python", ["-c", "import sys;print(sys.executable)"], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    return undefined;
  }

  const executable = probe.stdout.trim();
  if (!executable || !existsSync(executable)) {
    return undefined;
  }

  return executable;
}

interface ResolvedBuildOptions {
  readonly platform: typeof BuildPlatform.Type;
  readonly target: string;
  readonly arch: typeof BuildArch.Type;
  readonly version: string | undefined;
  readonly outputDir: string;
  readonly skipBuild: boolean;
  readonly keepStage: boolean;
  readonly signed: boolean;
  readonly verbose: boolean;
  // Thin installer: don't bundle the VS Code runtime into the app; instead emit
  // it as a standalone `tabs-code-runtime-*.zip` (+ .sha256) for on-demand
  // download on first run.
  readonly thin: boolean;
}

interface StagePackageJson {
  readonly name: string;
  readonly version: string;
  readonly buildVersion: string;
  readonly tabsCommitHash: string;
  readonly private: true;
  readonly description: string;
  readonly author: string;
  readonly main: string;
  readonly build: Record<string, unknown>;
  readonly dependencies: Record<string, unknown>;
  readonly devDependencies: {
    readonly electron: string;
  };
  readonly overrides?: Record<string, unknown>;
}

const AzureTrustedSigningOptionsConfig = Config.all({
  publisherName: Config.string("AZURE_TRUSTED_SIGNING_PUBLISHER_NAME"),
  endpoint: Config.string("AZURE_TRUSTED_SIGNING_ENDPOINT"),
  certificateProfileName: Config.string("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME"),
  codeSigningAccountName: Config.string("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME"),
  fileDigest: Config.string("AZURE_TRUSTED_SIGNING_FILE_DIGEST").pipe(Config.withDefault("SHA256")),
  timestampDigest: Config.string("AZURE_TRUSTED_SIGNING_TIMESTAMP_DIGEST").pipe(
    Config.withDefault("SHA256"),
  ),
  timestampRfc3161: Config.string("AZURE_TRUSTED_SIGNING_TIMESTAMP_RFC3161").pipe(
    Config.withDefault("http://timestamp.acs.microsoft.com"),
  ),
});

const BuildEnvConfig = Config.all({
  platform: Config.schema(BuildPlatform, "TABS_DESKTOP_PLATFORM").pipe(Config.option),
  target: Config.string("TABS_DESKTOP_TARGET").pipe(Config.option),
  arch: Config.schema(BuildArch, "TABS_DESKTOP_ARCH").pipe(Config.option),
  version: Config.string("TABS_DESKTOP_VERSION").pipe(Config.option),
  outputDir: Config.string("TABS_DESKTOP_OUTPUT_DIR").pipe(Config.option),
  skipBuild: Config.boolean("TABS_DESKTOP_SKIP_BUILD").pipe(Config.withDefault(false)),
  keepStage: Config.boolean("TABS_DESKTOP_KEEP_STAGE").pipe(Config.withDefault(false)),
  signed: Config.boolean("TABS_DESKTOP_SIGNED").pipe(Config.withDefault(false)),
  verbose: Config.boolean("TABS_DESKTOP_VERBOSE").pipe(Config.withDefault(false)),
  thin: Config.boolean("TABS_DESKTOP_THIN").pipe(Config.withDefault(false)),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);
const mergeOptions = <A>(a: Option.Option<A>, b: Option.Option<A>, defaultValue: A) =>
  Option.getOrElse(a, () => Option.getOrElse(b, () => defaultValue));

const resolveBuildOptions = Effect.fn("resolveBuildOptions")(function* (input: BuildCliInput) {
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const env = yield* BuildEnvConfig;

  const platform = mergeOptions(
    input.platform,
    env.platform,
    detectHostBuildPlatform(process.platform),
  );

  if (!platform) {
    return yield* new BuildScriptError({
      message: `Unsupported host platform '${process.platform}'.`,
    });
  }

  const target = mergeOptions(input.target, env.target, PLATFORM_CONFIG[platform].defaultTarget);
  const arch = mergeOptions(input.arch, env.arch, getDefaultArch(platform));
  const version = mergeOptions(input.buildVersion, env.version, undefined);
  const outputDir = path.resolve(repoRoot, mergeOptions(input.outputDir, env.outputDir, "release"));

  const skipBuild = resolveBooleanFlag(input.skipBuild, env.skipBuild);
  const keepStage = resolveBooleanFlag(input.keepStage, env.keepStage);
  const signed = resolveBooleanFlag(input.signed, env.signed);
  const verbose = resolveBooleanFlag(input.verbose, env.verbose);
  const thin = resolveBooleanFlag(input.thin, env.thin);

  return {
    platform,
    target,
    arch,
    version,
    outputDir,
    skipBuild,
    keepStage,
    signed,
    verbose,
    thin,
  } satisfies ResolvedBuildOptions;
});

const commandOutputOptions = (verbose: boolean) =>
  ({
    stdout: verbose ? "inherit" : "ignore",
    stderr: "inherit",
  }) as const;

const runCommand = Effect.fn("runCommand")(function* (command: ChildProcess.Command) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* commandSpawner.spawn(command);
  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    return yield* new BuildScriptError({
      message: `Command exited with non-zero exit code (${exitCode})`,
    });
  }
});

/**
 * Run a command with bounded retries. electron-builder downloads its NSIS/7zip
 * toolchain from GitHub's electron-builder-binaries releases at build time, and
 * that host intermittently returns 5xx (e.g. 504 Gateway Time-out), which fails
 * the whole release for a transient network reason — after packaging, native
 * rebuild and code-signing have already succeeded. Re-running electron-builder
 * is idempotent (it overwrites dist/ and resumes the toolchain download), so a
 * few backed-off retries turn these flakes into a self-healing build. A genuine
 * build error still surfaces after the attempts are exhausted.
 */
type RunCommandEffect = ReturnType<typeof runCommand>;

const runCommandWithRetry = (
  command: ChildProcess.Command,
  options?: {
    readonly attempts?: number;
    readonly baseDelaySeconds?: number;
    readonly label?: string;
  },
): RunCommandEffect => {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const baseDelaySeconds = options?.baseDelaySeconds ?? 20;
  const label = options?.label ?? "command";
  const attempt = (n: number): RunCommandEffect =>
    runCommand(command).pipe(
      Effect.catch((error) =>
        n >= attempts
          ? Effect.fail(error)
          : Effect.logWarning(
              `[desktop-artifact] ${label} attempt ${n}/${attempts} failed (often a transient toolchain download error); retrying in ${baseDelaySeconds * n}s...`,
            ).pipe(
              Effect.andThen(Effect.sleep(Duration.seconds(baseDelaySeconds * n))),
              Effect.andThen(attempt(n + 1)),
            ),
      ),
    );
  return attempt(1);
};

function generateMacIconSet(
  sourcePng: string,
  targetIcns: string,
  tmpRoot: string,
  path: Path.Path,
  verbose: boolean,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const iconsetDir = path.join(tmpRoot, "icon.iconset");
    yield* fs.makeDirectory(iconsetDir, { recursive: true });

    const iconSizes = [16, 32, 128, 256, 512] as const;
    for (const size of iconSizes) {
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z ${size} ${size} ${sourcePng} --out ${path.join(iconsetDir, `icon_${size}x${size}.png`)}`,
      );

      const retinaSize = size * 2;
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z ${retinaSize} ${retinaSize} ${sourcePng} --out ${path.join(iconsetDir, `icon_${size}x${size}@2x.png`)}`,
      );
    }

    yield* runCommand(
      ChildProcess.make({
        ...commandOutputOptions(verbose),
      })`iconutil -c icns ${iconsetDir} -o ${targetIcns}`,
    );
  });
}

function stageMacIcons(stageResourcesDir: string, verbose: boolean) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const iconSource = yield* LightBrandLogoSource;
    if (!(yield* fs.exists(iconSource))) {
      return yield* new BuildScriptError({
        message: `Production icon source is missing at ${iconSource}`,
      });
    }

    const tmpRoot = yield* fs.makeTempDirectoryScoped({
      prefix: "tabs-icon-build-",
    });

    const iconPngPath = path.join(stageResourcesDir, "icon.png");
    const iconIcnsPath = path.join(stageResourcesDir, "icon.icns");
    yield* renderSvgToPngFile(iconSource, iconPngPath, 1024);
    yield* generateMacIconSet(iconPngPath, iconIcnsPath, tmpRoot, path, verbose);
  });
}

function stageLinuxIcons(stageResourcesDir: string) {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const iconSource = yield* LightBrandLogoSource;
    const iconPath = path.join(stageResourcesDir, "icon.png");
    yield* renderSvgToPngFile(iconSource, iconPath, 1024);
  });
}

function stageWindowsIcons(stageResourcesDir: string) {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const iconSource = yield* LightBrandLogoSource;
    const iconPath = path.join(stageResourcesDir, "icon.ico");
    yield* renderSvgToIcoFile(iconSource, iconPath);
  });
}

function validateBundledClientAssets(clientDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const indexPath = path.join(clientDir, "index.html");
    const indexHtml = yield* fs.readFileString(indexPath);
    const refs = [...indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined);
    const missing: string[] = [];

    for (const ref of refs) {
      const normalizedRef = ref.split("#")[0]?.split("?")[0] ?? "";
      if (!normalizedRef) continue;
      if (normalizedRef.startsWith("http://") || normalizedRef.startsWith("https://")) continue;
      if (normalizedRef.startsWith("data:") || normalizedRef.startsWith("mailto:")) continue;

      const ext = path.extname(normalizedRef);
      if (!ext) continue;

      const relativePath = normalizedRef.replace(/^\/+/, "");
      const assetPath = path.join(clientDir, relativePath);
      if (!(yield* fs.exists(assetPath))) {
        missing.push(normalizedRef);
      }
    }

    if (missing.length > 0) {
      const preview = missing.slice(0, 6).join(", ");
      const suffix = missing.length > 6 ? ` (+${missing.length - 6} more)` : "";
      return yield* new BuildScriptError({
        message: `Bundled client references missing files in ${indexPath}: ${preview}${suffix}. Rebuild web/server artifacts.`,
      });
    }
  });
}

function resolveDesktopRuntimeDependencies(
  dependencies: Record<string, unknown> | undefined,
  catalog: Record<string, unknown>,
): Record<string, unknown> {
  if (!dependencies || Object.keys(dependencies).length === 0) {
    return {};
  }

  const runtimeDependencies = Object.fromEntries(
    Object.entries(dependencies).filter(
      ([dependencyName, spec]) =>
        dependencyName !== "electron" &&
        (typeof spec !== "string" || !spec.startsWith("workspace:")),
    ),
  );

  return resolveCatalogDependencies(runtimeDependencies, catalog, "apps/desktop");
}

function resolveGitHubPublishConfig():
  | {
      readonly provider: "github";
      readonly owner: string;
      readonly repo: string;
      readonly releaseType: "release";
    }
  | undefined {
  const rawRepo =
    process.env.TABS_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "";
  if (!rawRepo) return undefined;

  const [owner, repo, ...rest] = rawRepo.split("/");
  if (!owner || !repo || rest.length > 0) return undefined;

  return {
    provider: "github",
    owner,
    repo,
    releaseType: "release",
  };
}

function parseHdiutilMountPoint(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("/Volumes/"))
    .map((line) => line.split(/\t+/).at(-1)?.trim())
    .find((line): line is string => Boolean(line));
}

/**
 * Given a built-in extension's package.json `main` (e.g. `./out/extension`,
 * `./client/out/node/cssClientMain`, `./out/main.js`), return the relative
 * compiled-output directory the runtime needs present (e.g. `out`,
 * `client/out`). Returns null when the entry doesn't point into a compiled
 * `out`/`dist` dir (e.g. a hand-written `./extension.js`), so such extensions
 * are not falsely required to have a compiled tree.
 */
export function compiledOutputDir(main: string): string | null {
  const segments = main.replace(/^\.\//, "").replace(/\\/g, "/").split("/").filter(Boolean);
  const index = segments.findIndex((segment) => segment === "out" || segment === "dist");
  if (index < 0) {
    return null;
  }
  return segments.slice(0, index + 1).join("/");
}

/**
 * Extract the string `main` field from a package.json's text, or null if the
 * text is empty/unparseable or `main` isn't a string.
 */
export function readPackageMain(text: string): string | null {
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { main?: unknown };
    return typeof parsed.main === "string" ? parsed.main : null;
  } catch {
    return null;
  }
}

function getRequiredMacArtifactPaths(productName: string, thin = false): readonly string[] {
  const appRoot = `${productName}.app`;
  const appLevel = [
    join(appRoot, "Contents", "MacOS", productName),
    join(
      appRoot,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Electron Framework",
    ),
    join(appRoot, "Contents", "Resources", "app.asar"),
  ];
  // Thin builds don't bundle the VS Code runtime (it's downloaded on first run).
  if (thin) {
    return appLevel;
  }
  const codeOss = join(appRoot, "Contents", "Resources", "tabs-code-main");
  return [
    ...appLevel,
    join(codeOss, "out", "vs", "code", "electron-browser", "workbench", "workbench-dev.html"),
    join(codeOss, "out", "vs", "base", "parts", "sandbox", "electron-browser", "preload.js"),
    join(codeOss, "out-build", "nls.messages.json"),
    join(codeOss, "product.json"),
    // Native main-process services and built-in extensions resolve runtime
    // dependencies from the checkout's root node_modules.
    join(codeOss, "node_modules"),
    join(codeOss, "node_modules", "minimist", "index.js"),
    join(codeOss, "extensions", "node_modules", "typescript", "lib", "typescript.js"),
    join(
      codeOss,
      "extensions",
      "git",
      "node_modules",
      "@vscode",
      "fs-copyfile",
      "build",
      "Release",
      "vscode_fs.node",
    ),
    join(codeOss, "extensions", "copilot", "node_modules", "@anthropic-ai", "sdk", "package.json"),
  ];
}

const assertRequiredPaths = Effect.fn("assertRequiredPaths")(function* (
  root: string,
  requiredPaths: readonly string[],
  description: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const missing: string[] = [];

  for (const relativePath of requiredPaths) {
    const absolutePath = path.join(root, relativePath);
    if (!(yield* fs.exists(absolutePath))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    return yield* new BuildScriptError({
      message: `${description} is missing required files: ${missing.join(", ")}`,
    });
  }
});

const validateMacDmgContents = Effect.fn("validateMacDmgContents")(function* (
  dmgPath: string,
  productName: string,
) {
  const requiredPaths = getRequiredMacArtifactPaths(productName);

  const attachResult = yield* Effect.sync(() =>
    spawnSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-noverify", dmgPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

  if (attachResult.error || attachResult.status !== 0) {
    return yield* new BuildScriptError({
      message:
        `Failed to mount generated DMG for validation: ` +
        (attachResult.stderr.trim() ||
          attachResult.error?.message ||
          `exit ${attachResult.status}`),
    });
  }

  const mountPoint = parseHdiutilMountPoint(attachResult.stdout);
  if (!mountPoint) {
    return yield* new BuildScriptError({
      message: `Failed to find mounted volume in hdiutil output for ${dmgPath}`,
    });
  }

  try {
    yield* assertRequiredPaths(mountPoint, requiredPaths, "Generated DMG");
  } finally {
    const detachResult = spawnSync("hdiutil", ["detach", mountPoint], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (detachResult.status !== 0) {
      yield* Effect.log(
        `[desktop-artifact] WARNING: Failed to detach validation DMG volume ${mountPoint}.`,
      );
    }
  }
});

const createMacDmgFromZip = Effect.fn("createMacDmgFromZip")(function* (input: {
  readonly stageDistDir: string;
  readonly productName: string;
  readonly version: string;
  readonly arch: typeof BuildArch.Type;
  readonly verbose: boolean;
  readonly thin: boolean;
  readonly signed: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dmgPath = path.join(input.stageDistDir, `Tabs-${input.version}-${input.arch}.dmg`);

  // Source the DMG payload from electron-builder's directly-packaged `.app`
  // bundle (in dist/mac*/), NOT from the `.zip` it also emits. Extracting the
  // zip with `ditto -x -k` mangles the nested framework version symlinks
  // (`Foo.framework/Versions/Current`), which then makes `codesign --deep`
  // abort with "bundle format is ambiguous (could be app or framework)" on
  // frameworks like ReactiveObjC / Electron Framework. Copying the packaged
  // app with `ditto <src> <dst>` preserves those symlinks intact.
  const distEntries = yield* fs.readDirectory(input.stageDistDir);
  let packagedAppPath: string | null = null;
  for (const entry of distEntries) {
    if (!entry.startsWith("mac")) continue;
    const candidate = path.join(input.stageDistDir, entry, `${input.productName}.app`);
    if (yield* fs.exists(candidate)) {
      packagedAppPath = candidate;
      break;
    }
  }
  if (packagedAppPath === null) {
    return yield* new BuildScriptError({
      message: `Could not create mac DMG because no packaged .app was found under ${input.stageDistDir}/mac*`,
    });
  }

  const dmgRoot = yield* fs.makeTempDirectoryScoped({
    prefix: "tabs-dmg-root-",
  });
  yield* Effect.log("[desktop-artifact] Creating DMG from packaged app bundle...");
  // `ditto <src> <dst>` deep-copies while preserving symlinks/metadata.
  yield* runCommand(
    ChildProcess.make({
      ...commandOutputOptions(input.verbose),
    })`ditto ${packagedAppPath} ${path.join(dmgRoot, `${input.productName}.app`)}`,
  );

  // The afterPack hook restores `node_modules` before electron-builder signs
  // the app. Keep this fallback for unsigned local builds, where repairing the
  // bundle here and applying a fresh ad-hoc signature is safe.
  const codeOssAppDir = path.join(
    dmgRoot,
    `${input.productName}.app`,
    "Contents",
    "Resources",
    "tabs-code-main",
  );
  const codeOssNodeModules = path.join(codeOssAppDir, "node_modules");
  if (
    !input.signed &&
    !input.thin &&
    (yield* fs.exists(codeOssAppDir)) &&
    !(yield* fs.exists(codeOssNodeModules))
  ) {
    const stageAppDir = path.dirname(input.stageDistDir);
    const stagedNodeModules = path.join(
      stageAppDir,
      "apps",
      "desktop",
      "resources",
      "tabs-code-main",
      "node_modules",
    );
    const sourceNodeModules = path.join(process.cwd(), "..", "tabs-code-main", "node_modules");
    const nodeModulesSource = (yield* fs.exists(stagedNodeModules))
      ? stagedNodeModules
      : sourceNodeModules;
    if (yield* fs.exists(nodeModulesSource)) {
      yield* Effect.log(
        "[desktop-artifact] Restoring tabs-code-main/node_modules dropped by electron-builder...",
      );
      yield* fs.copy(nodeModulesSource, codeOssNodeModules);
    }
  }

  // Unsigned builds need a final ad-hoc signature after the fallback repair.
  // Signed releases must retain electron-builder's Developer ID signature:
  // replacing it here changes the app identity seen by macOS Keychain and makes
  // users enter their login password to read "Tabs Safe Storage" on startup.
  const appPath = path.join(dmgRoot, `${input.productName}.app`);
  if (yield* fs.exists(appPath)) {
    yield* Effect.log("[desktop-artifact] Sanitizing bundle symlinks before codesigning...");
    yield* Effect.sync(() => sanitizeMacAppSymlinks(appPath));
  }
  if (!input.signed && (yield* fs.exists(appPath))) {
    yield* Effect.log("[desktop-artifact] Ad-hoc codesigning the app bundle (no Developer ID)...");
    yield* runCommand(
      ChildProcess.make({
        ...commandOutputOptions(input.verbose),
      })`codesign --force --deep --sign - --timestamp=none ${appPath}`,
    );
    // After codesigning, give macOS system services (Spotlight/mds, XProtect,
    // syspolicyd) a moment to release file handles on the freshly-signed
    // bundle. Without this pause the subsequent `hdiutil create -srcfolder`
    // often fails with "Resource busy" on CI runners.
    yield* Effect.sleep(Duration.seconds(5));
  }

  if (input.signed && (yield* fs.exists(appPath))) {
    yield* Effect.log("[desktop-artifact] Verifying preserved Developer ID signature...");
    yield* runCommand(
      ChildProcess.make({
        ...commandOutputOptions(input.verbose),
      })`codesign --verify --deep --strict ${appPath}`,
    );
  }

  yield* Effect.log("[desktop-artifact] Verifying the final macOS app signature...");
  yield* runCommand(
    ChildProcess.make({
      ...commandOutputOptions(input.verbose),
    })`codesign --verify --deep --strict ${appPath}`,
  );

  yield* assertRequiredPaths(
    dmgRoot,
    getRequiredMacArtifactPaths(input.productName, input.thin),
    "Extracted mac ZIP",
  );

  // electron-builder creates its ZIP before the unsigned build's final repair
  // and ad-hoc signing above. The preview updater consumes the ZIP, not the DMG,
  // so regenerate it from the exact verified app that will be shipped in the
  // DMG and update the channel metadata to match the new bytes.
  const updaterZipName = `Tabs-${input.version}-${input.arch}.zip`;
  const updaterZipPath = path.join(input.stageDistDir, updaterZipName);
  yield* Effect.log("[desktop-artifact] Regenerating verified macOS updater ZIP...");
  yield* fs.remove(updaterZipPath, { force: true }).pipe(Effect.ignore({ log: true }));
  yield* runCommand(
    ChildProcess.make({
      ...commandOutputOptions(input.verbose),
    })`ditto -c -k --keepParent ${appPath} ${updaterZipPath}`,
  );

  const zipValidationRoot = yield* fs.makeTempDirectoryScoped({
    prefix: "tabs-updater-zip-validation-",
  });
  yield* runCommand(
    ChildProcess.make({
      ...commandOutputOptions(input.verbose),
    })`ditto -x -k ${updaterZipPath} ${zipValidationRoot}`,
  );
  const validatedZipApp = path.join(zipValidationRoot, `${input.productName}.app`);
  yield* runCommand(
    ChildProcess.make({
      ...commandOutputOptions(input.verbose),
    })`codesign --verify --deep --strict ${validatedZipApp}`,
  );
  yield* assertRequiredPaths(
    zipValidationRoot,
    getRequiredMacArtifactPaths(input.productName, input.thin),
    "Regenerated macOS updater ZIP",
  );

  const updaterZipSha512 = yield* Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        const hash = createHash("sha512");
        const stream = createReadStream(updaterZipPath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.once("error", reject);
        stream.once("end", () => resolve(hash.digest("base64")));
      }),
    catch: (cause) =>
      new BuildScriptError({
        message: `Failed to hash regenerated macOS updater ZIP: ${String(cause)}`,
      }),
  });
  const updaterZipStat = yield* fs.stat(updaterZipPath);
  const macUpdateMetadataPath = path.join(input.stageDistDir, "latest-mac.yml");
  if (yield* fs.exists(macUpdateMetadataPath)) {
    const metadata = yield* fs.readFileString(macUpdateMetadataPath);
    yield* fs.writeFileString(
      macUpdateMetadataPath,
      updateMacUpdateMetadata(
        metadata,
        updaterZipName,
        updaterZipSha512,
        Number(updaterZipStat.size),
      ),
    );
  }
  yield* fs
    .remove(`${updaterZipPath}.blockmap`, { force: true })
    .pipe(Effect.ignore({ log: true }));

  // Add the familiar drag-to-install layout: a symlink to /Applications next to
  // the app, so the mounted DMG shows "Tabs.app  ->  Applications" and the user
  // can drag the app into place. (A custom background/icon positioning needs a
  // writable DMG + .DS_Store, which is fragile on headless CI — the alias alone
  // gives the standard drag target reliably.)
  const applicationsAlias = path.join(dmgRoot, "Applications");
  if (!(yield* fs.exists(applicationsAlias))) {
    yield* Effect.log("[desktop-artifact] Adding /Applications drag target to DMG...");
    yield* Effect.sync(() => {
      spawnSync("ln", ["-s", "/Applications", applicationsAlias]);
    });
  }

  yield* fs.remove(dmgPath, { force: true }).pipe(Effect.ignore({ log: true }));
  yield* runCommandWithRetry(
    ChildProcess.make({
      ...commandOutputOptions(input.verbose),
    })`hdiutil create -volname ${input.productName} -srcfolder ${dmgRoot} -ov -format UDZO ${dmgPath}`,
    { attempts: 3, baseDelaySeconds: 10, label: "hdiutil create (DMG)" },
  );
  // The smoke test runs the bundled server; thin builds don't bundle it.
  if (!input.thin) {
    yield* validateMacDmgContents(dmgPath, input.productName);
  }
});

const createBuildConfig = Effect.fn("createBuildConfig")(function* (
  platform: typeof BuildPlatform.Type,
  target: string,
  productName: string,
  signed: boolean,
  thin: boolean,
  afterPackHook: boolean,
  installerNshStaged: boolean,
  releaseNotes: string | null,
) {
  const buildConfig: Record<string, unknown> = {
    appId: "com.tabs.app",
    productName,
    artifactName: "Tabs-${version}-${arch}.${ext}",
    directories: {
      buildResources: "apps/desktop/resources",
    },
    ...(releaseNotes ? { releaseInfo: { releaseNotes } } : {}),
    // Restore tabs-code-main/node_modules that electron-builder drops from the
    // extraFiles copy before platform signing runs. Without it the packaged
    // Code-OSS server fails on `import minimist from 'minimist'`. No-op for
    // thin builds.
    // Only referenced when the hook was actually staged (see below) — otherwise
    // electron-builder would abort trying to resolve a missing module.
    ...(afterPackHook ? { afterPack: "./build/afterPack.cjs" } : {}),
    // Unpack the integration extension from the asar onto real disk so
    // `FS.cpSync` in `installManagedServerControlExtension` can read it.
    // Electron's asar layer does NOT patch `cpSync`, so a source path inside
    // `app.asar` silently fails with ENOENT. The unpacked copy lands at
    // `app.asar.unpacked/apps/desktop/prod-resources/…` where cpSync works.
    // Code-OSS loads extensions through original-fs, which cannot traverse app.asar.
    // Keep every bundled Tabs integration extension on the real filesystem.
    asarUnpack: ["apps/desktop/prod-resources/code-oss-extensions/**"],
    // Thin builds ship without the VS Code runtime (it's downloaded on first
    // run from the emitted tabs-code-runtime-*.zip asset).
    extraFiles: thin
      ? []
      : [
          {
            from: "apps/desktop/resources/tabs-code-main",
            to: platform === "mac" ? "Resources/tabs-code-main" : "resources/tabs-code-main",
            filter: ["!**/*.ts", "!**/.git"],
          },
        ],
  };
  const publishConfig = resolveGitHubPublishConfig();
  if (publishConfig) {
    buildConfig.publish = [publishConfig];
  }

  if (platform === "mac") {
    buildConfig.mac = {
      // electron-builder's DMG creator has dropped large framework files from
      // our image. Build the ZIP/app payload here and create the DMG ourselves
      // from that verified payload below.
      target: target === "dmg" ? ["zip"] : [target],
      icon: "icon.icns",
      category: "public.app-category.developer-tools",
      // Hardened Runtime ONLY when we can actually sign + notarize with a
      // Developer ID. electron-builder defaults it to `true`, but our unsigned
      // CI build is only AD-HOC signed (no Developer ID, no notarization).
      // Hardened Runtime on an ad-hoc, un-notarized bundle is what makes the
      // launched .app fail to set up its inter-process mach ports
      // ("bootstrap_look_up …MachPortRendezvousServer: Permission denied") and
      // crash the GPU / network / renderer helpers — the "ton of errors" users
      // see when opening the DMG. Disabling it lets the ad-hoc bundle run
      // cleanly; the signed release path keeps it on (Apple requires it).
      hardenedRuntime: signed,
      // Don't run Gatekeeper assessment during the build (the ad-hoc bundle
      // would fail it); the signed/notarized release passes it at runtime.
      gatekeeperAssess: false,
    };
  }

  if (platform === "linux") {
    buildConfig.linux = {
      target: [target],
      icon: "icon.png",
      category: "Development",
    };
  }

  if (platform === "win") {
    const winConfig: Record<string, unknown> = {
      target: [target],
      icon: "icon.ico",
    };
    if (signed) {
      winConfig.azureSignOptions = yield* AzureTrustedSigningOptionsConfig;
    }
    buildConfig.win = winConfig;
    if (target === "nsis") {
      const nsisConfig: Record<string, unknown> = {
        differentialPackage: true,
        oneClick: true,
        perMachine: false,
        runAfterFinish: false,
      };
      if (installerNshStaged) {
        nsisConfig.include = "./build/installer.nsh";
      }
      buildConfig.nsis = nsisConfig;
    }
  }

  return buildConfig;
});

/**
 * Stage the VS Code runtime from the source directory into the build staging
 * area. Returns `true` if staging succeeded, `false` if the source was not
 * found (caller should switch to thin mode in that case).
 *
 * Source resolution order:
 *  1. `TABS_CODE_OSS_BUILD_DIR` env var — an explicit path to a pre-built
 *     tabs-code-main directory (e.g. on a CI runner that checked it out
 *     separately).
 *  2. `<repoRoot>/../tabs-code-main` — the conventional sibling checkout used
 *     in local development.
 */
const stageVsCodeRuntime = Effect.fn("stageVsCodeRuntime")(function* (
  repoRoot: string,
  stageResourcesDir: string,
  platform: typeof BuildPlatform.Type,
  thinRequested = false,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  // Honour an explicit override first (useful for CI runners that check out
  // tabs-code-main into a non-standard location).
  const envOverride = process.env.TABS_CODE_OSS_BUILD_DIR?.trim();
  const vsCodeSourceDir = envOverride
    ? path.resolve(envOverride)
    : path.join(repoRoot, "..", "tabs-code-main");
  const vsCodeDestDir = path.join(stageResourcesDir, "tabs-code-main");
  const packagedExtensionsDir = path.join(vsCodeSourceDir, ".build", "extensions");

  if (!(yield* fs.exists(vsCodeSourceDir))) {
    if (!thinRequested) {
      return yield* new BuildScriptError({
        message:
          `VS Code runtime source not found at ${vsCodeSourceDir}. ` +
          "Cannot create bundled desktop installer without tabs-code-main. " +
          "Set TABS_CODE_OSS_BUILD_DIR to override the source path, or pass --thin if you intentionally want to build a thin installer.",
      });
    }
    yield* Effect.log(
      `[desktop-artifact] VS Code runtime source not found at ${vsCodeSourceDir}. ` +
        "Thin mode was requested — building thin installer without bundled runtime.",
    );
    return false;
  }

  if (!(yield* fs.exists(packagedExtensionsDir))) {
    return yield* new BuildScriptError({
      message:
        `The VS Code runtime at ${vsCodeSourceDir} has no production-packaged extensions. ` +
        "Run `npm run gulp compile-extensions-build` and " +
        "`npm run gulp compile-copilot-extension-build` in tabs-code-main before building. " +
        "Shipping the source extensions directory would include gigabytes of build/test dependencies.",
    });
  }

  // Guard: the source must be FULLY compiled before we stage/zip it. A common
  // failure mode is a tree where the core `out/` exists but the built-in
  // extensions were never compiled (no `extensions/<name>/out`). At runtime that
  // surfaces as "Cannot find module .../<ext>/out/..." plus a cascade of failed
  // activations (debug-auto-launch, references-view, npm, git-base → git →
  // CodeRabbit, …) and a stale-looking workbench with dead buttons. Fail loudly
  // here instead of packaging a half-built runtime (or uploading a broken
  // runtime zip that thin installers download).
  //
  // Markers are derived DYNAMICALLY from each built-in's package.json `main`, so
  // this guard can never drift out of sync with the extension set (a previous
  // hardcoded allowlist silently passed when newly-added or previously-skipped
  // built-ins shipped without an `out/`). For every extension that declares a
  // node `main` pointing into a compiled output dir, require that dir to exist.
  const compiledMarkers = ["out/vs/code/electron-browser/workbench/workbench-dev.html"];
  const extensionsDir = path.join(vsCodeSourceDir, "extensions");
  if (yield* fs.exists(extensionsDir)) {
    for (const entry of yield* fs.readDirectory(extensionsDir)) {
      if (entry === "node_modules") continue;
      const extDir = path.join(extensionsDir, entry);
      const stat = yield* fs.stat(extDir).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!stat || stat.type !== "Directory") continue;
      const pkgPath = path.join(extDir, "package.json");
      if (!(yield* fs.exists(pkgPath))) continue;
      const pkgText = yield* fs
        .readFileString(pkgPath)
        .pipe(Effect.catch(() => Effect.succeed("")));
      const main = readPackageMain(pkgText);
      const outputDir = main ? compiledOutputDir(main) : null;
      if (outputDir) {
        compiledMarkers.push(path.join("extensions", entry, outputDir));
      }
    }
  }
  // fs-copyfile loads its native binding on macOS only; Linux and Windows use
  // its JavaScript fallback. Keep the source package available for packaging.
  compiledMarkers.push("extensions/git/node_modules/@vscode/fs-copyfile/lib/native.js");
  // Marketplace signature verification runs in the shared process. The
  // verifier lives in build/node_modules in a source checkout and is copied
  // into the packaged runtime below before build/ is removed.
  compiledMarkers.push("build/node_modules/@vscode/vsce-sign/src/main.js");

  const missingMarkers: string[] = [];
  for (const marker of compiledMarkers) {
    if (!(yield* fs.exists(path.join(vsCodeSourceDir, marker)))) {
      missingMarkers.push(marker);
    }
  }
  if (missingMarkers.length > 0) {
    return yield* new BuildScriptError({
      message:
        `The VS Code runtime at ${vsCodeSourceDir} is not fully compiled — missing: ` +
        `${missingMarkers.join(", ")}. Compile the core AND the built-in extensions before ` +
        "building (in tabs-code-main run `npm run compile`, which runs the gulp `compile-extensions` " +
        "task), then point TABS_CODE_OSS_BUILD_DIR at the fully compiled tree.",
    });
  }

  const packagedFsCopyfile = path.join(
    packagedExtensionsDir,
    "git",
    "node_modules",
    "@vscode",
    "fs-copyfile",
  );
  const packagedFsCopyfileMarker =
    platform === "mac"
      ? path.join(packagedFsCopyfile, "build", "Release", "vscode_fs.node")
      : path.join(packagedFsCopyfile, "lib", "native.js");
  if (!(yield* fs.exists(packagedFsCopyfileMarker))) {
    return yield* new BuildScriptError({
      message: `The packaged git extension is missing ${packagedFsCopyfileMarker}.`,
    });
  }

  yield* Effect.log("[desktop-artifact] Staging VS Code runtime...");
  yield* fs.makeDirectory(vsCodeDestDir, { recursive: true });
  const excludedSourceEntries = new Set([
    "extensions",
    ".build",
    "src",
    "test",
    ".git",
    ".github",
    ".vscode",
    ".devcontainer",
    ".eslint-plugin-local",
    "build",
    "cli",
    ".claude",
    ".gitignore",
  ]);
  for (const entry of yield* fs.readDirectory(vsCodeSourceDir)) {
    if (excludedSourceEntries.has(entry)) continue;
    const source = path.join(vsCodeSourceDir, entry);
    const destination = path.join(vsCodeDestDir, entry);
    const stat = yield* fs.stat(source);
    if (stat.type === "Directory") {
      yield* fs.copy(source, destination);
    } else if (stat.type === "File") {
      yield* fs.copyFile(source, destination);
    }
  }

  // The source extensions tree is a development checkout and can exceed 3 GB:
  // it contains TypeScript sources, tests and complete dev dependency trees.
  // Code-OSS' own build tasks apply each extension's VSIX inclusion rules,
  // bundle esbuild-based extensions and retain only required native/runtime
  // dependencies in .build/extensions. Always replace the copied source tree
  // with that canonical production output. Besides keeping release assets well
  // below GitHub's 2 GiB limit, this prevents development-only modules from
  // shadowing the exact dependencies the extension was packaged against.
  const stagedExtensionsDir = path.join(vsCodeDestDir, "extensions");
  yield* Effect.log("[desktop-artifact] Installing production-packaged Code-OSS extensions...");
  if (yield* fs.exists(stagedExtensionsDir)) {
    yield* fs.remove(stagedExtensionsDir, { recursive: true });
  }
  yield* fs.copy(packagedExtensionsDir, stagedExtensionsDir);

  // The shared process verifies Marketplace signatures with @vscode/vsce-sign.
  // Upstream installs that package under build/node_modules, but build/ is not
  // part of the runtime artifact. Preserve only the verifier and its matching
  // platform package in the runtime dependency tree before removing build/.
  const buildVscodeModules = path.join(vsCodeSourceDir, "build", "node_modules", "@vscode");
  const runtimeVscodeModules = path.join(vsCodeDestDir, "node_modules", "@vscode");
  if (yield* fs.exists(buildVscodeModules)) {
    for (const entry of yield* fs.readDirectory(buildVscodeModules)) {
      if (!entry.startsWith("vsce-sign")) continue;
      yield* fs.copy(path.join(buildVscodeModules, entry), path.join(runtimeVscodeModules, entry));
    }
  }

  // Remove problematic absolute symlinks that break code signing
  const claudeDir = path.join(vsCodeDestDir, ".claude");
  if (yield* fs.exists(claudeDir)) {
    yield* fs.remove(claudeDir, { recursive: true });
  }

  // Also remove test fixtures with symlinks
  const terminalSuggestFixtures = path.join(
    vsCodeDestDir,
    "extensions/terminal-suggest/src/test/fixtures/symlink-test",
  );
  if (yield* fs.exists(terminalSuggestFixtures)) {
    yield* fs.remove(terminalSuggestFixtures, { recursive: true });
  }

  // Remove development-only directories that are not needed at runtime.
  yield* Effect.log("[desktop-artifact] Removing development-only files from VS Code runtime...");
  const devOnlyDirs = [
    "src",
    "test",
    ".git",
    ".github",
    ".vscode",
    ".devcontainer",
    ".eslint-plugin-local",
    ".build",
    "build",
    "cli",
  ];
  for (const dir of devOnlyDirs) {
    const dirPath = path.join(vsCodeDestDir, dir);
    if (yield* fs.exists(dirPath)) {
      yield* fs.remove(dirPath, { recursive: true });
    }
  }

  // Remove .gitignore so electron-builder does not honour it when packaging
  // extraFiles. The root .gitignore contains `node_modules/`, which causes
  // electron-builder to exclude native runtime dependencies from the bundle.
  const gitignorePath = path.join(vsCodeDestDir, ".gitignore");
  if (yield* fs.exists(gitignorePath)) {
    yield* fs.remove(gitignorePath);
  }

  // Drop large, clearly build/test-only node_modules that the native runtime
  // does not import. A blanket `npm prune --omit=dev` is not safe because some
  // runtime dependencies are classified as development dependencies upstream.
  yield* Effect.log("[desktop-artifact] Trimming dev-only node_modules from VS Code runtime...");
  const devOnlyModules = [
    "electron", // tabs-code-main's build Electron; the runtime uses Tabs' Electron
    "@github",
    "playwright",
    "@playwright",
    "typescript",
    "@typescript",
    "@ts-morph",
    "innosetup",
    "@azure",
    "@actions",
    "pseudo-localization",
    "agent-browser",
  ];
  for (const mod of devOnlyModules) {
    const modPath = path.join(vsCodeDestDir, "node_modules", mod);
    if (yield* fs.exists(modPath)) {
      yield* fs.remove(modPath, { recursive: true });
    }
  }

  // Clean up only dangling symlinks (but keep .bin directories intact — they
  // are needed by node_modules at runtime). Unix-only: `find` here is the POSIX
  // tool; on Windows the same name resolves to an unrelated text-search command,
  // and npm uses junctions/cmd-shims rather than dangling symlinks there anyway.
  if (process.platform !== "win32") {
    yield* Effect.log("[desktop-artifact] Cleaning up dangling symlinks...");
    yield* Effect.sync(() => {
      spawnSync("find", [".", "-type", "l", "!", "-exec", "test", "-e", "{}", ";", "-delete"], {
        cwd: vsCodeDestDir,
      });
    });
  }

  return true;
});

const assertPlatformBuildResources = Effect.fn("assertPlatformBuildResources")(function* (
  platform: typeof BuildPlatform.Type,
  stageResourcesDir: string,
  verbose: boolean,
) {
  if (platform === "mac") {
    yield* stageMacIcons(stageResourcesDir, verbose);
    return;
  }

  if (platform === "linux") {
    yield* stageLinuxIcons(stageResourcesDir);
    return;
  }

  if (platform === "win") {
    yield* stageWindowsIcons(stageResourcesDir);
  }
});

/**
 * Emit the staged (pruned) VS Code runtime as a standalone release asset
 * (`tabs-code-runtime-<version>-<os>-<arch>.zip` + `.sha256`) for thin
 * installers to download on first run. The archive's top-level entry is
 * `tabs-code-main/`, matching what `codeOssRuntimeInstaller` expects.
 */
const emitCodeOssRuntimeBundle = Effect.fn("emitCodeOssRuntimeBundle")(function* (input: {
  readonly runtimeDir: string;
  readonly outputDir: string;
  readonly version: string;
  readonly arch: typeof BuildArch.Type;
  readonly platform: typeof BuildPlatform.Type;
  readonly verbose: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(input.runtimeDir))) {
    return yield* new BuildScriptError({
      message: `Cannot emit runtime bundle: ${input.runtimeDir} does not exist.`,
    });
  }
  yield* fs.makeDirectory(input.outputDir, { recursive: true });
  const osTag = input.platform === "mac" ? "mac" : input.platform === "win" ? "win" : "linux";
  const zipName = `tabs-code-runtime-${input.version}-${osTag}-${input.arch}.zip`;
  const zipPath = path.join(input.outputDir, zipName);
  yield* fs.remove(zipPath, { force: true }).pipe(Effect.ignore({ log: true }));
  yield* Effect.log(`[desktop-artifact] Emitting Code-OSS runtime bundle ${zipName}...`);

  if (input.platform === "mac") {
    yield* runCommand(
      ChildProcess.make({
        ...commandOutputOptions(input.verbose),
      })`ditto -c -k --keepParent ${input.runtimeDir} ${zipPath}`,
    );
  } else if (input.platform === "win") {
    yield* runCommand(
      ChildProcess.make({
        shell: true,
        ...commandOutputOptions(input.verbose),
      })`powershell -NoProfile -Command Compress-Archive -Force -Path '${input.runtimeDir}' -DestinationPath '${zipPath}'`,
    );
  } else {
    yield* runCommand(
      ChildProcess.make({
        cwd: path.dirname(input.runtimeDir),
        ...commandOutputOptions(input.verbose),
      })`zip -r -q -y ${zipPath} ${path.basename(input.runtimeDir)}`,
    );
  }

  yield* Effect.sync(() => {
    const digest = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
    writeFileSync(`${zipPath}.sha256`, `${digest}  ${zipName}\n`);
  });
  yield* Effect.log(`[desktop-artifact] Runtime bundle ready: ${zipPath}`);
});

const buildDesktopArtifact = Effect.fn("buildDesktopArtifact")(function* (
  options: ResolvedBuildOptions,
) {
  const repoRoot = yield* RepoRoot;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const platformConfig = PLATFORM_CONFIG[options.platform];
  if (!platformConfig) {
    return yield* new BuildScriptError({
      message: `Unsupported platform '${options.platform}'.`,
    });
  }

  const electronVersion = desktopPackageJson.dependencies.electron;

  const serverDependencies = serverPackageJson.dependencies;
  if (!serverDependencies || Object.keys(serverDependencies).length === 0) {
    return yield* new BuildScriptError({
      message: "Could not resolve production dependencies from apps/server/package.json.",
    });
  }

  // Drop `workspace:*` deps (e.g. `effect-acp`, `effect-codex-app-server`): they
  // are bundled into the server output by tsdown's `noExternal`, so they must
  // not appear in the staged package.json — the staged install has no workspace
  // and would fail to resolve them.
  const externalServerDependencies = Object.fromEntries(
    Object.entries(serverDependencies).filter(
      ([, spec]) => typeof spec !== "string" || !spec.startsWith("workspace:"),
    ),
  );
  const resolvedServerDependencies = yield* Effect.try({
    try: () =>
      resolveCatalogDependencies(
        externalServerDependencies,
        rootPackageJson.workspaces.catalog,
        "apps/server",
      ),
    catch: (cause) =>
      new BuildScriptError({
        message: "Could not resolve production dependencies from apps/server/package.json.",
        cause,
      }),
  });
  const resolvedDesktopRuntimeDependencies = yield* Effect.try({
    try: () =>
      resolveDesktopRuntimeDependencies(
        desktopPackageJson.dependencies,
        rootPackageJson.workspaces.catalog,
      ),
    catch: (cause) =>
      new BuildScriptError({
        message: "Could not resolve desktop runtime dependencies from apps/desktop/package.json.",
        cause,
      }),
  });

  const appVersion = options.version ?? serverPackageJson.version;
  const commitHash = resolveGitCommitHash(repoRoot);
  const mkdir = options.keepStage ? fs.makeTempDirectory : fs.makeTempDirectoryScoped;
  const stageRoot = yield* mkdir({
    prefix: `tabs-desktop-${options.platform}-stage-`,
  });

  const stageAppDir = path.join(stageRoot, "app");
  const stageResourcesDir = path.join(stageAppDir, "apps/desktop/resources");
  const distDirs = {
    desktopDist: path.join(repoRoot, "apps/desktop/dist-electron"),
    desktopResources: path.join(repoRoot, "apps/desktop/resources"),
    serverDist: path.join(repoRoot, "apps/server/dist"),
  };
  const bundledClientEntry = path.join(distDirs.serverDist, "client/index.html");

  if (!options.skipBuild) {
    yield* Effect.log("[desktop-artifact] Building desktop/server/web artifacts...");
    yield* runCommand(
      ChildProcess.make({
        cwd: repoRoot,
        ...commandOutputOptions(options.verbose),
        // Windows needs shell mode to resolve .cmd shims (e.g. bun.cmd).
        shell: process.platform === "win32",
      })`bun run build:desktop`,
    );
  }

  for (const [label, dir] of Object.entries(distDirs)) {
    if (!(yield* fs.exists(dir))) {
      return yield* new BuildScriptError({
        message: `Missing ${label} at ${dir}. Run 'bun run build:desktop' first.`,
      });
    }
  }

  if (!(yield* fs.exists(bundledClientEntry))) {
    return yield* new BuildScriptError({
      message: `Missing bundled server client at ${bundledClientEntry}. Run 'bun run build:desktop' first.`,
    });
  }

  yield* validateBundledClientAssets(path.dirname(bundledClientEntry));

  yield* fs.makeDirectory(path.join(stageAppDir, "apps/desktop"), { recursive: true });
  yield* fs.makeDirectory(path.join(stageAppDir, "apps/server"), { recursive: true });

  yield* Effect.log("[desktop-artifact] Staging release app...");
  yield* fs.copy(distDirs.desktopDist, path.join(stageAppDir, "apps/desktop/dist-electron"));
  yield* fs.copy(distDirs.desktopResources, stageResourcesDir);
  yield* fs.copy(distDirs.serverDist, path.join(stageAppDir, "apps/server/dist"));

  const runtimeStaged = yield* stageVsCodeRuntime(
    repoRoot,
    stageResourcesDir,
    options.platform,
    options.thin,
  );
  yield* assertPlatformBuildResources(options.platform, stageResourcesDir, options.verbose);

  if (!options.thin && !runtimeStaged) {
    return yield* new BuildScriptError({
      message:
        "VS Code runtime could not be staged for bundled desktop artifact. " +
        "Ensure tabs-code-main is present and compiled, or pass --thin for a thin installer.",
    });
  }
  const effectiveThin = options.thin;

  // Thin build: emit the staged runtime as a downloadable release asset, then
  // let it be excluded from the app bundle below (createBuildConfig drops the
  // tabs-code-main extraFiles entry when thin).
  if (effectiveThin && runtimeStaged) {
    yield* emitCodeOssRuntimeBundle({
      runtimeDir: path.join(stageResourcesDir, "tabs-code-main"),
      outputDir: options.outputDir,
      version: appVersion,
      arch: options.arch,
      platform: options.platform,
      verbose: options.verbose,
    });
  }

  // Copy prod-resources but EXCLUDE tabs-code-main since it's already in stageResourcesDir
  // and will be packaged separately outside the asar by electron-builder's extraFiles config
  const prodResourcesDir = path.join(stageAppDir, "apps/desktop/prod-resources");
  yield* fs.makeDirectory(prodResourcesDir, { recursive: true });

  const resourceEntries = yield* fs.readDirectory(stageResourcesDir);
  for (const entry of resourceEntries) {
    // Skip tabs-code-main - it should NOT be in the asar file
    if (entry === "tabs-code-main") {
      continue;
    }
    const from = path.join(stageResourcesDir, entry);
    const to = path.join(prodResourcesDir, entry);
    const stat = yield* fs.stat(from).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!stat) continue;

    if (stat.type === "Directory") {
      yield* fs.copy(from, to);
    } else if (stat.type === "File") {
      yield* fs.copyFile(from, to);
    }
  }

  // Ship the afterPack hook (referenced by createBuildConfig below). It restores
  // tabs-code-main/node_modules into the packaged resources on Windows/Linux
  // (electron-builder drops it from the extraFiles copy). Resolve the source
  // relative to this module — not process.cwd() — so it works regardless of the
  // invocation directory. Only flip the build-config flag once the file is
  // actually in place, so a missing hook can never become an electron-builder
  // "cannot resolve ./build/afterPack.cjs" failure.
  const afterPackSource = path.join(repoRoot, "scripts", "desktop-afterpack.cjs");
  const symlinkSanitizerSource = path.join(repoRoot, "scripts", "lib", "mac-symlink-sanitizer.cjs");
  let afterPackHookStaged = false;
  if ((yield* fs.exists(afterPackSource)) && (yield* fs.exists(symlinkSanitizerSource))) {
    const afterPackDestDir = path.join(stageAppDir, "build");
    yield* fs.makeDirectory(afterPackDestDir, { recursive: true });
    yield* fs.copyFile(afterPackSource, path.join(afterPackDestDir, "afterPack.cjs"));
    yield* fs.copyFile(
      symlinkSanitizerSource,
      path.join(afterPackDestDir, "mac-symlink-sanitizer.cjs"),
    );
    afterPackHookStaged = true;
  } else {
    return yield* new BuildScriptError({
      message: "Desktop afterPack hook or macOS symlink sanitizer is missing.",
    });
  }

  const installerNshSource = path.join(repoRoot, "scripts", "installer.nsh");
  let installerNshStaged = false;
  if (yield* fs.exists(installerNshSource)) {
    const buildDestDir = path.join(stageAppDir, "build");
    yield* fs.makeDirectory(buildDestDir, { recursive: true });
    yield* fs.copyFile(installerNshSource, path.join(buildDestDir, "installer.nsh"));
    yield* fs.copyFile(
      path.join(repoRoot, "scripts", "close-windows-install-processes.ps1"),
      path.join(buildDestDir, "close-windows-install-processes.ps1"),
    );
    installerNshStaged = true;
  }

  const stagePackageJson: StagePackageJson = {
    name: "tabs-desktop",
    version: appVersion,
    buildVersion: appVersion,
    tabsCommitHash: commitHash,
    private: true,
    description: "Tabs desktop build",
    author: "Tabs",
    main: "apps/desktop/dist-electron/main.js",
    build: yield* createBuildConfig(
      options.platform,
      options.target,
      desktopPackageJson.productName ?? "Tabs",
      options.signed,
      effectiveThin,
      afterPackHookStaged,
      installerNshStaged,
      (() => {
        const releaseNotesPath = path.join(
          repoRoot,
          "..",
          ".github",
          "release-notes",
          `v${appVersion}.md`,
        );
        return existsSync(releaseNotesPath) ? readFileSync(releaseNotesPath, "utf8").trim() : null;
      })(),
    ),
    dependencies: {
      ...resolvedServerDependencies,
      ...resolvedDesktopRuntimeDependencies,
    },
    devDependencies: {
      electron: electronVersion,
    },
    overrides: {
      "@effect/platform-node-shared":
        (rootPackageJson.workspaces?.catalog as Record<string, string> | undefined)?.[
          "@effect/platform-node-shared"
        ] ??
        (rootPackageJson.workspaces?.catalog as Record<string, string> | undefined)?.effect ??
        "4.0.0-beta.78",
      effect:
        (rootPackageJson.workspaces?.catalog as Record<string, string> | undefined)?.effect ??
        "4.0.0-beta.78",
      // Pin to a version confirmed to exist on registry.npmjs.org.
      "undici-types": "8.11.0",
    },
  };

  const stagePackageJsonString = yield* encodeJsonString(stagePackageJson);
  yield* fs.writeFileString(path.join(stageAppDir, "package.json"), `${stagePackageJsonString}\n`);

  yield* Effect.log("[desktop-artifact] Installing staged production dependencies...");
  yield* runCommandWithRetry(
    ChildProcess.make({
      cwd: stageAppDir,
      ...commandOutputOptions(options.verbose),
      // Windows needs shell mode to resolve .cmd shims (e.g. bun.cmd).
      shell: process.platform === "win32",
    })`bun install --production --no-progress`,
    {
      attempts: 3,
      baseDelaySeconds: 20,
      label: "staged production dependency install",
    },
  );

  // Validate Effect transitive dependencies to prevent version mismatch crashes (e.g. ByteSize import)
  const sharedPkgPath = path.join(
    stageAppDir,
    "node_modules/@effect/platform-node-shared/package.json",
  );
  if (yield* fs.exists(sharedPkgPath)) {
    const sharedPkg = JSON.parse(yield* fs.readFileString(sharedPkgPath)) as { version?: string };
    const expectedEffect =
      (rootPackageJson.workspaces?.catalog as Record<string, string> | undefined)?.[
        "@effect/platform-node-shared"
      ] ?? (rootPackageJson.workspaces?.catalog as Record<string, string> | undefined)?.effect;
    if (expectedEffect && sharedPkg.version !== expectedEffect) {
      return yield* new BuildScriptError({
        message: `Version mismatch in staged runtime: @effect/platform-node-shared is ${sharedPkg.version}, expected ${expectedEffect}.`,
      });
    }
  }

  // Clerk loads electron-store dynamically from its CommonJS storage entry.
  // Validate the isolated release tree before electron-builder packs it so a
  // missing transitive dependency cannot become a main-process launch crash.
  yield* assertRequiredPaths(
    stageAppDir,
    [
      "node_modules/@clerk/electron/dist/cjs/storage/index.js",
      "node_modules/electron-store/index.js",
      "apps/desktop/prod-resources/code-oss-extensions/tabs-embed-defaults/package.json",
      "apps/desktop/prod-resources/code-oss-extensions/tabs-workbench-integration/package.json",
    ],
    "Staged desktop runtime",
  );

  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
  };
  for (const [key, value] of Object.entries(buildEnv)) {
    if (value === "") {
      delete buildEnv[key];
    }
  }
  if (!options.signed) {
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    delete buildEnv.CSC_LINK;
    delete buildEnv.CSC_KEY_PASSWORD;
    delete buildEnv.APPLE_API_KEY;
    delete buildEnv.APPLE_API_KEY_ID;
    delete buildEnv.APPLE_API_ISSUER;
  }

  if (options.platform === "win" && options.target === "nsis") {
    // electron-builder 26.15.3 can write BCJ2 streams that its bundled NSIS
    // extractor cannot decode. BCJ keeps executable files installable.
    buildEnv.ELECTRON_BUILDER_7Z_FILTER = "BCJ";
  }

  if (process.platform === "win32") {
    const python = resolvePythonForNodeGyp();
    if (python) {
      buildEnv.PYTHON = python;
      buildEnv.npm_config_python = python;
    }
    buildEnv.npm_config_msvs_version = buildEnv.npm_config_msvs_version ?? "2022";
    buildEnv.GYP_MSVS_VERSION = buildEnv.GYP_MSVS_VERSION ?? "2022";
  }

  yield* Effect.log(
    `[desktop-artifact] Building ${options.platform}/${options.target} (arch=${options.arch}, version=${appVersion})...`,
  );
  yield* runCommandWithRetry(
    ChildProcess.make({
      cwd: stageAppDir,
      env: buildEnv,
      ...commandOutputOptions(options.verbose),
      // Windows needs shell mode to resolve .cmd shims.
      shell: process.platform === "win32",
    })`bunx electron-builder@26.15.3 ${platformConfig.cliFlag} --${options.arch} --publish never`,
    { label: "electron-builder" },
  );

  const stageDistDir = path.join(stageAppDir, "dist");
  if (!(yield* fs.exists(stageDistDir))) {
    return yield* new BuildScriptError({
      message: `Build completed but dist directory was not found at ${stageDistDir}`,
    });
  }

  if (options.platform === "mac" && options.target === "dmg") {
    yield* createMacDmgFromZip({
      stageDistDir,
      productName: desktopPackageJson.productName ?? "Tabs",
      version: appVersion,
      arch: options.arch,
      verbose: options.verbose,
      thin: effectiveThin,
      signed: options.signed,
    });
  }

  const stageEntries = yield* fs.readDirectory(stageDistDir);
  yield* fs.makeDirectory(options.outputDir, { recursive: true });

  const copiedArtifacts: string[] = [];
  for (const entry of stageEntries) {
    const from = path.join(stageDistDir, entry);
    const stat = yield* fs.stat(from).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!stat || stat.type !== "File") continue;

    const to = path.join(options.outputDir, entry);
    yield* fs.copyFile(from, to);
    copiedArtifacts.push(to);
  }

  if (copiedArtifacts.length === 0) {
    return yield* new BuildScriptError({
      message: `Build completed but no files were produced in ${stageDistDir}`,
    });
  }

  yield* Effect.log("[desktop-artifact] Done. Artifacts:").pipe(
    Effect.annotateLogs({ artifacts: copiedArtifacts }),
  );
});

const buildDesktopArtifactCli = Command.make("build-desktop-artifact", {
  platform: Flag.choice("platform", BuildPlatform.literals).pipe(
    Flag.withDescription("Build platform (env: TABS_DESKTOP_PLATFORM)."),
    Flag.optional,
  ),
  target: Flag.string("target").pipe(
    Flag.withDescription(
      "Artifact target, for example dmg/AppImage/nsis (env: TABS_DESKTOP_TARGET).",
    ),
    Flag.optional,
  ),
  arch: Flag.choice("arch", BuildArch.literals).pipe(
    Flag.withDescription("Build arch, for example arm64/x64/universal (env: TABS_DESKTOP_ARCH)."),
    Flag.optional,
  ),
  buildVersion: Flag.string("build-version").pipe(
    Flag.withDescription("Artifact version metadata (env: TABS_DESKTOP_VERSION)."),
    Flag.optional,
  ),
  outputDir: Flag.string("output-dir").pipe(
    Flag.withDescription("Output directory for artifacts (env: TABS_DESKTOP_OUTPUT_DIR)."),
    Flag.optional,
  ),
  skipBuild: Flag.boolean("skip-build").pipe(
    Flag.withDescription(
      "Skip `bun run build:desktop` and use existing dist artifacts (env: TABS_DESKTOP_SKIP_BUILD).",
    ),
    Flag.optional,
  ),
  keepStage: Flag.boolean("keep-stage").pipe(
    Flag.withDescription("Keep temporary staging files (env: TABS_DESKTOP_KEEP_STAGE)."),
    Flag.optional,
  ),
  signed: Flag.boolean("signed").pipe(
    Flag.withDescription(
      "Enable signing/notarization discovery; Windows uses Azure Trusted Signing (env: TABS_DESKTOP_SIGNED).",
    ),
    Flag.optional,
  ),
  verbose: Flag.boolean("verbose").pipe(
    Flag.withDescription("Stream subprocess stdout (env: TABS_DESKTOP_VERBOSE)."),
    Flag.optional,
  ),
  thin: Flag.boolean("thin").pipe(
    Flag.withDescription(
      "Thin build: don't bundle the VS Code runtime; emit it as tabs-code-runtime-*.zip for on-demand download (env: TABS_DESKTOP_THIN).",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Build a desktop artifact for Tabs."),
  Command.withHandler((input) => Effect.flatMap(resolveBuildOptions(input), buildDesktopArtifact)),
);

const cliRuntimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

Command.run(buildDesktopArtifactCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
  NodeRuntime.runMain,
);
