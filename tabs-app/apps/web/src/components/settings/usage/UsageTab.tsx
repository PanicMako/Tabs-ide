import "./usage.css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useAtomValue } from "@effect/atom-react";
import type { UsageProviderKind } from "@tabs/contracts";
import { formatCount, formatPercent, formatTokens, formatUsd } from "@tabs/shared/usageFormat";
import { isModelCostUnknown, mergeUsage, type ModelTotals } from "@tabs/shared/usageMerge";
import { DatabaseIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import {
  usageMetricAtom,
  usageTimeWindowAtom,
  usageShownWindowAtom,
  usageSummaryStateAtom,
  fetchUsageSummary,
  type UsageWindowPreset,
} from "../../../state/usage";
import { appAtomRegistry } from "../../../state/atomRegistry";
import { ModelDetailModal } from "./ModelDetailModal";
import { Button } from "../../ui/button";
import { SegmentedControl } from "../../ui/segmented-control";
import { UsagePriceOverrides } from "../../usage/UsagePriceOverrides";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "../../usage/usageProviders";
import { morphTarget, useInlineMorph, useReorderGlide } from "./useUsageMorph";
import { useSurfaceMotionSettings } from "../../../panelAnimations";
import { cn } from "../../../lib/utils";
import { ledgerPeriods, sliceSummary } from "./usageLedger";
import { ActivityChart } from "./UsageActivityChart";

type Metric = "cost" | "tokens";

const WINDOW_PRESETS: ReadonlyArray<{ id: UsageWindowPreset; label: string; phrase: string }> = [
  { id: "24h", label: "24h", phrase: "past 24 hours" },
  { id: "7d", label: "7 days", phrase: "past 7 days" },
  { id: "30d", label: "30 days", phrase: "past 30 days" },
  { id: "90d", label: "90 days", phrase: "past 90 days" },
  { id: "all", label: "All time", phrase: "all time" },
];

const MODEL_PREVIEW = 8;

const figure = (metric: Metric, value: { costUsd: number; totalTokens: number }) =>
  metric === "cost" ? formatUsd(value.costUsd) : formatTokens(value.totalTokens);

function providerOf(provider: UsageProviderKind) {
  return PROVIDER_PRESENTATION[provider] ?? PROVIDER_PRESENTATION.codex;
}

export function UsageTab() {
  const timeWindow = useAtomValue(usageTimeWindowAtom);
  const shownWindow = useAtomValue(usageShownWindowAtom);
  const summaryState = useAtomValue(usageSummaryStateAtom);
  const metric = useAtomValue(usageMetricAtom);
  const [hoverPeriod, setHoverPeriod] = useState<string | null>(null);
  const [pinnedPeriod, setPinnedPeriod] = useState<string | null>(null);
  const [focusProvider, setFocusProvider] = useState<UsageProviderKind | null>(null);
  const [hoverProvider, setHoverProvider] = useState<UsageProviderKind | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);
  const [showPriceOverrides, setShowPriceOverrides] = useState(false);
  const [priceModelId, setPriceModelId] = useState<string | undefined>();
  const [inspectModel, setInspectModel] = useState<ModelTotals | null>(null);

  const summary = summaryState.data;
  const hourly = (shownWindow ?? timeWindow) === "24h";
  const merged = useMemo(() => mergeUsage(summary), [summary]);
  const periods = useMemo(
    () => (summary ? ledgerPeriods(summary, merged, hourly) : []),
    [summary, merged, hourly],
  );
  const activePeriodKey = hoverPeriod ?? pinnedPeriod;
  const activePeriod = periods.find((period) => period.key === activePeriodKey) ?? null;
  // The figures above the strip follow the scrubbed period and the focused provider.
  const slice = useMemo(
    () =>
      summary && (activePeriodKey || focusProvider)
        ? mergeUsage(
            sliceSummary(summary, { periodKey: activePeriodKey, hourly, provider: focusProvider }),
          )
        : merged,
    [summary, merged, activePeriodKey, hourly, focusProvider],
  );
  // Lists re-rank only on a deliberate choice (a pin or a filter), never while
  // the pointer sweeps the chart, so scrubbing stays calm.
  const committed = useMemo(
    () =>
      summary && (pinnedPeriod || focusProvider)
        ? mergeUsage(
            sliceSummary(summary, { periodKey: pinnedPeriod, hourly, provider: focusProvider }),
          )
        : merged,
    [summary, merged, pinnedPeriod, hourly, focusProvider],
  );
  // The provider split ignores the provider focus so every share stays visible.
  const periodSlice = useMemo(
    () =>
      summary && activePeriodKey
        ? mergeUsage(sliceSummary(summary, { periodKey: activePeriodKey, hourly }))
        : merged,
    [summary, merged, activePeriodKey, hourly],
  );

  const stale = summaryState.loading && shownWindow !== null && shownWindow !== timeWindow;
  const updating = summaryState.loading && summary !== null;
  const hasActivity = merged.totalTokens > 0 || merged.costUsd > 0;
  const windowPhrase =
    WINDOW_PRESETS.find((preset) => preset.id === (shownWindow ?? timeWindow))?.phrase ?? "";

  const selectWindow = (next: UsageWindowPreset) => {
    setPinnedPeriod(null);
    setHoverPeriod(null);
    appAtomRegistry.set(usageTimeWindowAtom, next);
    void fetchUsageSummary(next);
  };
  const setMetric = (next: Metric) => appAtomRegistry.set(usageMetricAtom, next);
  const openPrices = (modelId?: string) => {
    setPriceModelId(modelId);
    setShowPriceOverrides(true);
  };

  return (
    <div className="usage-ledger" aria-busy={summaryState.loading}>
      <div className="usage-ledger-toolbar">
        <div className="usage-underline" role="radiogroup" aria-label="Usage date range">
          {WINDOW_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={timeWindow === preset.id}
              onClick={() => selectWindow(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="usage-ledger-toolbar-end">
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
            onClick={() => openPrices()}
            aria-label="Configure custom model prices"
          >
            <SlidersHorizontalIcon className="size-3.5" aria-hidden />
            Prices
          </Button>
        </div>
      </div>

      {showPriceOverrides ? (
        <UsagePriceOverrides
          usage={summary ? [{ summary }] : []}
          {...(priceModelId ? { initialModelId: priceModelId } : {})}
          onSaved={() => void fetchUsageSummary(undefined, { force: true })}
          onOpenChange={setShowPriceOverrides}
        />
      ) : null}
      {inspectModel ? (
        <ModelDetailModal
          model={inspectModel}
          summary={summary}
          timeWindow={shownWindow ?? timeWindow}
          parentDays={
            hourly ? merged.hourly.map((hour) => hour.hourStart) : merged.daily.map((d) => d.day)
          }
          onClose={() => setInspectModel(null)}
          onSetPrice={(modelId) => openPrices(modelId)}
        />
      ) : null}

      {summaryState.error ? (
        <p role="alert" className="usage-note">
          Could not refresh usage. {summaryState.error}
        </p>
      ) : null}

      {!summary ? (
        <LedgerSkeleton />
      ) : !hasActivity ? (
        <div className={cn("usage-empty", stale && "is-stale")}>
          <DatabaseIcon className="size-5" aria-hidden />
          <h3>Nothing recorded for the {windowPhrase}</h3>
          <p>Usage appears here as your agents work. Try a longer range.</p>
        </div>
      ) : (
        <div className={cn("usage-ledger-body", stale && "is-stale")}>
          <section className="usage-hero" aria-label="Usage overview">
            <div className="usage-hero-lead">
              <span className="usage-caption">
                {activePeriod ? activePeriod.label : windowPhrase}
                {focusProvider ? ` · ${providerOf(focusProvider).label}` : ""}
                {updating ? <em> · updating</em> : null}
              </span>
              <TweenedFigure
                className="usage-hero-figure"
                value={metric === "cost" ? slice.costUsd : slice.totalTokens}
                format={metric === "cost" ? formatUsd : formatTokens}
              />
              <p className="usage-hero-sub">
                {metric === "cost"
                  ? "API-equivalent value, not your subscription bill"
                  : `${formatCount(slice.sessions)} sessions · ${formatCount(slice.records)} requests`}
              </p>
            </div>
            <dl className="usage-hero-facts">
              <div>
                <dt>{metric === "cost" ? "Tokens" : "API value"}</dt>
                <dd>
                  {metric === "cost" ? formatTokens(slice.totalTokens) : formatUsd(slice.costUsd)}
                </dd>
              </div>
              <div>
                <dt>Served from cache</dt>
                <dd>{formatPercent(cacheShare(slice))}</dd>
              </div>
              <div>
                <dt>Cache saved</dt>
                <dd>{formatUsd(slice.costQuality.cacheSavingsUsd)}</dd>
              </div>
            </dl>
          </section>

          <ActivityChart
            periods={periods}
            metric={metric}
            hourly={hourly}
            activeKey={activePeriodKey}
            pinnedKey={pinnedPeriod}
            highlight={hoverProvider ?? focusProvider}
            onHover={setHoverPeriod}
            onPin={setPinnedPeriod}
          />

          {pinnedPeriod || focusProvider ? (
            <div className="usage-filters" aria-label="Active filters">
              {pinnedPeriod ? (
                <button type="button" onClick={() => setPinnedPeriod(null)}>
                  {periods.find((period) => period.key === pinnedPeriod)?.label ?? "Period"}
                  <XIcon className="size-3" aria-label="Clear period" />
                </button>
              ) : null}
              {focusProvider ? (
                <button type="button" onClick={() => setFocusProvider(null)}>
                  {providerOf(focusProvider).label}
                  <XIcon className="size-3" aria-label="Clear provider" />
                </button>
              ) : null}
            </div>
          ) : null}

          <ProviderSpectrum
            usage={periodSlice}
            metric={metric}
            focus={focusProvider}
            onHover={setHoverProvider}
            onFocus={(provider) =>
              setFocusProvider((current) => (current === provider ? null : provider))
            }
          />

          {merged.costQuality.unpricedShare > 0 && metric === "cost" ? (
            <p role="status" className="usage-note">
              {formatPercent(merged.costQuality.unpricedShare)} of tokens have no known price, so
              they count toward usage but not cost.{" "}
              <button type="button" className="usage-link" onClick={() => openPrices()}>
                Set prices
              </button>
            </p>
          ) : null}

          <ModelIndex
            models={committed.models}
            metric={metric}
            showAll={showAllModels}
            onToggleShowAll={() => setShowAllModels((value) => !value)}
            onInspect={setInspectModel}
            onSetPrice={openPrices}
            highlight={hoverProvider}
          />

          <TokenAnatomy usage={committed} />

          <p className="usage-footnote">
            Read {formatCount(summary.sources.reduce((n, source) => n + source.scannedFiles, 0))}{" "}
            files from {formatCount(summary.sources.filter((s) => s.scannedFiles > 0).length)}{" "}
            sources in {(summary.scanDurationMs / 1000).toFixed(1)}s · prices{" "}
            {summary.pricing.status === "unavailable"
              ? "unavailable"
              : `via LiteLLM (${summary.pricing.status})`}
          </p>
        </div>
      )}
    </div>
  );
}

function cacheShare(usage: ReturnType<typeof mergeUsage>): number {
  const input = usage.uncachedInputTokens + usage.cachedInputTokens + usage.cacheCreationTokens;
  return input > 0 ? usage.cachedInputTokens / input : 0;
}

/** A figure that counts to its new value instead of snapping, on the app's motion pace. */
function TweenedFigure({
  value,
  format,
  className,
}: {
  readonly value: number;
  readonly format: (value: number) => string;
  readonly className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const shown = useRef(value);
  const { active, seconds, profile } = useSurfaceMotionSettings();
  // Writes text directly so a count-up does not re-render the page every frame.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!active || shown.current === value) {
      shown.current = value;
      node.textContent = format(value);
      return;
    }
    const state = { value: shown.current };
    const tween = gsap.to(state, {
      value,
      duration: seconds(0.32),
      ease: profile.ease,
      onUpdate: () => {
        shown.current = state.value;
        node.textContent = format(state.value);
      },
      onComplete: () => {
        shown.current = value;
        node.textContent = format(value);
      },
    });
    return () => {
      tween.kill();
    };
  }, [active, format, profile.ease, seconds, value]);
  return (
    <strong ref={ref} className={className}>
      {format(value)}
    </strong>
  );
}

/** One bar split by provider, with a legend that highlights on hover and filters on click. */
function ProviderSpectrum({
  usage,
  metric,
  focus,
  onHover,
  onFocus,
}: {
  readonly usage: ReturnType<typeof mergeUsage>;
  readonly metric: Metric;
  readonly focus: UsageProviderKind | null;
  readonly onHover: (provider: UsageProviderKind | null) => void;
  readonly onFocus: (provider: UsageProviderKind) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  useInlineMorph(barRef, "i[data-key]", "flexGrow", [usage, metric]);
  const providers = usage.providers.filter((p) => p.totalTokens > 0 || p.costUsd > 0);
  if (providers.length === 0) return null;
  const share = (p: (typeof providers)[number]) => (metric === "cost" ? p.costShare : p.tokenShare);
  return (
    <section className="usage-spectrum" aria-label="Usage by provider">
      <div ref={barRef} className="usage-spectrum-bar" aria-hidden>
        {providers.map((p) => (
          <i
            key={p.provider}
            data-key={p.provider}
            {...morphTarget("flexGrow", Math.max(share(p), 0.004))}
            style={{
              flexGrow: Math.max(share(p), 0.004),
              background: providerOf(p.provider).color,
            }}
            data-dim={focus && focus !== p.provider ? "" : undefined}
          />
        ))}
      </div>
      <ul className="usage-spectrum-legend" onPointerLeave={() => onHover(null)}>
        {providers.map((p) => {
          const presentation = providerOf(p.provider);
          const Mark = presentation.mark;
          return (
            <li key={p.provider}>
              <button
                type="button"
                aria-pressed={focus === p.provider}
                onPointerEnter={() => onHover(p.provider)}
                onFocus={() => onHover(p.provider)}
                onBlur={() => onHover(null)}
                onClick={() => onFocus(p.provider)}
                data-dim={focus && focus !== p.provider ? "" : undefined}
              >
                <i style={{ background: presentation.color }} aria-hidden />
                <Mark className="size-3.5" aria-hidden />
                <span className="usage-spectrum-name">{presentation.label}</span>
                <span className="usage-spectrum-share">{formatPercent(share(p))}</span>
                <b>{figure(metric, p)}</b>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Models as an editorial index: rank, name, provider, a bar against the leader, the figure. */
function ModelIndex({
  models,
  metric,
  showAll,
  onToggleShowAll,
  onInspect,
  onSetPrice,
  highlight,
}: {
  readonly models: readonly ModelTotals[];
  readonly metric: Metric;
  readonly showAll: boolean;
  readonly onToggleShowAll: () => void;
  readonly onInspect: (model: ModelTotals) => void;
  readonly onSetPrice: (modelId: string) => void;
  readonly highlight: UsageProviderKind | null;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const ranked = useMemo(
    () =>
      metric === "tokens"
        ? models.toSorted((a, b) => b.totalTokens - a.totalTokens)
        : models.toSorted((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens),
    [models, metric],
  );
  const shown = showAll ? ranked : ranked.slice(0, MODEL_PREVIEW);
  const lead = ranked[0] ? (metric === "cost" ? ranked[0].costUsd : ranked[0].totalTokens) : 0;

  // A new period or metric re-ranks the models: rows glide to their place and bars ease.
  const order = shown.map((model) => `${model.provider}:${model.model}`).join("|");
  useReorderGlide(listRef, ":scope > li", [order]);
  useInlineMorph(listRef, ".usage-model-bar > i", "width", [shown, metric]);

  if (ranked.length === 0) return null;
  return (
    <section className="usage-models" aria-label="Usage by model">
      <div className="usage-section-head">
        <h3>Models</h3>
        <span className="usage-caption">{ranked.length} in use</span>
      </div>
      <ol ref={listRef}>
        {shown.map((model, index) => {
          const presentation = providerOf(model.provider);
          const Mark = presentation.mark;
          const unknownCost = isModelCostUnknown(model);
          const value = metric === "cost" ? model.costUsd : model.totalTokens;
          const barWidth = `${lead > 0 && !(metric === "cost" && unknownCost) ? (value / lead) * 100 : 0}%`;
          return (
            <li
              key={`${model.provider}:${model.model}`}
              data-key={`${model.provider}:${model.model}`}
              data-dim={highlight && highlight !== model.provider ? "" : undefined}
            >
              <button
                type="button"
                className="usage-model-row"
                onClick={() => onInspect(model)}
                aria-label={`Inspect ${model.model}`}
              >
                <span className="usage-model-rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="usage-model-name">
                  <code>{model.model}</code>
                  <small>
                    <Mark className="size-3" aria-hidden />
                    {presentation.label}
                    {` · ${formatCount(model.records)} requests`}
                  </small>
                </span>
                <span className="usage-model-bar" aria-hidden>
                  <i
                    data-key={`${model.provider}:${model.model}`}
                    {...morphTarget("width", barWidth)}
                    style={{
                      width: barWidth,
                      background: presentation.color,
                    }}
                  />
                </span>
                <span className="usage-model-share">
                  {metric === "cost" && unknownCost
                    ? "—"
                    : formatPercent(metric === "cost" ? model.costShare : model.tokenShare)}
                </span>
              </button>
              <span className="usage-model-figure">
                {metric === "tokens" ? (
                  formatTokens(model.totalTokens)
                ) : unknownCost ? (
                  <button
                    type="button"
                    className="usage-link"
                    onClick={() => onSetPrice(model.model)}
                    aria-label={`Set prices for ${model.model}`}
                  >
                    Set price
                  </button>
                ) : (
                  formatUsd(model.costUsd)
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {ranked.length > MODEL_PREVIEW ? (
        <button type="button" className="usage-link usage-models-more" onClick={onToggleShowAll}>
          {showAll ? "Show top models" : `Show all ${ranked.length} models`}
        </button>
      ) : null}
    </section>
  );
}

/** Where input and output tokens went, as one proportional bar with its legend. */
function TokenAnatomy({ usage }: { readonly usage: ReturnType<typeof mergeUsage> }) {
  const parts = [
    { label: "Cache read", value: usage.cachedInputTokens, tone: 26 },
    { label: "Uncached input", value: usage.uncachedInputTokens, tone: 52 },
    { label: "Cache write", value: usage.cacheCreationTokens, tone: 70 },
    { label: "Output", value: usage.outputTokens, tone: 90 },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const barRef = useRef<HTMLDivElement>(null);
  useInlineMorph(barRef, "i[data-key]", "flexGrow", [usage]);
  if (total === 0) return null;
  return (
    <section className="usage-anatomy" aria-label="Token details">
      <div className="usage-section-head">
        <h3>Token anatomy</h3>
        <span className="usage-caption">
          {formatTokens(usage.reasoningTokens)} of output was reasoning
        </span>
      </div>
      <div ref={barRef} className="usage-anatomy-bar" aria-hidden>
        {parts.map((part) => (
          <i
            key={part.label}
            data-key={part.label}
            {...morphTarget("flexGrow", part.value / total)}
            style={{
              flexGrow: part.value / total,
              background: `color-mix(in oklab, var(--foreground) ${part.tone}%, var(--background))`,
            }}
          />
        ))}
      </div>
      <dl className="usage-anatomy-legend">
        {parts.map((part) => (
          <div key={part.label}>
            <dt>
              <i
                style={{
                  background: `color-mix(in oklab, var(--foreground) ${part.tone}%, var(--background))`,
                }}
                aria-hidden
              />
              {part.label}
            </dt>
            <dd>
              {formatTokens(part.value)} <span>{formatPercent(part.value / total)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The ledger's shape while the first scan of a window runs; static, so it costs no frames. */
function LedgerSkeleton() {
  return (
    <div className="usage-skeleton" role="status" aria-label="Loading usage history">
      <div className="usage-skeleton-hero">
        <span />
        <strong />
        <span />
      </div>
      <div className="usage-skeleton-strip">
        {Array.from({ length: 30 }, (_, index) => (
          <i key={index} style={{ height: `${18 + ((index * 37) % 70)}%` }} />
        ))}
      </div>
      <p className="usage-caption">Reading transcripts from your providers…</p>
    </div>
  );
}
