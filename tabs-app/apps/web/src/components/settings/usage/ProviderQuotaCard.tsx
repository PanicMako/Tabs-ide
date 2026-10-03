import { useMemo } from "react";
import type { ServerProviderUsageSnapshot } from "@tabs/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@tabs/contracts";
import {
  deriveDisplayLimits,
  PROVIDER_USAGE_TONE_CLASS_NAME,
  PROVIDER_USAGE_TONE_TEXT_CLASS_NAME,
} from "../../../lib/providerUsageDisplay";
import {
  AntigravityIcon,
  ClaudeAI,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  GoogleGemini,
  GrokIcon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
  type Icon,
} from "../../Icons";
import { formatCount, formatTokens } from "@tabs/shared/usageFormat";
import { cn } from "../../../lib/utils";
import { AlertCircleIcon, CheckCircle2Icon, ClockIcon, UserIcon } from "lucide-react";

const PROVIDER_ICONS: Record<string, Icon> = {
  codex: OpenAI,
  claude: ClaudeAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
  gemini: GoogleGemini,
  googleGemini: GoogleGemini,
  droid: DroidIcon,
  antigravity: AntigravityIcon,
  openrouter: OpenRouterIcon,
};

function normalizeProviderInfo(provider: string) {
  const normKey =
    provider === "claude" ? "claudeAgent" : provider === "gemini" ? "googleGemini" : provider;

  const displayName =
    (PROVIDER_DISPLAY_NAMES as Record<string, string>)[normKey] ??
    (PROVIDER_DISPLAY_NAMES as Record<string, string>)[provider] ??
    (provider === "claude" || provider === "claudeAgent"
      ? "Claude"
      : provider === "codex"
        ? "Codex"
        : provider === "cursor"
          ? "Cursor"
          : provider === "copilot"
            ? "GitHub Copilot"
            : provider === "grok"
              ? "Grok"
              : provider === "gemini" || provider === "googleGemini"
                ? "Google Gemini"
                : provider === "opencode"
                  ? "OpenCode"
                  : provider === "droid"
                    ? "Factory Droid"
                    : provider === "kilo"
                      ? "Kilo"
                      : provider === "antigravity"
                        ? "Antigravity"
                        : provider === "openrouter"
                          ? "OpenRouter"
                          : provider.charAt(0).toUpperCase() + provider.slice(1));

  const IconComp =
    PROVIDER_ICONS[normKey] ??
    PROVIDER_ICONS[provider] ??
    (provider.toLowerCase().includes("claude") ? ClaudeAI : BotIcon);

  return { displayName, IconComp };
}

export interface ProviderQuotaCardProps {
  readonly snapshot: ServerProviderUsageSnapshot;
  readonly isEnabled?: boolean;
}

export function ProviderQuotaCard({ snapshot, isEnabled = true }: ProviderQuotaCardProps) {
  const provider = snapshot.provider;
  const { displayName, IconComp } = normalizeProviderInfo(provider);

  const limits = useMemo(() => deriveDisplayLimits(snapshot), [snapshot]);
  const status = snapshot.status ?? "ok";
  const hasLimits = limits.length > 0;

  const windowStats = snapshot.windows;
  const stat24h = windowStats?.find((w) => w.label === "24h");
  const stat7d = windowStats?.find((w) => w.label === "7d");
  const stat30d = windowStats?.find((w) => w.label === "30d");

  const hasActivity =
    (stat24h && stat24h.tokens > 0) ||
    (stat7d && stat7d.tokens > 0) ||
    (stat30d && stat30d.tokens > 0);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm shadow-xs transition-all hover:border-border">
      {/* Header: Icon + Name + Plan Badge + Account Info */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/60 shadow-xs">
            <IconComp className="size-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground text-sm">{displayName}</span>
              {snapshot.planName ? (
                <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
                  {snapshot.planName}
                </span>
              ) : null}
            </div>
            {snapshot.email ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserIcon className="size-3" />
                <span className="truncate">{snapshot.email}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Status Pill */}
        <div>
          {status === "needs-auth" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertCircleIcon className="size-3" />
              Not signed in
            </span>
          ) : status === "quota-unavailable" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertCircleIcon className="size-3" />
              Signed in · quota unavailable
            </span>
          ) : status === "error" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              <AlertCircleIcon className="size-3" />
              Unavailable
            </span>
          ) : status === "unsupported" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <AlertCircleIcon className="size-3" />
              Provider-managed
            </span>
          ) : isEnabled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2Icon className="size-3" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              Disabled
            </span>
          )}
        </div>
      </div>

      {/* Quota Limits / Progress Bars */}
      {status === "ok" && hasLimits ? (
        <div className="space-y-4 border-t border-border/50 pt-3">
          {limits.map((limit, idx) => {
            const trackColor = PROVIDER_USAGE_TONE_CLASS_NAME[limit.remainingTone];
            const paceTextColor = limit.pace
              ? PROVIDER_USAGE_TONE_TEXT_CLASS_NAME[limit.paceTone]
              : "text-muted-foreground";

            return (
              <div key={idx} className="space-y-2">
                {/* Limit Label + Left Text + Reset info */}
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-foreground">{limit.label}</span>
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className="font-medium text-foreground">{limit.leftText}</span>
                    {limit.resetText ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ClockIcon className="size-3" />
                        {limit.resetText}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Progress Track */}
                <div
                  className="relative h-2 w-full overflow-hidden rounded-full bg-muted/60"
                  role="progressbar"
                  aria-label={`${displayName} ${limit.label} quota remaining`}
                  aria-valuenow={Math.round(limit.remainingPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", trackColor)}
                    style={{ width: `${limit.remainingPercent}%` }}
                  />
                  {limit.pace && limit.pace.expectedRemainingPercent !== undefined ? (
                    <div
                      className="absolute inset-y-0 z-10 flex w-1.5 -translate-x-1/2 items-center justify-center"
                      style={{ left: `${limit.pace.expectedRemainingPercent}%` }}
                      title={`Target pace: ${Math.round(limit.pace.expectedRemainingPercent)}%`}
                    >
                      <span className="h-full w-0.5 rounded-full bg-foreground/60 shadow-xs" />
                    </div>
                  ) : null}
                </div>

                {/* Burn-rate Pace Warning / ETA */}
                {limit.pace ? (
                  <div className="flex items-center justify-between text-[11px] tabular-nums">
                    {limit.pace.amountText ? (
                      <span className={cn("font-medium", paceTextColor)}>
                        {limit.pace.amountText}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">On track with billing period</span>
                    )}
                    {limit.pace.etaText ? (
                      <span className="text-muted-foreground/90">{limit.pace.etaText}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border-t border-border/50 pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {status === "ok"
              ? "No live quota data reported for this provider."
              : (snapshot.detail ?? "Sign in with the provider CLI to see live usage and quota.")}
          </p>
        </div>
      )}

      {/* Additional Usage Lines */}
      {status === "ok" && snapshot.usageLines && snapshot.usageLines.length > 0 ? (
        <div className="space-y-1.5 border-t border-border/50 pt-3 text-xs">
          {snapshot.usageLines.map((line, lIdx) => (
            <div key={lIdx} className="flex items-center justify-between">
              <span className="font-medium text-foreground">{line.label}</span>
              <div className="text-right">
                <span className="font-semibold text-foreground tabular-nums">{line.value}</span>
                {line.subtitle ? (
                  <span className="block text-[10px] text-muted-foreground">{line.subtitle}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Activity Stats (24h / 7d / 30d) */}
      {hasActivity && windowStats ? (
        <div className="border-t border-border/50 pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Activity
          </span>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5 text-center text-xs">
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Past 24h</span>
              <div className="font-semibold text-foreground tabular-nums">
                {formatTokens(stat24h?.tokens ?? 0)}
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {formatCount(stat24h?.sessions ?? 0)} sessions
              </div>
            </div>
            <div className="space-y-0.5 border-x border-border/40">
              <span className="text-[10px] text-muted-foreground">Past 7d</span>
              <div className="font-semibold text-foreground tabular-nums">
                {formatTokens(stat7d?.tokens ?? 0)}
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {formatCount(stat7d?.sessions ?? 0)} sessions
              </div>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Past 30d</span>
              <div className="font-semibold text-foreground tabular-nums">
                {formatTokens(stat30d?.tokens ?? 0)}
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {formatCount(stat30d?.sessions ?? 0)} sessions
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BotIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="18" height="10" x="3" y="11" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" x2="8" y1="16" y2="16" />
      <line x1="16" x2="16" y1="16" y2="16" />
    </svg>
  );
}
