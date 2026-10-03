import { relayClerkTokenOptions } from "@tabs/shared/relayAuth";
import { normalizeSecureRelayUrl } from "@tabs/shared/relayUrl";

export interface CloudPublicConfig {
  readonly clerkPublishableKey: string | null;
  readonly clerkJwtTemplate: string | null;
  readonly relayUrl: string | null;
}

export function trimNonEmpty(value: string | undefined): string | null {
  return value?.trim() || null;
}

export function resolveCloudPublicConfig(): CloudPublicConfig {
  return {
    clerkPublishableKey: trimNonEmpty(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
    clerkJwtTemplate: trimNonEmpty(import.meta.env.VITE_CLERK_JWT_TEMPLATE),
    relayUrl: normalizeSecureRelayUrl(
      import.meta.env.VITE_TABS_RELAY_URL ?? import.meta.env.VITE_T3CODE_RELAY_URL ?? "",
    ),
  };
}

export function hasCloudPublicConfig(): boolean {
  const config = resolveCloudPublicConfig();
  return Boolean(config.clerkPublishableKey && config.clerkJwtTemplate && config.relayUrl);
}

export function resolveRelayClerkTokenOptions() {
  const template = resolveCloudPublicConfig().clerkJwtTemplate;
  if (!template) throw new Error("VITE_CLERK_JWT_TEMPLATE is not configured.");
  return relayClerkTokenOptions(template);
}
