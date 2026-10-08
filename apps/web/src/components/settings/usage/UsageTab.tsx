import { SegmentedControl } from "../../ui/segmented-control";
import "./usage.css";
import { useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { formatCount, formatPercent, formatTokens, formatUsd } from "@tabs/shared/usageFormat";
import { isModelCostUnknown, mergeUsage } from "@tabs/shared/usageMerge";
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
import { SlidersHorizontalIcon, DatabaseIcon } from "lucide-react";
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
  const [metric, setMetric] = useState<"cost" | "tokens">("tokens");
  const [breakdownView, setBreakdownView] = useState<"model" | "provider">("model");
  const [showPriceOverrides, setShowPriceOverrides] = useState(false);
  const [priceModelId, setPriceModelId] = useState<string | undefined>();

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
    <div className="usage-dashboard">
      <div className="usage-toolbar">
        <SegmentedControl
          value={timeWindow}
          onValueChange={selectWindow}
          options={WINDOW_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          aria-label="Usage date range"
          size="sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={metric}
            onValueChange={setMetric}
            options={[
              { value: "tokens", label: "Tokens" },
              { value: "cost", label: "API cost" },
            ]}
            aria-label="Usage metric"
            size="sm"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPriceModelId(undefined);
              setShowPriceOverrides(true);
            }}
            aria-label="Configure custom model prices"
          >
            <SlidersHorizontalIcon className="size-3.5" aria-hidden />
            <span>Prices</span>
          </Button>
        </div>
      </div>
      {showPriceOverrides ? (
        <UsagePriceOverrides
          usage={summary ? [{ summary }] : []}
          {...(priceModelId ? { initialModelId: priceModelId } : {})}
          onSaved={() => {
            void fetchUsageSummary();
          }}
          onOpenChange={setShowPriceOverrides}
        />
      ) : null}
      {summaryState.error ? (
        <p role="alert" className="usage-notice">
          Could not refresh usage. {summaryState.error}
        </p>
      ) : null}
      {summaryState.loading && !summary ? (
        <PageLoadingState compact className="h-64" label="Loading usage history" />
      ) : !hasActivity ? (
        <div className="usage-empty">
          <DatabaseIcon className="size-6" aria-hidden />
          <h3>No activity yet</h3>
          <p>Usage will appear here as you work with your agents.</p>
        </div>
      ) : (
        <>
          <section className="usage-overview" aria-label="Usage overview">
            <div className="usage-totals">
              <div className="usage-primary-stat">
                <span>{metric === "cost" ? "API-equivalent cost" : "Tokens processed"}</span>
                <strong>
                  {metric === "cost" ? formatUsd(merged.costUsd) : formatTokens(merged.totalTokens)}
                </strong>
                <p>
                  {metric === "cost"
                    ? "Estimated API value, not your subscription bill."
                    : `${formatCount(merged.sessions)} sessions · ${formatCount(merged.records)} records`}
                </p>
              </div>
              <div className="usage-small-stat">
                <span>{metric === "cost" ? "Tokens processed" : "API-equivalent cost"}</span>
                <strong>
                  {metric === "cost" ? formatTokens(merged.totalTokens) : formatUsd(merged.costUsd)}
                </strong>
                <p>
                  {metric === "cost"
                    ? `${formatCount(merged.sessions)} sessions`
                    : "Estimate, not your bill"}
                </p>
              </div>
              <div className="usage-small-stat">
                <span>Input served from cache</span>
                <strong>
                  {formatPercent(inputTokens > 0 ? merged.cachedInputTokens / inputTokens : 0)}
                </strong>
                <p>{formatTokens(merged.cachedInputTokens)} cached tokens</p>
              </div>
            </div>
            <div className="usage-activity">
              <div className="usage-section-heading">
                <h3>{timeWindow === "24h" ? "Hourly activity" : "Daily activity"}</h3>
                <span>
                  {timeWindow === "24h" ? "Past 24 hours" : `${merged.daily.length} active days`}
                </span>
              </div>
              <UsageDailyChart
                days={[]}
                daily={
                  timeWindow === "24h"
                    ? merged.hourly.map((hour) => ({ ...hour, day: hour.hourStart }))
                    : merged.daily
                }
                hourly={timeWindow === "24h"}
                metric={metric}
                className="usage-chart"
              />
            </div>
          </section>
          {merged.costQuality.unpricedShare > 0 ? (
            <p role="status" className="usage-notice">
              {formatPercent(merged.costQuality.unpricedShare)} of tokens have no known price. They
              count toward usage, but are excluded from cost.
            </p>
          ) : null}
          <section aria-label="Usage by provider" className="usage-providers">
            {merged.providers.map((p) => {
              const { name, icon: IconComp } = normalizeProvider(p.provider);
              const share = metric === "cost" ? p.costShare : p.tokenShare;
              return (
                <div key={p.provider} className="usage-provider">
                  <div className="usage-section-heading">
                    <span className="flex items-center gap-2">
                      <IconComp className="size-4" aria-hidden />
                      <b>{name}</b>
                    </span>
                    <span>{formatPercent(share)}</span>
                  </div>
                  <strong>
                    {metric === "cost" ? formatUsd(p.costUsd) : formatTokens(p.totalTokens)}
                  </strong>
                  <div className="usage-share" aria-hidden="true">
                    <div style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />
                  </div>
                </div>
              );
            })}
          </section>
          <section className="usage-breakdown">
            <div className="usage-section-heading">
              <h3>Breakdown</h3>
              <SegmentedControl
                value={breakdownView}
                onValueChange={setBreakdownView}
                options={[
                  { value: "model", label: "Models" },
                  { value: "provider", label: "Providers" },
                ]}
                aria-label="Model breakdown"
                size="sm"
              />
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border/80 bg-card/30 backdrop-blur-sm shadow-xs">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                    <th scope="col" className="py-2.5 px-4 font-semibold">
                      {breakdownView === "model" ? "Model Name" : "Provider"}
                    </th>
                    {breakdownView === "model" ? (
                      <th scope="col" className="py-2.5 px-4 font-semibold">
                        Provider
                      </th>
                    ) : null}
                    <th scope="col" className="py-2.5 px-4 text-right font-semibold">
                      Total Cost
                    </th>
                    <th scope="col" className="py-2.5 px-4 text-right font-semibold">
                      Share
                    </th>
                    <th scope="col" className="py-2.5 px-4 text-right font-semibold">
                      Total Tokens
                    </th>
                    <th scope="col" className="py-2.5 px-4 text-right font-semibold">
                      Records
                    </th>
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
                            <td className="py-2.5 px-4 font-medium text-foreground font-mono break-all">
                              {m.model}
                            </td>
                            <td className="py-2.5 px-4 text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <IconComp className="size-3.5" />
                                <span>{providerName}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-semibold text-foreground tabular-nums">
                              {isModelCostUnknown(m) ? (
                                <button
                                  type="button"
                                  className="usage-price-action"
                                  onClick={() => {
                                    setPriceModelId(m.model);
                                    setShowPriceOverrides(true);
                                  }}
                                  aria-label={`Set prices for ${m.model}`}
                                >
                                  Set price <span aria-hidden="true">↗</span>
                                </button>
                              ) : (
                                formatUsd(m.costUsd)
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right text-muted-foreground tabular-nums">
                              {metric === "cost" && isModelCostUnknown(m)
                                ? "—"
                                : formatPercent(metric === "cost" ? m.costShare : m.tokenShare)}
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
                              {formatPercent(metric === "cost" ? p.costShare : p.tokenShare)}
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
          </section>
          <details className="usage-details">
            <summary>
              Token details <span>Input, output & cache savings</span>
            </summary>
            <dl className="usage-token-details">
              {[
                ["Processed", formatTokens(merged.totalTokens)],
                ["Cached input", formatTokens(merged.cachedInputTokens)],
                ["Uncached input", formatTokens(merged.uncachedInputTokens)],
                ["Cache writes", formatTokens(merged.cacheCreationTokens)],
                ["Output", formatTokens(merged.outputTokens)],
                ["Reasoning", formatTokens(merged.reasoningTokens)],
                ["Estimated cache savings", formatUsd(merged.costQuality.cacheSavingsUsd)],
                ["Savings vs. uncached input", formatPercent(cacheSavingsShare)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </details>
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
