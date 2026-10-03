import { runProcess } from "../../processRunner";

export type GitPushAccess = "write" | "read_only" | "unknown";

interface CacheEntry {
  access: GitPushAccess;
  cachedAt: number;
}

const pushAccessCache = new Map<string, CacheEntry>();
const PUSH_ACCESS_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function getCachedPushAccess(cwd: string): GitPushAccess | null {
  const entry = pushAccessCache.get(cwd);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > PUSH_ACCESS_TTL_MS) {
    pushAccessCache.delete(cwd);
    return null;
  }
  return entry.access;
}

export function setCachedPushAccess(cwd: string, access: GitPushAccess): void {
  pushAccessCache.set(cwd, { access, cachedAt: Date.now() });
}

export function clearPushAccessCache(): void {
  pushAccessCache.clear();
}

/**
 * Resolves push access for a repository by querying `gh repo view`.
 *
 * Fast-fails with "unknown" when:
 *  - The remote is not a GitHub URL
 *  - `gh` is not installed (ENOENT spawn error)
 *  - `gh` returns an auth/login error (not authenticated)
 *  - The call times out (3 second hard cap to avoid blocking the loading gate)
 */
export async function resolvePushAccess(
  cwd: string,
  remoteUrl: string | null,
): Promise<GitPushAccess> {
  const cached = getCachedPushAccess(cwd);
  if (cached) return cached;

  if (!remoteUrl || !remoteUrl.includes("github.com")) {
    setCachedPushAccess(cwd, "unknown");
    return "unknown";
  }

  try {
    const result = await runProcess("gh", ["repo", "view", "--json", "viewerPermission"], {
      cwd,
      timeoutMs: 3000, // 3s hard cap — must not block the loading gate
      allowNonZeroExit: true,
    });

    // gh timed out — don't block, just report unknown
    if (result.timedOut) {
      setCachedPushAccess(cwd, "unknown");
      return "unknown";
    }

    if (result.code !== 0) {
      const stderr = result.stderr.trim();

      // Not logged in / no token — fail fast as "unknown" (not "read_only",
      // that's only for confirmed 404/access-denied responses)
      const isAuthError =
        /not logged into/i.test(stderr) ||
        /authentication required/i.test(stderr) ||
        /Please log in/i.test(stderr) ||
        /401/i.test(stderr);

      if (isAuthError) {
        setCachedPushAccess(cwd, "unknown");
        return "unknown";
      }

      const isAccessDeniedOrNotFound =
        /Could not resolve to a Repository/i.test(stderr) ||
        /HTTP 404/i.test(stderr) ||
        /Not Found/i.test(stderr);

      const access: GitPushAccess = isAccessDeniedOrNotFound ? "read_only" : "unknown";
      setCachedPushAccess(cwd, access);
      return access;
    }

    const parsed = JSON.parse(result.stdout.trim());
    let access: GitPushAccess = "unknown";

    if (parsed?.viewerPermission) {
      const perm = String(parsed.viewerPermission).toUpperCase();
      access = perm === "ADMIN" || perm === "MAINTAIN" || perm === "WRITE" ? "write" : "read_only";
    }

    setCachedPushAccess(cwd, access);
    return access;
  } catch (err) {
    // gh not installed (ENOENT) or other hard failure — fail fast
    const isNotFound =
      err instanceof Error &&
      (err.message.includes("Command not found") || err.message.includes("ENOENT"));
    if (isNotFound) {
      // Don't cache "unknown" from a missing binary — gh may be installed later
      return "unknown";
    }
    setCachedPushAccess(cwd, "unknown");
    return "unknown";
  }
}
