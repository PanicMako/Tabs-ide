import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider } from "@clerk/electron/react";
import type { ReactNode } from "react";

import { ManagedRelayAuthProvider } from "../../cloud/managedAuth";

export default function ElectronManagedAuthShell(props: {
  readonly publishableKey: string;
  readonly children: ReactNode;
}) {
  return (
    <ClerkProvider publishableKey={props.publishableKey} passkeys={passkeys}>
      <ManagedRelayAuthProvider>{props.children}</ManagedRelayAuthProvider>
    </ClerkProvider>
  );
}
