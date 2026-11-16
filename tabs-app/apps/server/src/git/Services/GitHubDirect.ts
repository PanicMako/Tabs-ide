import { runProcess } from "../../processRunner";

/**
 * An in-process GitHub GraphQL client for the Git tool's hot reads.
 *
 * Starting `gh` costs about 0.35s per call before the request even leaves (measured: 0.6s for
 * `gh api graphql` against 0.22s for the same request over a warm connection), and the Git tool
 * makes several reads per page. Node's `fetch` keeps connections alive, so after the first read
 * each one pays only the network. The token still comes from `gh auth token`, so the account the
 * user switched to is the account read as, and it is held briefly rather than re-asked per read.
 *
 * Every caller keeps its `gh` path as the fallback: this never throws something a caller
 * cannot recover from by running the CLI instead.
 */
const TOKEN_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

const tokens = new Map<string, { readonly at: number; readonly token: string }>();

export function clearGitHubDirectCaches(): void {
  tokens.clear();
}

export interface GitHubRemote {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
}

/** `https://host/owner/name(.git)`, `git@host:owner/name(.git)` and `ssh://git@host/owner/name`. */
export function parseGitHubRemote(url: string): GitHubRemote | null {
  const trimmed = url.trim();
  const match =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    ) ?? /^(?:[^@/]+@)?([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
  if (!match) return null;
  const [, host, owner, name] = match;
  if (!host || !owner || !name) return null;
  return { host: host.toLowerCase(), owner, name };
}

function endpointFor(host: string): string {
  return host === "github.com" ? "https://api.github.com/graphql" : `https://${host}/api/graphql`;
}

async function tokenFor(host: string, cwd: string): Promise<string | null> {
  const held = tokens.get(host);
  if (held !== undefined && Date.now() - held.at < TOKEN_TTL_MS) return held.token;
  const result = await runProcess("gh", ["auth", "token", "--hostname", host], {
    cwd,
    timeoutMs: 5_000,
    allowNonZeroExit: true,
  });
  const token = result.code === 0 ? result.stdout.trim() : "";
  if (token.length === 0) return null;
  tokens.set(host, { at: Date.now(), token });
  return token;
}

/** The raw response body of one GraphQL read, or a thrown error for the caller to fall back on. */
export async function githubGraphql(input: {
  readonly cwd: string;
  readonly host: string;
  /** A credential already in hand (pinned to a request); otherwise the active `gh` account's. */
  readonly token?: string;
  readonly query: string;
  readonly variables: Record<string, unknown>;
}): Promise<string> {
  const token = input.token ?? (await tokenFor(input.host, input.cwd));
  if (token === null) throw new Error("No GitHub token is available.");
  const response = await fetch(endpointFor(input.host), {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "tabs-git",
    },
    body: JSON.stringify({ query: input.query, variables: input.variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) tokens.delete(input.host);
  if (!response.ok) throw new Error(`GitHub responded ${response.status}.`);
  const body = await response.text();
  // A partial answer with errors is still a failure here: the CLI path owns reporting them.
  if (/"errors"\s*:/.test(body.slice(0, 200)) && !/"data"\s*:\s*\{\s*"repository"/.test(body)) {
    throw new Error("GitHub returned errors.");
  }
  return body;
}

function restBase(host: string): string {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

/** The parsed JSON of one REST GET, or a thrown error for the caller to fall back on. */
export async function githubRestGet(input: {
  readonly cwd: string;
  readonly host: string;
  /** Path and query, starting with `/`. */
  readonly path: string;
}): Promise<unknown> {
  const token = await tokenFor(input.host, input.cwd);
  if (token === null) throw new Error("No GitHub token is available.");
  const response = await fetch(`${restBase(input.host)}${input.path}`, {
    headers: {
      authorization: `bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "tabs-git",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) tokens.delete(input.host);
  if (!response.ok) throw new Error(`GitHub responded ${response.status}.`);
  return response.json();
}

/**
 * The repository `gh` itself would act on for this checkout. `gh repo set-default` records its
 * choice as `remote.<name>.gh-resolved` in the repository's git config: `base` means that
 * remote's own repository, `owner/name` names another repository on that remote's host. Without
 * one, `gh` falls back to `origin`, as this does. `GH_REPO` wins over both, as it does for `gh`.
 */
export async function resolveGitHubRepository(cwd: string): Promise<GitHubRemote | null> {
  try {
    return await resolveGitHubRepositoryUnchecked(cwd);
  } catch {
    // No remote, no git, not a repository: there is no repository to name.
    return null;
  }
}

async function resolveGitHubRepositoryUnchecked(cwd: string): Promise<GitHubRemote | null> {
  const envRepo = process.env.GH_REPO?.trim();
  if (envRepo) {
    const parts = envRepo.split("/");
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { host: "github.com", owner: parts[0], name: parts[1] };
    }
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      return { host: parts[0].toLowerCase(), owner: parts[1], name: parts[2] };
    }
  }
  const resolved = await runProcess(
    "git",
    ["config", "--local", "--get-regexp", "^remote\\..*\\.gh-resolved$"],
    { cwd, timeoutMs: 5_000, allowNonZeroExit: true },
  );
  let remoteName = "origin";
  let override: string | null = null;
  for (const line of resolved.code === 0 ? resolved.stdout.split("\n") : []) {
    const match = /^remote\.(.+)\.gh-resolved\s+(\S+)$/.exec(line.trim());
    if (match?.[1] && match[2]) {
      remoteName = match[1];
      override = match[2];
      break;
    }
  }
  const remote = await runProcess("git", ["remote", "get-url", remoteName], {
    cwd,
    timeoutMs: 5_000,
  });
  const base = parseGitHubRemote(remote.stdout);
  if (base === null) return null;
  if (override !== null && override !== "base" && override.includes("/")) {
    const [owner, name] = override.split("/");
    if (owner && name) return { host: base.host, owner, name };
  }
  return base;
}

/** What `gh api -F` would send for a value: booleans, null and integers are typed. */
function typedFieldValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

/**
 * Runs a `gh api graphql …` invocation in-process when it is one of the plain shapes this module
 * can reproduce exactly: `--hostname`, `-f`/`-F key=value`, and `--input -` with a JSON document
 * on stdin. Anything else (`--paginate`, `--jq`, `{owner}` placeholders, `@file` values, other
 * flags) answers `null` so the CLI runs it, and so does any GraphQL error, so the CLI keeps
 * owning how failures are reported. A returned string is exactly the body `gh` would have printed.
 */
export async function directGraphqlFromGhArgs(input: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly stdin?: string | undefined;
  readonly token?: string | undefined;
}): Promise<string | null> {
  const { args } = input;
  if (args[0] !== "api" || args[1] !== "graphql") return null;
  // Unit tests double the CLI; they must never reach the network with the developer's token.
  if (process.env.VITEST !== undefined && process.env.TABS_FORCE_DIRECT_GRAPHQL !== "1") {
    return null;
  }
  let host = "github.com";
  let query: string | undefined;
  let variables: Record<string, unknown> = {};
  let usesInput = false;
  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--hostname" && value !== undefined) {
      host = value.toLowerCase();
      index += 1;
    } else if (flag === "--input" && value === "-") {
      usesInput = true;
      index += 1;
    } else if ((flag === "-f" || flag === "-F") && value !== undefined) {
      const equals = value.indexOf("=");
      if (equals <= 0) return null;
      const key = value.slice(0, equals);
      const raw = value.slice(equals + 1);
      if (
        key.endsWith("[]") ||
        (flag === "-F" && (raw.startsWith("@") || /\{(owner|repo|branch)\}/.test(raw)))
      ) {
        return null;
      }
      if (key === "query") query = raw;
      else variables = { ...variables, [key]: flag === "-F" ? typedFieldValue(raw) : raw };
      index += 1;
    } else {
      return null;
    }
  }
  if (usesInput) {
    if (query !== undefined || Object.keys(variables).length > 0 || input.stdin === undefined) {
      return null;
    }
    try {
      const document = JSON.parse(input.stdin) as { query?: unknown; variables?: unknown };
      if (typeof document.query !== "string") return null;
      query = document.query;
      variables = (document.variables ?? {}) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (query === undefined) return null;
  try {
    const body = await githubGraphql({
      cwd: input.cwd,
      host,
      query,
      variables,
      ...(input.token === undefined ? {} : { token: input.token }),
    });
    const parsed = JSON.parse(body) as { errors?: unknown };
    return parsed.errors === undefined ? body : null;
  } catch {
    return null;
  }
}
