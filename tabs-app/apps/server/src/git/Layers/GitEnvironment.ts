import { Effect, Layer } from "effect";
import type { GitEnvironmentResult } from "@tabs/contracts";

import { runProcess } from "../../processRunner.ts";
import { GitHubCliError } from "../Errors.ts";
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

function firstLine(value: string): string | null {
  const line = value.split(/\r?\n/)[0]?.trim();
  return line && line.length > 0 ? line : null;
}

const detect: GitEnvironmentShape["detect"] = ({ cwd }) =>
  Effect.gen(function* () {
    const gitVersion = yield* tryRun("git", ["--version"], cwd);
    const ghVersion = yield* tryRun("gh", ["--version"], cwd);
    // `gh auth status` exits non-zero when unauthenticated; we read its text
    // regardless and parse whatever accounts it reports. Older gh prints to
    // stderr, newer to stdout — combine both.
    const ghStatus = ghVersion ? yield* tryRun("gh", ["auth", "status"], cwd) : null;

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

    const result: GitEnvironmentResult = {
      git: {
        installed: gitVersion !== null && gitVersion.code === 0,
        version: gitVersion ? firstLine(gitVersion.stdout) : null,
      },
      gitHub: {
        cliInstalled: ghVersion !== null && ghVersion.code === 0,
        version: ghVersion ? firstLine(ghVersion.stdout) : null,
        authenticated: accounts.length > 0,
        accounts: accounts.map((account) => ({
          host: account.host,
          login: currentLogin(account),
          authLogin: account.login,
          active: account.active,
          scopes: account.scopes,
        })),
        activeLogin: activeAccount ? currentLogin(activeAccount) : null,
      },
    };
    return result;
  });

const makeGitEnvironment = Effect.sync(() => {
  const service: GitEnvironmentShape = {
    detect,
    switchAccount: ({ host, login }) =>
      tryRun("gh", ["auth", "switch", "--hostname", host, "--user", login], process.cwd()).pipe(
        Effect.flatMap((result) =>
          result === null
            ? Effect.fail(
                new GitHubCliError({
                  operation: "execute",
                  detail: "GitHub CLI (`gh`) is required but not available on PATH.",
                }),
              )
            : result.code === 0
              ? Effect.sync(() => clearPushAccessCache()).pipe(
                  Effect.flatMap(() => detect({ cwd: process.cwd() })),
                )
              : Effect.fail(
                  new GitHubCliError({
                    operation: "execute",
                    detail:
                      result.stderr.trim().length > 0
                        ? result.stderr.trim()
                        : `Could not switch to ${login}.`,
                  }),
                ),
        ),
      ),
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
            : Effect.sync(() => clearPushAccessCache()).pipe(
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
