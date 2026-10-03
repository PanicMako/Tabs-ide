import type { NativeApi } from "@tabs/contracts";
import { createContext, useContext, type ReactNode } from "react";

const GitApiContext = createContext<NativeApi | null>(null);
const GitScopeContext = createContext<string>("");

export function gitWorkspaceScopeKey(environmentId: string | undefined, cwd: string): string {
  return JSON.stringify([environmentId ?? "primary", cwd]);
}

export function GitApiProvider({
  api,
  scopeKey,
  children,
}: {
  api: NativeApi | null;
  scopeKey: string;
  children: ReactNode;
}) {
  return (
    <GitApiContext.Provider value={api}>
      <GitScopeContext.Provider value={scopeKey}>{children}</GitScopeContext.Provider>
    </GitApiContext.Provider>
  );
}

export function useGitApi(): NativeApi | null {
  return useContext(GitApiContext);
}

export function useGitScopeKey(): string {
  return useContext(GitScopeContext);
}
