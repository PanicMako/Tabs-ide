// FILE: providerUsage/parse.ts
// Purpose: Small, dependency-free parsing/formatting helpers and snapshot builders shared by
// the per-provider usage fetchers.

import type {
  ProviderUsageStatus,
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
  ServerProviderUsageSnapshot,
} from "@tabs/contracts";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function asNonNegativeNumber(value: unknown): number | undefined {
  const parsed = asFiniteNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function clampPercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(100, Math.max(0, value));
}

/** Convert a fraction (0..1) or an already-percent value (0..100) into a clamped 0..100 percent. */
export function toUsedPercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return clampPercent(value <= 1 ? value * 100 : value);
}

export function isoFromUnixSeconds(value: unknown): string | undefined {
  const seconds = asFiniteNumber(value);
  if (seconds === undefined || seconds <= 0) {
    return undefined;
  }
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isoFromUnixMillis(value: unknown): string | undefined {
  const millis = asFiniteNumber(value);
  if (millis === undefined || millis <= 0) {
    return undefined;
  }
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isoFromString(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) {
    return undefined;
  }
  const millis = Date.parse(text);
  return Number.isNaN(millis) ? undefined : new Date(millis).toISOString();
}

export function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export interface SnapshotInput {
  provider: string;
  nowMs: number;
  source: string;
  limits?: ServerProviderUsageLimit[];
  usageLines?: ServerProviderUsageLine[];
  windows?: { label: "24h" | "7d" | "30d"; tokens: number; sessions: number }[];
  planName?: string;
  email?: string;
  detail?: string;
  status?: ProviderUsageStatus;
}

export function buildSnapshot(input: SnapshotInput): ServerProviderUsageSnapshot {
  return {
    provider: input.provider,
    updatedAt: new Date(input.nowMs).toISOString(),
    limits: input.limits ?? [],
    usageLines: input.usageLines ?? [],
    ...(input.windows ? { windows: input.windows } : {}),
    source: input.source,
    status: input.status ?? "ok",
    ...(input.planName ? { planName: input.planName } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

export function needsAuthSnapshot(
  provider: string,
  nowMs: number,
  source: string,
  detail?: string,
): ServerProviderUsageSnapshot {
  return buildSnapshot({
    provider,
    nowMs,
    source,
    status: "needs-auth",
    detail: detail ?? "Sign in with the provider CLI to see usage.",
  });
}

export function unsupportedSnapshot(
  provider: string,
  nowMs: number,
  source: string,
  detail: string,
): ServerProviderUsageSnapshot {
  return buildSnapshot({
    provider,
    nowMs,
    source,
    status: "unsupported",
    detail,
  });
}

export function errorSnapshot(
  provider: string,
  nowMs: number,
  source: string,
  detail: string,
): ServerProviderUsageSnapshot {
  return buildSnapshot({
    provider,
    nowMs,
    source,
    status: "error",
    detail,
  });
}
