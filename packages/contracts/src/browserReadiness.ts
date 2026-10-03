export type BrowserReadinessState =
  | "ready"
  | "reachable"
  | "unhealthy"
  | "probing"
  | "offline"
  | "unknown"
  | "not_local";
export interface BrowserReadinessResult {
  state: BrowserReadinessState;
  latencyMs?: number;
  httpStatus?: number;
  lastProbedAt?: string;
  error?: string;
}
