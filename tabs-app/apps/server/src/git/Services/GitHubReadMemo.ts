import * as Effect from "effect/Effect";

import { clearGitHubDirectCaches } from "./GitHubDirect.ts";

/**
 * A short-lived memo for the legacy Git tool's GitHub reads. Each of these reads is a `gh`
 * subprocess plus a network round trip, and the Git tool asks for the same answer on every tab
 * switch, focus and refetch. Only successes are held, so a failure is always retried.
 *
 * Everything is dropped by `clearGitHubReadMemo`, which the account switch, sign-out and every
 * pull request mutation call: an answer read as one account must never be served as another's.
 */
const entries = new Map<string, { readonly at: number; readonly value: unknown }>();
const MAX_ENTRIES = 128;

export function clearGitHubReadMemo(): void {
  entries.clear();
  clearGitHubDirectCaches();
}

export function memoizeGitHubRead<A, E, R>(
  key: string,
  ttlMs: number,
  read: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    const held = entries.get(key);
    if (held !== undefined && Date.now() - held.at < ttlMs) {
      return Effect.succeed(held.value as A);
    }
    return read.pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          if (entries.size >= MAX_ENTRIES) {
            const oldest = entries.keys().next().value;
            if (oldest !== undefined) entries.delete(oldest);
          }
          entries.set(key, { at: Date.now(), value });
        }),
      ),
    );
  });
}
