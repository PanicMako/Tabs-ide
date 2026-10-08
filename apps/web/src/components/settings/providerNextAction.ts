export interface ProviderNextActionInput {
  enabled: boolean;
  needsInstall: boolean;
  needsAuth: boolean;
  installCommand?: string | null | undefined;
  loginCommand?: string | null | undefined;
  updateCommand?: string | null | undefined;
  needsAttention: boolean;
}

export function providerNextAction(input: ProviderNextActionInput) {
  if (!input.enabled) return null;
  if (input.needsInstall) {
    return {
      label: input.installCommand ? "Install" : "Set up",
      kind: "install" as const,
      command: input.installCommand,
    };
  }
  if (input.needsAuth) {
    return {
      label: input.loginCommand ? "Sign in" : "Connect",
      kind: "login" as const,
      command: input.loginCommand,
    };
  }
  if (input.updateCommand) {
    return { label: "Update", kind: "update" as const, command: input.updateCommand };
  }
  if (input.needsAttention) return { label: "Check", kind: "check" as const, command: null };
  return null;
}
