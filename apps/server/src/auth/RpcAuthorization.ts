import {
  AuthAccessReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthReviewWriteScope,
  AuthTerminalOperateScope,
  ORCHESTRATION_WS_METHODS,
  type AuthEnvironmentScope,
  WS_METHODS,
} from "@tabs/contracts";

const allRpcMethods = [
  ...Object.values(ORCHESTRATION_WS_METHODS),
  ...Object.values(WS_METHODS),
] as ReadonlyArray<string>;

function scopeForKnownMethod(method: string): AuthEnvironmentScope {
  if (method === WS_METHODS.subscribeAuthAccess) return AuthAccessReadScope;
  if (method.startsWith("terminal.") || method.startsWith("subscribeTerminal")) {
    return AuthTerminalOperateScope;
  }
  if (method.startsWith("review.")) return AuthReviewWriteScope;
  if (method === WS_METHODS.cloudGetRelayClientStatus) return AuthRelayReadScope;
  if (method === WS_METHODS.cloudInstallRelayClient) return AuthRelayWriteScope;
  if (method === WS_METHODS.serverCreateSupportBundle) return AuthOrchestrationReadScope;

  const readOperation =
    method.startsWith("subscribe") ||
    method.includes(".get") ||
    method.includes(".list") ||
    method.includes(".read") ||
    method.includes(".search") ||
    method.includes(".browse") ||
    method.includes(".resolve") ||
    method.includes(".discover") ||
    method.includes(".status") ||
    method.includes(".preview") ||
    method.endsWith("Snapshot");

  return readOperation ? AuthOrchestrationReadScope : AuthOrchestrationOperateScope;
}

export const RPC_REQUIRED_SCOPES: Readonly<Record<string, AuthEnvironmentScope>> =
  Object.fromEntries(allRpcMethods.map((method) => [method, scopeForKnownMethod(method)]));

export function requiredScopeForRpcMethod(method: string): AuthEnvironmentScope {
  const requiredScope = RPC_REQUIRED_SCOPES[method];
  if (requiredScope === undefined) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  return requiredScope;
}
