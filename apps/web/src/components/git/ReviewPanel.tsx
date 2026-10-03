import React from "react";
import { useGitApi, useGitScopeKey } from "./gitApiContext";
import { AuditPanel } from "../audit/AuditPanel";

export function ReviewPanel({ cwd }: { cwd: string; activePanel?: string }) {
  const api = useGitApi();
  const stateKey = useGitScopeKey();
  return <AuditPanel cwd={cwd} stateKey={stateKey} api={api} />;
}
