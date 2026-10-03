import { ClerkProvider } from "@clerk/react";
import type { ReactNode } from "react";

import { ManagedRelayAuthProvider } from "../../cloud/managedAuth";

export default function BrowserManagedAuthShell(props: {
  readonly publishableKey: string;
  readonly children: ReactNode;
}) {
  return (
    <ClerkProvider publishableKey={props.publishableKey}>
      <ManagedRelayAuthProvider>{props.children}</ManagedRelayAuthProvider>
    </ClerkProvider>
  );
}
