import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "@tabs/client-runtime/state";
import { createElement, type PropsWithChildren, type ReactElement } from "react";

/**
 * The renderer has one registry for its lifetime so socket callbacks and React
 * components always observe the same atom graph.
 */
export let appAtomRegistry = AtomRegistry.make();

export function AppAtomRegistryProvider({ children }: PropsWithChildren): ReactElement {
  return createElement(RegistryContext.Provider, { value: appAtomRegistry }, children);
}

export function resetAppAtomRegistryForTests() {
  appAtomRegistry.dispose();
  appAtomRegistry = AtomRegistry.make();
}
