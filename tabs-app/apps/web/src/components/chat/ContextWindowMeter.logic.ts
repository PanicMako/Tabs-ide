import type { ServerProvider } from "@tabs/contracts";

export function isCompactCommandMessage(message: {
  readonly role?: string | undefined;
  readonly text?: string | undefined;
  readonly attachments?: readonly unknown[] | undefined;
}): boolean {
  const text = (message.text ?? "").trim().toLowerCase();
  return (
    message.role === "user" &&
    text === "/compact" &&
    !(message.attachments && message.attachments.length > 0)
  );
}

export function providerSupportsManualCompaction(
  provider: ServerProvider | null | undefined,
): boolean {
  if (!provider) return false;
  return (
    (provider.slashCommands?.some((command) => command.name === "compact") ?? false) ||
    provider.driver === "codex" ||
    provider.driver === "claudeAgent" ||
    provider.driver === "opencode" ||
    provider.instanceId === "codex" ||
    provider.instanceId === "claudeAgent" ||
    provider.instanceId === "opencode"
  );
}

export function formatContextWindowCompactionMessage(
  modelDisplayName?: string | null | undefined,
  autoCompactThreshold?: number | null | undefined,
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return `Compacts automatically at ${autoCompactThreshold.toLocaleString("en-US")} tokens.`;
  }
  return modelDisplayName
    ? `Context for ${modelDisplayName} compacts automatically when needed.`
    : "Context compacts automatically when needed.";
}

export type ContextRoom = "roomy" | "filling" | "nearlyFull";

/** How much room is left, in words anyone can read at a glance. */
export function describeContextRoom(usedPercentage: number | null): {
  readonly level: ContextRoom;
  readonly label: string;
} {
  const used = usedPercentage ?? 0;
  if (used >= 85) return { level: "nearlyFull", label: "Almost full" };
  if (used >= 55) return { level: "filling", label: "Filling up" };
  return { level: "roomy", label: "Plenty of room" };
}

/** One short line on what happens when the window fills. */
export function formatAutoCompactHint(
  autoCompactThreshold: number | null | undefined,
  formatTokens: (value: number) => string,
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return `Auto-compacts at ${formatTokens(autoCompactThreshold)}`;
  }
  return "Auto-compacts when full";
}
