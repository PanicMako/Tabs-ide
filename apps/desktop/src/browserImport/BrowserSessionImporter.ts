import * as FS from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import {
  type BrowserImportInput,
  type BrowserImportResult,
  type BrowserImportSource,
  type BrowserImportSourceId,
  type BrowserImportSourceProfile,
  type BrowserImportUnavailableReason,
} from "@tabs/contracts";
import { session as electronSession, type Session } from "electron";
import { normalizeBrowserProfileId } from "../browserHostManager";
import { normalizeProfileIdentifier } from "../profileStorage";
import { readChromiumCookies } from "./ChromiumCookies";
import { type ChromiumKeyMaterial } from "./ChromiumKeys";
import { type ImportedCookie } from "./CookieDatabase";
import { readFirefoxCookies } from "./FirefoxCookies";
import { readSafariCookies, safariAccessDenied } from "./SafariCookies";

export interface SyntheticCookieInput {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path?: string | undefined;
  readonly secure?: boolean | undefined;
  readonly httpOnly?: boolean | undefined;
  readonly sameSite?: "unspecified" | "no_restriction" | "lax" | "strict" | undefined;
  readonly expirationDate?: number | undefined;
}

export interface SyntheticCookieImportOptions {
  readonly allowedDomains?: readonly string[] | undefined;
  readonly explicitConsentGiven?: boolean | undefined;
}

/**
 * Hardened synthetic cookie import engine.
 *
 * Enforces:
 * 1. Target profile isolation (validates normalized profile ID to prevent partition breakout).
 * 2. Scope restriction (filters to allowed domains if specified).
 * 3. Never logs cookie values or includes values in error messages.
 * 4. Preserves Secure, HttpOnly, SameSite, domain, path, and expiration semantics.
 * 5. Deterministic partial-failure accounting.
 */
export async function importSyntheticCookiesToSession(
  targetSession: { cookies: { set: (details: Electron.CookiesSetDetails) => Promise<void> } },
  targetProfileId: string,
  cookies: readonly SyntheticCookieInput[],
  options?: SyntheticCookieImportOptions,
): Promise<BrowserImportResult> {
  const normalizedProfile = normalizeProfileIdentifier(targetProfileId);
  if (!normalizedProfile) {
    throw new Error("Invalid target profile identifier.");
  }

  let imported = 0;
  let skipped = 0;
  const skippedDomains = new Set<string>();

  const allowedDomainsSet = options?.allowedDomains
    ? new Set(options.allowedDomains.map((d) => d.toLowerCase().replace(/^\./, "")))
    : null;

  for (const cookie of cookies) {
    const rawDomain = (cookie.domain || "").trim().toLowerCase();
    const cleanDomain = rawDomain.replace(/^\./, "");

    if (!cleanDomain || !cookie.name || typeof cookie.value !== "string") {
      skipped++;
      if (cleanDomain) skippedDomains.add(cleanDomain);
      continue;
    }

    if (allowedDomainsSet && !allowedDomainsSet.has(cleanDomain)) {
      skipped++;
      skippedDomains.add(cleanDomain);
      continue;
    }

    const scheme = cookie.secure ? "https:" : "http:";
    const path = cookie.path && cookie.path.startsWith("/") ? cookie.path : "/";
    const url = `${scheme}//${cleanDomain}${path}`;

    try {
      const details: Electron.CookiesSetDetails = {
        url,
        name: cookie.name,
        value: cookie.value,
        domain: rawDomain.startsWith(".") ? rawDomain : cleanDomain,
        path,
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite ?? "lax",
      };
      if (typeof cookie.expirationDate === "number") {
        details.expirationDate = cookie.expirationDate;
      }
      await targetSession.cookies.set(details);
      imported++;
    } catch {
      // Deterministic partial-failure handling: count as skipped, record domain, NEVER log cookie value
      skipped++;
      skippedDomains.add(cleanDomain);
    }
  }

  return {
    imported,
    skipped,
    skippedDomains: Array.from(skippedDomains),
  };
}

interface BrowserSourceConfig {
  readonly id: BrowserImportSourceId;
  readonly name: string;
  readonly engine: "chromium" | "firefox" | "safari";
  readonly processNames: readonly string[];
  readonly keychainService?: string;
  readonly keychainAccount?: string;
  readonly linuxSecretApplication?: string;
  readonly getUserDataDir: (platform: NodeJS.Platform) => string | null;
}

const BROWSER_CONFIGS: readonly BrowserSourceConfig[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    engine: "chromium",
    processNames: ["Google Chrome", "chrome", "chrome.exe"],
    keychainService: "Chrome Safe Storage",
    keychainAccount: "Chrome",
    linuxSecretApplication: "chrome",
    getUserDataDir: (platform) => {
      const home = Os.homedir();
      if (platform === "darwin") {
        return Path.join(home, "Library/Application Support/Google/Chrome");
      }
      if (platform === "win32") {
        return Path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/User Data");
      }
      return Path.join(home, ".config/google-chrome");
    },
  },
  {
    id: "brave",
    name: "Brave",
    engine: "chromium",
    processNames: ["Brave Browser", "brave", "brave.exe"],
    keychainService: "Brave Safe Storage",
    keychainAccount: "Brave",
    linuxSecretApplication: "brave",
    getUserDataDir: (platform) => {
      const home = Os.homedir();
      if (platform === "darwin") {
        return Path.join(home, "Library/Application Support/BraveSoftware/Brave-Browser");
      }
      if (platform === "win32") {
        return Path.join(process.env.LOCALAPPDATA || "", "BraveSoftware/Brave-Browser/User Data");
      }
      return Path.join(home, ".config/BraveSoftware/Brave-Browser");
    },
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    engine: "chromium",
    processNames: ["Microsoft Edge", "msedge", "msedge.exe"],
    keychainService: "Microsoft Edge Safe Storage",
    keychainAccount: "Microsoft Edge",
    linuxSecretApplication: "msedge",
    getUserDataDir: (platform) => {
      const home = Os.homedir();
      if (platform === "darwin") {
        return Path.join(home, "Library/Application Support/Microsoft Edge");
      }
      if (platform === "win32") {
        return Path.join(process.env.LOCALAPPDATA || "", "Microsoft/Edge/User Data");
      }
      return Path.join(home, ".config/microsoft-edge");
    },
  },
  {
    id: "chromium",
    name: "Chromium",
    engine: "chromium",
    processNames: ["Chromium", "chromium", "chromium-browser", "chromium.exe"],
    keychainService: "Chromium Safe Storage",
    keychainAccount: "Chromium",
    linuxSecretApplication: "chromium",
    getUserDataDir: (platform) =>
      platform === "darwin"
        ? Path.join(Os.homedir(), "Library/Application Support/Chromium")
        : platform === "win32"
          ? Path.join(process.env.LOCALAPPDATA || "", "Chromium/User Data")
          : Path.join(Os.homedir(), ".config/chromium"),
  },
  {
    id: "arc",
    name: "Arc",
    engine: "chromium",
    processNames: ["Arc"],
    keychainService: "Arc Safe Storage",
    keychainAccount: "Arc",
    getUserDataDir: (platform) =>
      platform === "darwin"
        ? Path.join(Os.homedir(), "Library/Application Support/Arc/User Data")
        : null,
  },
  {
    id: "firefox",
    name: "Mozilla Firefox",
    engine: "firefox",
    processNames: ["firefox", "firefox.exe"],
    getUserDataDir: (platform) => {
      const home = Os.homedir();
      if (platform === "darwin") {
        return Path.join(home, "Library/Application Support/Firefox");
      }
      if (platform === "win32") {
        return Path.join(process.env.APPDATA || "", "Mozilla/Firefox");
      }
      return Path.join(home, ".mozilla/firefox");
    },
  },
  {
    id: "safari",
    name: "Safari",
    engine: "safari",
    processNames: ["Safari"],
    getUserDataDir: (platform) => {
      if (platform !== "darwin") return null;
      return Path.join(Os.homedir(), "Library/Containers/com.apple.Safari/Data/Library/Cookies");
    },
  },
];

export class BrowserSessionImporter {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly isProcessRunningFn: (
      processNames: readonly string[],
    ) => Promise<boolean> = isProcessRunningDefault,
    private readonly userDataDirOverrides?: Partial<Record<BrowserImportSourceId, string>>,
    private readonly keyOverrides?: Partial<Record<BrowserImportSourceId, ChromiumKeyMaterial>>,
  ) {}

  async listSources(): Promise<BrowserImportSource[]> {
    const sources: BrowserImportSource[] = [];

    for (const config of BROWSER_CONFIGS) {
      const userDataDir =
        this.userDataDirOverrides?.[config.id] ?? config.getUserDataDir(this.platform);
      if (!userDataDir) {
        continue;
      }

      let installed = false;
      try {
        const stat = await FS.stat(userDataDir);
        installed = stat.isDirectory();
      } catch {
        installed = false;
      }

      if (!installed) {
        continue;
      }

      const running = await this.isProcessRunningFn(config.processNames);
      let unavailable: BrowserImportUnavailableReason | undefined;
      if (running) {
        unavailable = "browserRunning";
      } else if (config.id === "safari") {
        const jar = Path.join(userDataDir, "Cookies.binarycookies");
        if (await safariAccessDenied(jar)) {
          unavailable = "needsFullDiskAccess";
        }
      }

      const profiles = await this.discoverProfiles(config.id, userDataDir);

      sources.push({
        id: config.id,
        name: config.name,
        profiles,
        unavailable,
      });
    }

    return sources;
  }

  async discoverProfiles(
    sourceId: BrowserImportSourceId,
    userDataDir: string,
  ): Promise<BrowserImportSourceProfile[]> {
    if (sourceId === "safari") {
      return [
        {
          directory: "Default",
          name: "Default Profile",
        },
      ];
    }

    if (sourceId === "firefox") {
      return await this.discoverFirefoxProfiles(userDataDir);
    }

    return await this.discoverChromiumProfiles(userDataDir);
  }

  private async discoverChromiumProfiles(
    userDataDir: string,
  ): Promise<BrowserImportSourceProfile[]> {
    try {
      const entries = await FS.readdir(userDataDir, { withFileTypes: true });
      const profiles: BrowserImportSourceProfile[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirName = entry.name;
        if (dirName === "Default") {
          profiles.push({
            directory: "Default",
            name: "Default Profile",
          });
        } else if (dirName.startsWith("Profile ")) {
          profiles.push({
            directory: dirName,
            name: dirName,
          });
        }
      }

      if (profiles.length === 0) {
        profiles.push({
          directory: "Default",
          name: "Default Profile",
        });
      }

      return profiles;
    } catch {
      return [
        {
          directory: "Default",
          name: "Default Profile",
        },
      ];
    }
  }

  private async discoverFirefoxProfiles(
    userDataDir: string,
  ): Promise<BrowserImportSourceProfile[]> {
    const profiles: BrowserImportSourceProfile[] = [];

    // First attempt: parse profiles.ini
    const iniPath = Path.join(userDataDir, "profiles.ini");
    try {
      const iniContent = await FS.readFile(iniPath, "utf8");
      const lines = iniContent.split(/\r?\n/);
      let currentSection = "";
      let currentName = "";
      let currentPath = "";
      let isRelative = true;

      const flushSection = () => {
        if (currentSection.startsWith("Profile") && currentPath) {
          profiles.push({
            directory: currentPath,
            name: currentName || currentPath,
          });
        }
        currentSection = "";
        currentName = "";
        currentPath = "";
        isRelative = true;
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          flushSection();
          currentSection = trimmed.slice(1, -1);
        } else if (trimmed.startsWith("Name=")) {
          currentName = trimmed.slice(5).trim();
        } else if (trimmed.startsWith("Path=")) {
          currentPath = trimmed.slice(5).trim();
        } else if (trimmed.startsWith("IsRelative=")) {
          isRelative = trimmed.slice(11).trim() !== "0";
        }
      }
      flushSection();

      if (profiles.length > 0) {
        return profiles;
      }
    } catch {
      // Fall through to directory inspection
    }

    // Second attempt: scan profiles subdirectory or root directory for *.default*
    for (const searchDir of [Path.join(userDataDir, "Profiles"), userDataDir]) {
      try {
        const entries = await FS.readdir(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.includes(".default") || entry.name.includes("default-release")) {
            profiles.push({
              directory: Path.relative(userDataDir, Path.join(searchDir, entry.name)),
              name: entry.name,
            });
          }
        }
      } catch {
        // Continue
      }
      if (profiles.length > 0) break;
    }

    if (profiles.length === 0) {
      profiles.push({
        directory: "Default",
        name: "Default Profile",
      });
    }

    return profiles;
  }

  async importSelectedCookies(
    input: BrowserImportInput,
    overrideSession?: { cookies: Pick<Session["cookies"], "set" | "flushStore"> },
    signal?: AbortSignal,
  ): Promise<BrowserImportResult> {
    signal?.throwIfAborted();
    const targetProfileId = normalizeBrowserProfileId(input.targetProfileId);
    const config = BROWSER_CONFIGS.find((c) => c.id === input.sourceId);
    if (!config) {
      throw new Error(`Unknown browser source: ${input.sourceId}`);
    }

    const running = await this.isProcessRunningFn(config.processNames);
    if (running) {
      throw new Error(
        "Please quit the browser first so its cookie database can be safely read without lock contention.",
      );
    }

    const userDataDir =
      this.userDataDirOverrides?.[config.id] ?? config.getUserDataDir(this.platform);
    if (!userDataDir) {
      throw new Error(`Browser source ${input.sourceId} is not supported on this platform.`);
    }

    const profiles = await this.discoverProfiles(config.id, userDataDir);
    const matchedProfile = profiles.find(
      (profile) => profile.directory === input.sourceProfileDirectory,
    );
    if (!matchedProfile) {
      throw new Error("Selected browser profile was not found.");
    }

    // Resolve cookie database file candidates
    let candidatePaths: string[] = [];
    if (config.engine === "safari") {
      candidatePaths = [Path.join(userDataDir, "Cookies.binarycookies")];
    } else if (config.engine === "firefox") {
      const profilePath = Path.isAbsolute(input.sourceProfileDirectory)
        ? input.sourceProfileDirectory
        : Path.join(userDataDir, input.sourceProfileDirectory);
      candidatePaths = [Path.join(profilePath, "cookies.sqlite")];
    } else {
      // Chromium: Modern Chrome 96+ uses Network/Cookies; older versions use Cookies
      const profilePath = Path.isAbsolute(input.sourceProfileDirectory)
        ? input.sourceProfileDirectory
        : Path.join(userDataDir, input.sourceProfileDirectory);
      candidatePaths = [
        Path.join(profilePath, "Network", "Cookies"),
        Path.join(profilePath, "Cookies"),
      ];
    }

    let cookieDbPath: string | null = null;
    for (const cand of candidatePaths) {
      try {
        const stat = await FS.stat(cand);
        if (stat.isFile()) {
          cookieDbPath = cand;
          break;
        }
      } catch {
        // Continue to next candidate
      }
    }

    if (!cookieDbPath) {
      throw new Error("No readable cookie database was found for the selected browser profile.");
    }

    // Read cookies based on engine
    let cookies: readonly ImportedCookie[] = [];
    let initialUndecryptable = 0;
    let warnings: readonly string[] = [];
    const skippedDomains = new Set<string>();

    if (config.engine === "safari") {
      cookies = await readSafariCookies(cookieDbPath);
    } else if (config.engine === "firefox") {
      cookies = await readFirefoxCookies(cookieDbPath);
    } else {
      const readResult = await readChromiumCookies(
        {
          cookieDatabasePath: cookieDbPath,
          keychainService: config.keychainService,
          keychainAccount: config.keychainAccount,
          linuxSecretApplication: config.linuxSecretApplication,
          windowsLocalStatePath:
            this.platform === "win32" ? Path.join(userDataDir, "Local State") : undefined,
          platform: this.platform,
        },
        this.keyOverrides?.[config.id],
      );
      cookies = readResult.cookies;
      initialUndecryptable = readResult.undecryptable;
      warnings = readResult.warnings ?? [];
      for (const host of readResult.undecryptableHosts) {
        skippedDomains.add(host);
      }
    }

    // Cancellation after reading stops before any destination cookie is changed.
    if (signal?.aborted)
      return {
        cancelled: true,
        imported: 0,
        skipped: initialUndecryptable,
        skippedDomains: [],
        warnings: [...warnings],
      };

    // Resolve Electron target session
    const partition = `persist:tabs-browser:profile:${targetProfileId}`;
    const targetSession = overrideSession ?? electronSession.fromPartition(partition);

    let imported = 0;
    let skipped = initialUndecryptable;

    for (const cookie of cookies) {
      if (signal?.aborted) break;
      if (cookie.expirationDate !== undefined && cookie.expirationDate <= Date.now() / 1000) {
        skipped++;
        continue;
      }
      try {
        const details: Electron.CookiesSetDetails = {
          url: cookie.url,
          name: cookie.name,
          value: cookie.value,
          // CRITICAL: omit domain for host-only cookies so Electron does not widen them or reject __Host- cookies
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          ...(cookie.domain ? { domain: cookie.domain } : {}),
          ...(typeof cookie.expirationDate === "number"
            ? { expirationDate: cookie.expirationDate }
            : {}),
        };
        await targetSession.cookies.set(details);
        imported++;
      } catch {
        skipped++;
        try {
          skippedDomains.add(new URL(cookie.url).hostname);
        } catch {
          // Ignore
        }
      }
    }

    if (imported > 0 && typeof targetSession.cookies.flushStore === "function") {
      try {
        await targetSession.cookies.flushStore();
      } catch {
        warnings = [
          ...warnings,
          "Cookies were accepted but could not be flushed to disk. Persistence after restart is unverified.",
        ];
      }
    }

    return {
      cancelled: signal?.aborted ?? false,
      imported,
      skipped,
      skippedDomains: Array.from(skippedDomains).slice(0, 20),
      warnings: [...warnings],
    };
  }
}

async function isProcessRunningDefault(processNames: readonly string[]): Promise<boolean> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV"]);
      return processNames.some((name) => stdout.toLowerCase().includes(name.toLowerCase()));
    }

    for (const name of processNames) {
      try {
        const { stdout } = await execFileAsync(
          "pgrep",
          ["-f", name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")],
          { timeout: 5000 },
        );
        if (stdout.trim()) return true;
      } catch (error) {
        if ((error as { code?: unknown }).code !== 1) throw error;
      }
    }
    return false;
  } catch {
    throw new Error("Could not check whether the source browser is running. Close it and retry.");
  }
}
