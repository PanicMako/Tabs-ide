import * as Context from "effect/Context";
/**
 * GitEnvironment - Effect service contract for detecting the local Git / GitHub
 * CLI environment and managing GitHub CLI accounts.
 *
 * Powers the friendly setup states in the Git workspace (git not installed, not
 * authenticated) and the top-of-tab GitHub account switcher.
 *
 * @module GitEnvironment
 */
import type { Effect } from "effect";
import type {
  GitEnvironmentInput,
  GitEnvironmentResult,
  GitHubLogoutInput,
  GitHubSwitchAccountInput,
  GitPublishReleaseInput,
  GitTriggerReleaseWorkflowInput,
} from "@tabs/contracts";

import type { GitHubCliError } from "../Errors.ts";

/**
 * GitEnvironmentShape - Service API for environment detection + account ops.
 */
export interface GitEnvironmentShape {
  /**
   * Detect whether git/gh are installed and which GitHub accounts are signed
   * in. Never fails on missing/unauthenticated tooling — those are reported as
   * data so the UI can render guided setup states.
   */
  readonly detect: (
    input: GitEnvironmentInput,
  ) => Effect.Effect<GitEnvironmentResult, GitHubCliError>;

  /**
   * Switch the active GitHub CLI account (non-interactive). Returns the fresh
   * environment snapshot.
   */
  readonly switchAccount: (
    input: GitHubSwitchAccountInput,
  ) => Effect.Effect<GitEnvironmentResult, GitHubCliError>;

  /**
   * Sign a GitHub CLI account out. Returns the fresh environment snapshot.
   */
  readonly logout: (
    input: GitHubLogoutInput,
  ) => Effect.Effect<GitEnvironmentResult, GitHubCliError>;

  /** Publish a GitHub release without passing user text through a shell. */
  readonly publishRelease: (input: GitPublishReleaseInput) => Effect.Effect<void, GitHubCliError>;

  /** Trigger the repository release workflow without shell interpolation. */
  readonly triggerReleaseWorkflow: (
    input: GitTriggerReleaseWorkflowInput,
  ) => Effect.Effect<void, GitHubCliError>;
}

/**
 * GitEnvironment - Service tag for Git/GitHub environment detection.
 */
export class GitEnvironment extends Context.Service<GitEnvironment, GitEnvironmentShape>()(
  "tabs/git/Services/GitEnvironment",
) {}

export interface ParsedGitHubAccount {
  readonly host: string;
  readonly login: string;
  readonly active: boolean;
  readonly scopes: ReadonlyArray<string>;
}

/**
 * Parse the human-readable output of `gh auth status`. The format is grouped by
 * host, e.g.:
 *
 *   github.com
 *     ✓ Logged in to github.com account octocat (keyring)
 *     - Active account: true
 *     - Git operations protocol: https
 *     - Token scopes: 'gist', 'read:org', 'repo'
 *
 * Older gh versions print "Logged in to github.com as octocat". Both shapes are
 * handled. Returns one entry per signed-in account across all hosts.
 */
export function parseGitHubAuthStatus(output: string): ReadonlyArray<ParsedGitHubAccount> {
  const accounts: ParsedGitHubAccount[] = [];
  const lines = output.split(/\r?\n/);

  let current: { host: string; login: string; active: boolean; scopes: string[] } | null = null;

  const flush = () => {
    if (current) {
      accounts.push({
        host: current.host,
        login: current.login,
        active: current.active,
        scopes: current.scopes,
      });
      current = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    // "Logged in to <host> account <login> (...)" or "... as <login>"
    const loginMatch = line.match(/Logged in to\s+(\S+)\s+(?:account\s+)?(?:as\s+)?([^\s(]+)/i);
    if (loginMatch) {
      flush();
      const host = loginMatch[1] ?? "github.com";
      const login = loginMatch[2] ?? "";
      if (login.length > 0) {
        current = { host, login, active: false, scopes: [] };
      }
      continue;
    }

    if (!current) continue;

    const activeMatch = line.match(/Active account:\s*(true|false)/i);
    if (activeMatch) {
      current.active = activeMatch[1]?.toLowerCase() === "true";
      continue;
    }

    const scopesMatch = line.match(/Token scopes:\s*(.+)/i);
    if (scopesMatch) {
      current.scopes = (scopesMatch[1] ?? "")
        .split(",")
        .map((scope) => scope.trim().replace(/^['"]|['"]$/g, ""))
        .filter((scope) => scope.length > 0);
      continue;
    }
  }
  flush();

  return accounts;
}
