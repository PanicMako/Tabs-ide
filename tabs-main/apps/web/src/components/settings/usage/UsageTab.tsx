import { useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { formatCount, formatPercent, formatTokens, formatUsd } from "@tabs/shared/usageFormat";
import { mergeUsage } from "@tabs/shared/usageMerge";
import { PROVIDER_DISPLAY_NAMES } from "@tabs/contracts";
import {
  usageTimeWindowAtom,
  usageSummaryStateAtom,
  fetchUsageSummary,
  type UsageWindowPreset,
} from "../../../state/usage";
import { appAtomRegistry } from "../../../state/atomRegistry";
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
import { UsageDailyChart } from "./UsageDailyChart";
import { Button } from "../../ui/button";
import { UsagePriceOverrides } from "../../usage/UsagePriceOverrides";
import { cn } from "../../../lib/utils";
import {
  CpuIcon,
  DatabaseIcon,
  LayersIcon,
  PercentIcon,
  SlidersHorizontalIcon,
  ZapIcon,
} from "lucide-react";
import { PageLoadingState } from "../../PageLoadingState";

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

const PROVIDER_COLORS: Record<string, string> = {
  codex: "#10a37f",
  claude: "#d97706",
  claudeAgent: "#d97706",
  cursor: "#6366f1",
  copilot: "#3b82f6",
  grok: "#8b5cf6",
  gemini: "#0284c7",
  googleGemini: "#0284c7",
  opencode: "#06b6d4",
  droid: "#64748b",
  kilo: "#ec4899",
  antigravity: "#f43f5e",
  openrouter: "#14b8a6",
};

function normalizeProvider(provider: string): {
  key: string;
  name: string;
  icon: Icon;
  color: string;
} {
  const normKey =
    provider === "claude" ? "claudeAgent" : provider === "gemini" ? "googleGemini" : provider;

  const name =
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

  const icon =
    PROVIDER_ICONS[normKey] ??
    PROVIDER_ICONS[provider] ??
    (provider.toLowerCase().includes("claude") ? ClaudeAI : BotIcon);

  const color =
    PROVIDER_COLORS[normKey] ??
    PROVIDER_COLORS[provider] ??
    (provider.toLowerCase().includes("claude") ? "#d97706" : "#888888");

  return { key: normKey, name, icon, color };
}

const WINDOW_PRESETS = [
  { id: "24h" as const, label: "Past 24h" },
  { id: "7d" as const, label: "7 days" },
  { id: "30d" as const, label: "30 days" },
  { id: "90d" as const, label: "90 days" },
  { id: "all" as const, label: "All time" },
];

export function UsageTab() {
  const timeWindow = useAtomValue(usageTimeWindowAtom);
  const summaryState = useAtomValue(usageSummaryStateAtom);
  const [metric, setMetric] = useState<"cost" | "tokens">("cost");
  const [breakdownView, setBreakdownView] = useState<"model" | "provider">("model");
  const [showPriceOverrides, setShowPriceOverrides] = useState(false);

  const summary = summaryState.data;
  const merged = useMemo(() => mergeUsage(summary), [summary]);

  const selectWindow = (win: UsageWindowPreset) => {
    appAtomRegistry.set(usageTimeWindowAtom, win);
    void fetchUsageSummary(win);
  };

  const hasActivity = merged.totalTokens > 0 || merged.costUsd > 0;

  const uncachedEquivalentCost = merged.costUsd + merged.costQuality.cacheSavingsUsd;
  const cacheSavingsShare =
    uncachedEquivalentCost > 0 ? merged.costQuality.cacheSavingsUsd / uncachedEquivalentCost : 0;
  const inputTokens =
    merged.uncachedInputTokens + merged.cachedInputTokens + merged.cacheCreationTokens;

  return (
    <div className="space-y-8">
      {/* Date Range Selector & Metric Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div
          className="tabs-segmented flex items-center"
          role="group"
          aria-label="Usage date range"
        >
          {WINDOW_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => selectWindow(preset.id)}
              aria-pressed={timeWindow === preset.id}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                timeWindow === preset.id
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="tabs-segmented flex items-center" role="group" aria-label="Usage metric">
            <button
              type="button"
              onClick={() => setMetric("cost")}
              aria-pressed={metric === "cost"}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                metric === "cost"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Cost (USD)
            </button>
            <button
              type="button"
              onClick={() => setMetric("tokens")}
              aria-pressed={metric === "tokens"}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                metric === "tokens"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Tokens
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shadow-xs border-border/80 text-xs"
            onClick={() => setShowPriceOverrides(true)}
            aria-label="Configure custom model prices"
          >
            <SlidersHorizontalIcon className="size-3.5" aria-hidden />
            <span>Custom prices</span>
          </Button>
        </div>
      </div>

      {showPriceOverrides ? (
        <UsagePriceOverrides
          usage={summary ? [{ summary }] : []}
          onOpenChange={setShowPriceOverrides}
        />
      ) : null}

      {summaryState.loading && !summary ? (
        <PageLoadingState
          compact
          className="h-64"
          label="Loading usage history"
          detail="Aggregating transcript activity and cost metrics…"
        />
      ) : !hasActivity ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/20">
          <DatabaseIcon className="size-8 text-muted-foreground/60 mb-2" />
          <h3 className="text-sm font-semibold text-foreground">
            No usage recorded in this time window
          </h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Prompts and model responses executed in Tabs will automatically appear here with full
            token and cost telemetry.
          </p>
        </div>
      ) : (
        <>
          {/* Hero Row: Large Figure + Provider Bars */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] items-start">
            {/* Hero Card */}
            <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm shadow-xs overflow-hidden">
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {metric === "cost" ? "API-Equivalent Cost" : "Total Processed Tokens"}
                </span>
                <div className="overflow-hidden py-0.5">
                  <span
                    className="block text-3xl font-bold tracking-tight text-foreground tabular-nums truncate"
                    style={{ fontFamily: "var(--font-sans, inherit)" }}
                  >
                    {metric === "cost"
                      ? formatUsd(merged.costUsd)
                      : formatTokens(merged.totalTokens)}
                  </span>
                </div>
                {metric === "cost" ? (
                  <span className="text-[11px] text-muted-foreground/80 italic">
                    {merged.costQuality.unpricedShare > 0
                      ? `${formatPercent(merged.costQuality.unpricedShare)} of tokens have no known rate and are excluded`
                      : "Estimate from provider-reported costs and current model rates; not your subscription bill"}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {formatCount(merged.totalTokens)} exact tokens
                  </span>
                )}
              </div>

              <div className="border-t border-border/50 pt-3 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Sessions</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatCount(merged.sessions)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Records</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatCount(merged.records)}
                  </span>
                </div>
              </div>

              {/* Per-Provider Bars */}
              <div className="border-t border-border/50 pt-3 space-y-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Provider Share
                </span>
                <div className="space-y-3">
                  {merged.providers.map((p) => {
                    const {
                      name: displayName,
                      icon: IconComp,
                      color,
                    } = normalizeProvider(p.provider);
                    const share = metric === "cost" ? p.costShare : p.tokenShare;

                    return (
                      <div key={p.provider} className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: color }}
                              aria-hidden
                            />
                            <IconComp className="size-3.5 shrink-0" />
                            <span className="truncate font-medium text-foreground">
                              {displayName}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 tabular-nums">
                            <span className="text-muted-foreground">{formatPercent(share)}</span>
                            <span className="font-semibold text-foreground">
                              {metric === "cost"
                                ? formatUsd(p.costUsd)
                                : formatTokens(p.totalTokens)}
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(2, Math.min(100, share * 100))}%`,
                              backgroundColor: color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Daily Cost Area Chart */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {timeWindow === "24h" ? "Hourly Activity" : "Daily Activity"}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {timeWindow === "24h" ? "Past 24 hours" : `${merged.daily.length} active days`}
                </span>
              </div>
              <UsageDailyChart days={[]} daily={merged.daily} metric={metric} />
            </div>
          </div>

          {merged.costQuality.unpricedShare > 0 ? (
            <div
              role="status"
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-muted-foreground"
            >
              Some model identifiers could not be matched to a reliable price. Their token counts
              are included, but their cost is intentionally left unpriced instead of using a made-up
              fallback.
            </div>
          ) : null}

          {/* Aggregate Stats Row */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Aggregate Token Telemetry</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {/* Metric 1: Processed Tokens */}
              <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-card/30 p-4 shadow-xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Processed Tokens</span>
                  <CpuIcon className="size-4 text-primary" />
                </div>
                <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatTokens(merged.totalTokens)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  Total prompt & response
                </span>
              </div>

              {/* Metric 2: Cached Input */}
              <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-card/30 p-4 shadow-xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Cached Input</span>
                  <DatabaseIcon className="size-4 text-emerald-500" />
                </div>
                <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatTokens(merged.cachedInputTokens)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {inputTokens > 0
                    ? `${formatPercent(merged.cachedInputTokens / inputTokens)} of input`
                    : "0% of input"}
                </span>
              </div>

              {/* Metric 3: Uncached Input */}
              <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-card/30 p-4 shadow-xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Uncached Input</span>
                  <LayersIcon className="size-4 text-amber-500" />
                </div>
                <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatTokens(merged.uncachedInputTokens)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  Fresh context tokens
                </span>
              </div>

              {/* Metric 4: Cache Writes */}
              <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-card/30 p-4 shadow-xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Cache Writes</span>
                  <DatabaseIcon className="size-4 text-violet-500" />
                </div>
                <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatTokens(merged.cacheCreationTokens)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  New cached context
                </span>
              </div>

              {/* Metric 5: Output Tokens */}
              <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-card/30 p-4 shadow-xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Output Tokens</span>
                  <ZapIcon className="size-4 text-sky-500" />
                </div>
                <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatTokens(merged.outputTokens)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {merged.reasoningTokens > 0
                    ? `incl. ${formatTokens(merged.reasoningTokens)} reasoning`
                    : "Generated responses"}
                </span>
              </div>

              {/* Metric 6: Cache Savings */}
              <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-card/30 p-4 shadow-xs backdrop-blur-sm bg-gradient-to-br from-emerald-500/5 to-transparent">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Cache Savings</span>
                  <PercentIcon className="size-4 text-emerald-500" />
                </div>
                <span className="text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatUsd(merged.costQuality.cacheSavingsUsd)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {cacheSavingsShare > 0
                    ? `${formatPercent(cacheSavingsShare)} below uncached input pricing`
                    : "From prompt caching"}
                </span>
              </div>
            </div>
          </div>

          {/* Model Breakdown Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Model Breakdown</h3>
              <div
                className="tabs-segmented flex items-center text-[11px]"
                role="group"
                aria-label="Model breakdown"
              >
                <button
                  type="button"
                  onClick={() => setBreakdownView("model")}
                  aria-pressed={breakdownView === "model"}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium transition-colors",
                    breakdownView === "model"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  By Model
                </button>
                <button
                  type="button"
                  onClick={() => setBreakdownView("provider")}
                  aria-pressed={breakdownView === "provider"}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium transition-colors",
                    breakdownView === "provider"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  By Provider
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border/80 bg-card/30 backdrop-blur-sm shadow-xs">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                    <th className="py-2.5 px-4 font-semibold">
                      {breakdownView === "model" ? "Model Name" : "Provider"}
                    </th>
                    {breakdownView === "model" ? (
                      <th className="py-2.5 px-4 font-semibold">Provider</th>
                    ) : null}
                    <th className="py-2.5 px-4 text-right font-semibold">Total Cost</th>
                    <th className="py-2.5 px-4 text-right font-semibold">Share</th>
                    <th className="py-2.5 px-4 text-right font-semibold">Total Tokens</th>
                    <th className="py-2.5 px-4 text-right font-semibold">Records</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {breakdownView === "model"
                    ? merged.models.map((m) => {
                        const { name: providerName, icon: IconComp } = normalizeProvider(
                          m.provider,
                        );

                        return (
                          <tr
                            key={`${m.provider}-${m.model}`}
                            className="hover:bg-muted/30 transition-colors"
                          >
                            <td className="py-2.5 px-4 font-medium text-foreground font-mono">
                              {m.model}
                            </td>
                            <td className="py-2.5 px-4 text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <IconComp className="size-3.5" />
                                <span>{providerName}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-semibold text-foreground tabular-nums">
                              {formatUsd(m.costUsd)}
                            </td>
                            <td className="py-2.5 px-4 text-right text-muted-foreground tabular-nums">
                              {formatPercent(m.costShare)}
                            </td>
                            <td className="py-2.5 px-4 text-right text-muted-foreground tabular-nums">
                              {formatTokens(m.totalTokens)}
                            </td>
                            <td className="py-2.5 px-4 text-right text-muted-foreground tabular-nums">
                              {formatCount(m.records)}
                            </td>
                          </tr>
                        );
                      })
                    : merged.providers.map((p) => {
                        const { name: providerName, icon: IconComp } = normalizeProvider(
                          p.provider,
                        );

                        return (
                          <tr key={p.provider} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 px-4 font-medium text-foreground">
                              <div className="flex items-center gap-2">
                                <IconComp className="size-4" />
                                <span>{providerName}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-semibold text-foreground tabular-nums">
                              {formatUsd(p.costUsd)}
                            </td>
                            <td className="py-2.5 px-4 text-right text-muted-foreground tabular-nums">
                              {formatPercent(p.costShare)}
                            </td>
                            <td className="py-2.5 px-4 text-right text-muted-foreground tabular-nums">
                              {formatTokens(p.totalTokens)}
                            </td>
                            <td className="py-2.5 px-4 text-right text-muted-foreground tabular-nums">
                              {formatCount(p.records)}
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
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
