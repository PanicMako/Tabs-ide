import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { GitEnvironmentResult } from "@tabs/contracts";

import { runProcess } from "../../processRunner.ts";
import { GitHubCliError } from "../Errors.ts";
import { clearGitHubReadMemo } from "../Services/GitHubReadMemo.ts";
import { clearPushAccessCache } from "../Services/PushAccessCache.ts";
import {
  GitEnvironment,
  type GitEnvironmentShape,
  parseGitHubAuthStatus,
} from "../Services/GitEnvironment.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

function isCommandNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Command not found:");
}

/** Run a command, returning null instead of throwing when the binary is absent. */
const tryRun = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) =>
  Effect.tryPromise({
    try: () =>
      runProcess(command, args, {
        cwd,
        timeoutMs,
        allowNonZeroExit: true,
      }),
    catch: (error) =>
      new GitHubCliError({
        operation: "execute",
        detail: error instanceof Error ? error.message : "Command failed.",
        cause: error,
      }),
  }).pipe(
    Effect.catch((error) =>
      isCommandNotFound(error.cause) || error.detail.includes("Command not found:")
        ? Effect.succeed(null)
        : Effect.fail(error),
    ),
  );

/**
 * `gh auth status` checks every signed-in account over the network (measured: ~1.5s with two
 * accounts), and `gh api user` is another ~0.6s, yet the Git tool waits on this answer before it
 * draws anything and asks again every thirty seconds. Who is signed in, and which account is
 * active, is already on disk in gh's own `hosts.yml`, so the answer is read from there at once.
 * The parts only the network knows (token scopes, the profile login) come from the slow read,
 * which runs in the background and is kept for a few minutes.
 */
const SLOW_DETAILS_TTL_MS = 5 * 60_000;
const slowDetails = new Map<string, { scopes: string[]; login: string }>();
/** Profile pictures as data URLs by `host:login`; a miss is retried on the next slow read. */
const avatars = new Map<string, string>();
let slowDetailsAt = 0;
let slowRefresh: Promise<void> | null = null;
const versionMemo = new Map<string, Promise<{ code: number | null; stdout: string } | null>>();

export function resetGitEnvironmentCachesForTests(): void {
  slowDetails.clear();
  avatars.clear();
  slowDetailsAt = 0;
  slowRefresh = null;
  versionMemo.clear();
}

function ghConfigDir(): string {
  const explicit = process.env.GH_CONFIG_DIR;
  if (explicit) return explicit;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "gh");
  if (process.platform === "win32" && process.env.AppData) {
    return join(process.env.AppData, "GitHub CLI");
  }
  return join(homedir(), ".config", "gh");
}

/** Hosts, their signed-in users and each host's active one, from `hosts.yml`; null if unreadable. */
export function parseGhHostsFile(
  text: string,
): ReadonlyArray<{ host: string; login: string; active: boolean }> | null {
  const accounts: Array<{ host: string; login: string; active: boolean }> = [];
  let host: string | null = null;
  let users: string[] = [];
  let active: string | null = null;
  let inUsers = false;
  const flush = () => {
    if (host === null) return;
    const names = users.length > 0 ? users : active !== null ? [active] : [];
    for (const login of names) accounts.push({ host, login, active: login === active });
  };
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim().length === 0 || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) {
      flush();
      const match = /^([^\s:]+):\s*$/.exec(line);
      host = match?.[1] ?? null;
      users = [];
      active = null;
      inUsers = false;
    } else if (host !== null && indent <= 4) {
      inUsers = false;
      if (line === "users:") inUsers = true;
      else {
        const match = /^user:\s*(\S+)\s*$/.exec(line);
        if (match) active = match[1] ?? null;
      }
    } else if (host !== null && inUsers && indent > 4) {
      const match = /^([^\s:]+):/.exec(line);
      if (match && indent <= 8) users.push(match[1]!);
    }
  }
  flush();
  return accounts.length > 0 ? accounts : null;
}

/**
 * A profile picture fetched by the server and handed to the page inline. The page used to load
 * `https://github.com/<login>.png` itself, which fails wherever the renderer cannot reach or is
 * not allowed to load that host, and then showed a bare initial. Only github.com has a public
 * avatar URL, so other hosts get none.
 */
async function fetchAvatar(host: string, login: string): Promise<string | null> {
  if (host !== "github.com") return null;
  // Unit tests must not reach the network.
  if (process.env.VITEST !== undefined && process.env.TABS_FORCE_AVATAR !== "1") return null;
  try {
    const response = await fetch(`https://github.com/${encodeURIComponent(login)}.png?size=64`, {
      redirect: "follow",
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "image/png";
    if (!type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 200_000) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function loadMissingAvatars(
  accounts: ReadonlyArray<{ host: string; login: string; authLogin: string }>,
): Promise<void> {
  await Promise.all(
    accounts.map(async (account) => {
      const key = `${account.host}:${account.authLogin}`;
      if (avatars.has(key)) return;
      // The profile login is the name GitHub knows; the credential label can be a stale one.
      const avatar =
        (await fetchAvatar(account.host, account.login)) ??
        (account.login === account.authLogin
          ? null
          : await fetchAvatar(account.host, account.authLogin));
      if (avatar !== null) avatars.set(key, avatar);
    }),
  );
}

export async function readGhHosts() {
  try {
    return parseGhHostsFile(await readFile(join(ghConfigDir(), "hosts.yml"), "utf8"));
  } catch {
    return null;
  }
}

function firstLine(value: string): string | null {
  const line = value.split(/\r?\n/)[0]?.trim();
  return line && line.length > 0 ? line : null;
}

const detectSlow: GitEnvironmentShape["detect"] = ({ cwd }) =>
  Effect.gen(function* () {
    // Three independent processes: starting them one after another made this page wait for
    // their sum. `gh auth status` exits non-zero when unauthenticated; we read its text
    // regardless and parse whatever accounts it reports. Older gh prints to stderr, newer to
    // stdout — combine both. A missing `gh` makes the status read come back null as well.
    const [gitVersion, ghVersion, ghStatus] = yield* Effect.all(
      [
        tryRun("git", ["--version"], cwd),
        tryRun("gh", ["--version"], cwd),
        tryRun("gh", ["auth", "status"], cwd),
      ],
      { concurrency: 3 },
    );

    const accounts =
      ghStatus !== null ? parseGitHubAuthStatus(`${ghStatus.stdout}\n${ghStatus.stderr}`) : [];
    const activeAccount = accounts.find((account) => account.active) ?? accounts[0] ?? null;

    // GitHub CLI may retain the username originally stored with the credential.
    // Resolve active profiles from GitHub while keeping that credential label for CLI actions.
    const profiles = yield* Effect.forEach(
      accounts.filter((account) => account.active),
      (account) =>
        tryRun(
          "gh",
          ["api", "user", "--hostname", account.host, "--jq", ".login"],
          cwd,
          5_000,
        ).pipe(
          Effect.map((response) => ({
            host: account.host,
            authLogin: account.login,
            login:
              response?.code === 0 && /^[a-zA-Z0-9-]+$/.test(response.stdout.trim())
                ? response.stdout.trim()
                : account.login,
          })),
          Effect.catch(() =>
            Effect.succeed({ host: account.host, authLogin: account.login, login: account.login }),
          ),
        ),
      { concurrency: 4 },
    );
    const currentLogin = (account: (typeof accounts)[number]) =>
      profiles.find(
        (profile) => profile.host === account.host && profile.authLogin === account.login,
      )?.login ?? account.login;

    yield* Effect.promise(() =>
      loadMissingAvatars(
        accounts.map((account) => ({
          host: account.host,
          login: currentLogin(account),
          authLogin: account.login,
        })),
      ),
    );

    const result: GitEnvironmentResult = {
      git: {
        installed: gitVersion !== null && gitVersion.code === 0,
        version: gitVersion ? firstLine(gitVersion.stdout) : null,
      },
      gitHub: {
        cliInstalled: ghVersion !== null && ghVersion.code === 0,
        version: ghVersion ? firstLine(ghVersion.stdout) : null,
        authenticated: accounts.length > 0,
        accounts: accounts.map((account) => {
          const avatarUrl = avatars.get(`${account.host}:${account.login}`);
          return {
            host: account.host,
            login: currentLogin(account),
            authLogin: account.login,
            active: account.active,
            scopes: account.scopes,
            ...(avatarUrl === undefined ? {} : { avatarUrl }),
          };
        }),
        activeLogin: activeAccount ? currentLogin(activeAccount) : null,
      },
    };
    for (const account of result.gitHub.accounts) {
      slowDetails.set(`${account.host}:${account.authLogin}`, {
        scopes: [...account.scopes],
        login: account.login,
      });
    }
    slowDetailsAt = Date.now();
    return result;
  });

const detect: GitEnvironmentShape["detect"] = ({ cwd }) =>
  Effect.gen(function* () {
    const hosts = yield* Effect.promise(readGhHosts);
    if (hosts === null) return yield* detectSlow({ cwd });

    // Versions do not change under a running server; memoise the process, not the answer.
    const memoRun = (command: string) => {
      let held = versionMemo.get(command);
      if (held === undefined) {
        held = Effect.runPromise(tryRun(command, ["--version"], cwd)).catch(() => null);
        versionMemo.set(command, held);
      }
      return Effect.promise(() => held!);
    };
    const [gitVersion, ghVersion] = yield* Effect.all([memoRun("git"), memoRun("gh")], {
      concurrency: 2,
    });

    if (Date.now() - slowDetailsAt > SLOW_DETAILS_TTL_MS && slowRefresh === null) {
      slowRefresh = Effect.runPromise(detectSlow({ cwd }))
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          slowRefresh = null;
        });
    }

    const accounts = hosts.map((account) => {
      const details = slowDetails.get(`${account.host}:${account.login}`);
      return {
        host: account.host,
        // The profile login is only resolved for the active account, as in the slow read.
        login: account.active && details ? details.login : account.login,
        authLogin: account.login,
        active: account.active,
        scopes: details?.scopes ?? [],
        ...(avatars.has(`${account.host}:${account.login}`)
          ? { avatarUrl: avatars.get(`${account.host}:${account.login}`)! }
          : {}),
      };
    });
    const activeAccount = accounts.find((account) => account.active) ?? accounts[0] ?? null;
    const result: GitEnvironmentResult = {
      git: {
        installed: gitVersion !== null && gitVersion.code === 0,
        version: gitVersion ? firstLine(gitVersion.stdout) : null,
      },
      gitHub: {
        cliInstalled: ghVersion !== null && ghVersion.code === 0,
        version: ghVersion ? firstLine(ghVersion.stdout) : null,
        authenticated: accounts.length > 0,
        accounts,
        activeLogin: activeAccount ? activeAccount.login : null,
      },
    };
    return result;
  });

const makeGitEnvironment = Effect.sync(() => {
  // Warm the slow account details (token scopes, profile login) now, so the first Accounts panel
  // after startup already has them rather than waiting on the first environment read.
  if (slowRefresh === null && slowDetailsAt === 0) {
    slowRefresh = Effect.runPromise(detectSlow({ cwd: process.cwd() }))
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        slowRefresh = null;
      });
  }

  const service: GitEnvironmentShape = {
    detect,
    switchAccount: ({ host, login }) =>
      Effect.gen(function* () {
        // `gh` takes its credentials from these variables ahead of anything it has stored, so a
        // switch would "succeed" while every later read kept using the variable's account.
        const overriding = (
          host === "github.com"
            ? ["GH_TOKEN", "GITHUB_TOKEN"]
            : ["GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]
        ).find((name) => (process.env[name] ?? "").length > 0);
        if (overriding !== undefined) {
          return yield* new GitHubCliError({
            operation: "execute",
            detail: `The ${overriding} environment variable is set, so GitHub CLI ignores the account you pick. Unset it and restart Tabs to switch accounts.`,
          });
        }
        const result = yield* tryRun(
          "gh",
          ["auth", "switch", "--hostname", host, "--user", login],
          process.cwd(),
        );
        if (result === null) {
          return yield* new GitHubCliError({
            operation: "execute",
            detail: "GitHub CLI (`gh`) is required but not available on PATH.",
          });
        }
        if (result.code !== 0) {
          return yield* new GitHubCliError({
            operation: "execute",
            detail:
              result.stderr.trim().length > 0
                ? result.stderr.trim()
                : `Could not switch to ${login}.`,
          });
        }
        // Trust but verify: `hosts.yml` is where the CLI records the active account.
        const hosts = yield* Effect.promise(readGhHosts);
        const active = hosts?.find((account) => account.host === host && account.active);
        if (active !== undefined && active.login !== login) {
          return yield* new GitHubCliError({
            operation: "execute",
            detail: `GitHub CLI reported success but ${active.login} is still the active account.`,
          });
        }
        clearPushAccessCache();
        clearGitHubReadMemo();
        return yield* detect({ cwd: process.cwd() });
      }),
    logout: ({ host, login }) =>
      tryRun("gh", ["auth", "logout", "--hostname", host, "--user", login], process.cwd()).pipe(
        Effect.flatMap((result) =>
          result === null
            ? Effect.fail(
                new GitHubCliError({
                  operation: "execute",
                  detail: "GitHub CLI (`gh`) is required but not available on PATH.",
                }),
              )
            : Effect.sync(() => {
                clearPushAccessCache();
                clearGitHubReadMemo();
              }).pipe(
                Effect.flatMap(() => detect({ cwd: process.cwd() })),
              ),
        ),
      ),
    publishRelease: (input) =>
      tryRun(
        "gh",
        [
          "release",
          "create",
          input.tag,
          "--title",
          input.title,
          "--notes",
          input.notes,
          ...(input.prerelease ? ["--prerelease"] : []),
        ],
        input.cwd,
      ).pipe(
        Effect.flatMap((result) =>
          result === null
            ? Effect.fail(
                new GitHubCliError({
                  operation: "execute",
                  detail: "GitHub CLI (`gh`) is required but not available on PATH.",
                }),
              )
            : result.code === 0
              ? Effect.void
              : Effect.fail(
                  new GitHubCliError({
                    operation: "execute",
                    detail: result.stderr.trim() || "GitHub release creation failed.",
                  }),
                ),
        ),
      ),
    triggerReleaseWorkflow: (input) =>
      tryRun(
        "gh",
        [
          "workflow",
          "run",
          "release.yml",
          "--ref",
          input.ref,
          "--field",
          `version=${input.version}`,
        ],
        input.cwd,
      ).pipe(
        Effect.flatMap((result) =>
          result === null
            ? Effect.fail(
                new GitHubCliError({
                  operation: "execute",
                  detail: "GitHub CLI (`gh`) is required but not available on PATH.",
                }),
              )
            : result.code === 0
              ? Effect.void
              : Effect.fail(
                  new GitHubCliError({
                    operation: "execute",
                    detail: result.stderr.trim() || "GitHub release workflow dispatch failed.",
                  }),
                ),
        ),
      ),
  };

  return service;
});

export const GitEnvironmentLive = Layer.effect(GitEnvironment, makeGitEnvironment);
