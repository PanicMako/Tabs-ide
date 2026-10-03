import { useAuth } from "@clerk/react";
import { ManagedRelay, setManagedRelaySession } from "@tabs/client-runtime/relay";
import * as Effect from "effect/Effect";
import { useEffect, useRef, type ReactNode } from "react";

import { removeRelayConnections } from "~/connection/manualConnections";
import { appAtomRegistry } from "~/state/atomRegistry";
import { managedRelayRuntime } from "./runtime";
import { resolveRelayClerkTokenOptions } from "./publicConfig";

let relayTokenProvider: (() => Promise<string | null>) | null = null;

export function readManagedRelayClerkToken(): Promise<string | null> {
  return relayTokenProvider?.() ?? Promise.resolve(null);
}

export function deactivateManagedRelayAuthentication(): void {
  relayTokenProvider = null;
  setManagedRelaySession(appAtomRegistry, null);
}

export function ManagedRelayAuthProvider({ children }: { readonly children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const previousAccount = useRef<string | null | undefined>(undefined);
  const transition = useRef(Promise.resolve());

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    const next = isSignedIn && userId ? userId : null;
    const changed = previousAccount.current !== undefined && previousAccount.current !== next;
    previousAccount.current = next;

    if (!next) deactivateManagedRelayAuthentication();
    if (changed) {
      transition.current = transition.current
        .then(async () => {
          deactivateManagedRelayAuthentication();
          await Promise.all([
            removeRelayConnections(),
            managedRelayRuntime.runPromise(
              ManagedRelay.ManagedRelayClient.pipe(
                Effect.flatMap((client) => client.resetTokenCache),
              ),
            ),
          ]);
        })
        .catch((error) => console.error("[tabs-connect] Account cleanup failed", error));
    }
    if (next) {
      const accountId = next;
      void transition.current.then(() => {
        if (cancelled) return;
        const readClerkToken = () => getToken(resolveRelayClerkTokenOptions());
        relayTokenProvider = readClerkToken;
        setManagedRelaySession(appAtomRegistry, { accountId, readClerkToken });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, userId]);

  useEffect(() => () => deactivateManagedRelayAuthentication(), []);
  return children;
}
