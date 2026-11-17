import {
  collectLimitAccounts,
  collectLimitNotices,
  collectLimitPools,
  formatDuration,
  limitAccountName,
  type LimitPool,
  type LimitPoolWindow,
} from "@tabs/shared/usageLimits";
import gsap from "gsap";
import { GaugeIcon, PinIcon } from "lucide-react";
import {
  type PointerEvent,
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getDriverOption } from "../settings/providerDriverMeta";
import { barColor } from "./UsageLimits";
import { LimitNotices } from "./UsageLimitsPooled";

const DOT_COUNT = 20;
const LOW_PERCENT = 15;
const SUMMARY = "summary";
/** Width in px of one chip (`w-9`); the sliding pill moves this far per page. */
const CHIP_WIDTH = 36;
const UNLIT_SCALE = 0.4;
const LIT_SCALE = 0.9;
/** How far the dots under the pointer swell, and how many dots the swell reaches. */
const SWELL = 0.45;
const SWELL_REACH = 2.2;
/** The tallest the card gets before its page scrolls: a fixed cap, or most of the window if smaller. */
const MAX_HEIGHT = 440;
const MAX_VIEWPORT_SHARE = 0.6;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The share left as a row of dots. Dots still open are full and coloured; the
 * spent ones shrink to pinpoints, so the row reads as a level, not a stripe.
 * A mouse swells the dots near it like a dock; touch and reduced motion skip it.
 */
function DotMeter({
  percent,
  color,
  label,
  large = false,
}: {
  readonly percent: number;
  readonly color: string;
  readonly label: string;
  readonly large?: boolean;
}) {
  const lit = percent <= 0 ? 0 : Math.max(1, Math.round((percent / 100) * DOT_COUNT));
  const dots = useRef<Array<HTMLSpanElement | null>>([]);
  const base = (index: number) => (index < lit ? LIT_SCALE : UNLIT_SCALE);

  useLayoutEffect(() => {
    dots.current.forEach((node, index) => {
      if (node) node.style.transform = `scale(${base(index)})`;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(frame.current);
      for (const node of dots.current) if (node) gsap.killTweensOf(node);
    };
  }, []);

  // One frame at most per move, and direct writes: tweening every dot on every
  // pointer event piles up hundreds of tweens a second and stalls the page.
  const frame = useRef(0);
  const swell = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || prefersReducedMotion()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - rect.left) / rect.width) * DOT_COUNT - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      dots.current.forEach((node, index) => {
        if (!node) return;
        const reach = Math.max(0, 1 - Math.abs(index - at) / SWELL_REACH);
        node.style.transform = `scale(${base(index) + SWELL * reach})`;
      });
    });
  };

  const settle = () => {
    cancelAnimationFrame(frame.current);
    dots.current.forEach((node, index) => {
      if (!node) return;
      gsap.to(node, { scale: base(index), duration: 0.16, ease: "power1.out", overwrite: true });
    });
  };

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      onPointerMove={swell}
      onPointerLeave={settle}
      className="grid"
      style={{ gridTemplateColumns: `repeat(${DOT_COUNT}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className={cn("flex items-center justify-center", large ? "h-5" : "h-4")}
        >
          <span
            ref={(node) => {
              dots.current[index] = node;
            }}
            className={cn(
              "aspect-square w-full max-w-3 rounded-(--radius-control)",
              index >= lit && "bg-muted-foreground/35",
            )}
            style={index < lit ? { backgroundColor: color } : undefined}
          />
        </span>
      ))}
    </div>
  );
}

function refillText(window: LimitPoolWindow, now: number): string | null {
  const next = window.resets.find((reset) => reset.restoresPercent > 0);
  if (!next) return null;
  return `↻ +${next.restoresPercent}% ${next.at <= now ? "now" : `in ${formatDuration(next.at - now)}`}`;
}

/** The figure that answers "how much is left": loud when low, quiet when healthy. */
function Figure({ percent, className }: { readonly percent: number; readonly className?: string }) {
  const low = percent <= LOW_PERCENT;
  return (
    <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
      {low ? (
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Low
        </span>
      ) : null}
      <span
        className={cn("font-semibold", low ? "text-foreground" : "text-foreground/80", className)}
      >
        {percent}%
      </span>
      <span className="text-[10px] text-muted-foreground">left</span>
    </span>
  );
}

function ProviderMark({ pool, size }: { readonly pool: LimitPool; readonly size: "sm" | "xs" }) {
  const label = getDriverOption(pool.driver)?.label ?? String(pool.driver);
  return (
    <ProviderInstanceIcon
      driverKind={pool.driver}
      displayName={label}
      indicatorBackground="var(--background)"
      className={size === "sm" ? "size-5" : "size-3.5"}
      iconClassName={size === "sm" ? "size-4 text-foreground/80" : "size-3 text-foreground/80"}
    />
  );
}

/** The window closest to running out: the one that decides whether you can keep going. */
function tightestWindow(pool: LimitPool): LimitPoolWindow | null {
  let tightest: LimitPoolWindow | null = null;
  for (const window of pool.windows) {
    if (!tightest || window.remainingPercent < tightest.remainingPercent) tightest = window;
  }
  return tightest;
}

function providerLabel(pool: LimitPool): string {
  return getDriverOption(pool.driver)?.label ?? String(pool.driver);
}

function PinButton({
  label,
  pinned,
  onToggle,
}: {
  readonly label: string;
  readonly pinned: boolean;
  readonly onToggle: () => void;
}) {
  const text = pinned ? `Unpin ${label}` : `Pin ${label}`;
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={text}
      title={text}
      onClick={onToggle}
      className={cn(
        "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        pinned && "text-foreground",
      )}
    >
      <PinIcon className={cn("size-3.5", pinned && "fill-current")} aria-hidden />
    </button>
  );
}

/** Every provider's tightest window, one block each. A block opens its page; its pin keeps it on Pinned. */
function SummaryPage({
  pools,
  now,
  onOpen,
  pinned,
  onTogglePin,
}: {
  readonly pools: readonly LimitPool[];
  readonly now: number;
  readonly onOpen: (driver: string) => void;
  readonly pinned: readonly string[];
  readonly onTogglePin: ((driver: string) => void) | null;
}) {
  const items = pools.flatMap((pool) => {
    const driver = String(pool.driver);
    const label = providerLabel(pool);
    if (pool.accounts.length <= 1) {
      const window = tightestWindow(pool);
      if (!window) return [];
      return [{ key: driver, driver, label, pool, window, showPin: true }];
    }
    return pool.accounts.flatMap((account, idx) => {
      const subPool = collectLimitPools([account], now)[0];
      const window = subPool ? tightestWindow(subPool) : null;
      if (!window || !subPool) return [];
      const accountLabel = limitAccountName(account, label);
      return [
        {
          key: `${driver}:${account.ordinal}`,
          driver,
          label: accountLabel,
          pool: subPool,
          window,
          showPin: idx === 0,
        },
      ];
    });
  });

  return (
    <div className="divide-y divide-border/50">
      {items.map(({ key, driver, label, pool, window, showPin }) => {
        const refill = refillText(window, now);
        return (
          <div key={key} className="relative py-3 first:pt-0 last:pb-0">
            {/* A div, not a button: the global control radius would round the whole block. */}
            <div
              role="link"
              tabIndex={0}
              onClick={() => onOpen(driver)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(driver);
                }
              }}
              className="block cursor-pointer space-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-2 pe-7">
                <ProviderMark pool={pool} size="xs" />
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {label}
                </span>
                <span className="ms-auto">
                  <Figure percent={window.remainingPercent} className="text-base" />
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 pe-7 text-[11px] text-muted-foreground">
                <span className="min-w-0 truncate">{window.label}</span>
                {refill ? <span className="shrink-0 tabular-nums">{refill}</span> : null}
              </div>
              <DotMeter
                percent={window.remainingPercent}
                color={barColor(pool.driver)}
                label={`${label} ${window.label}: ${window.remainingPercent}% left`}
              />
            </div>
            {onTogglePin && showPin ? (
              <div className="absolute end-0 top-3">
                <PinButton
                  label={providerLabel(pool)}
                  pinned={pinned.includes(driver)}
                  onToggle={() => onTogglePin(driver)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** One provider with every window it reports, plus its pin. When a provider has multiple accounts, both are stacked. */
function ProviderSection({
  pool,
  now,
  pinned,
  onTogglePin,
}: {
  readonly pool: LimitPool;
  readonly now: number;
  readonly pinned: boolean;
  readonly onTogglePin: (() => void) | null;
}) {
  const color = barColor(pool.driver);
  const label = providerLabel(pool);
  const hasMultipleAccounts = pool.accounts.length > 1;

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <ProviderMark pool={pool} size="sm" />
        {label}
        {onTogglePin ? (
          <span className="ms-auto">
            <PinButton label={label} pinned={pinned} onToggle={onTogglePin} />
          </span>
        ) : null}
      </h3>
      {!hasMultipleAccounts ? (
        <div className="divide-y divide-border/50">
          {pool.windows.map((window) => {
            const refill = refillText(window, now);
            return (
              <div
                key={`${window.kind}:${window.id}`}
                className="space-y-1 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {window.label}
                  </span>
                  <Figure percent={window.remainingPercent} className="text-xl" />
                </div>
                <DotMeter
                  large
                  percent={window.remainingPercent}
                  color={color}
                  label={`${label} ${window.label}: ${window.remainingPercent}% left`}
                />
                {refill ? (
                  <p className="text-[10px] text-muted-foreground tabular-nums">{refill}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {pool.accounts.map((account, index) => {
            const subPool = collectLimitPools([account], now)[0] ?? pool;
            const accountLabel = limitAccountName(account, label);
            return (
              <div
                key={account.key}
                className={cn("space-y-2", index > 0 && "border-t border-border/50 pt-3")}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground/90">{accountLabel}</span>
                  {account.email ? (
                    <span className="max-w-[140px] truncate text-[10px] text-muted-foreground">
                      {account.email}
                    </span>
                  ) : null}
                </div>
                <div className="divide-y divide-border/50">
                  {subPool.windows.map((window) => {
                    const refill = refillText(window, now);
                    return (
                      <div
                        key={`${window.kind}:${window.id}`}
                        className="space-y-1 py-2 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                            {window.label}
                          </span>
                          <Figure percent={window.remainingPercent} className="text-xl" />
                        </div>
                        <DotMeter
                          large
                          percent={window.remainingPercent}
                          color={color}
                          label={`${accountLabel} ${window.label}: ${window.remainingPercent}% left`}
                        />
                        {refill ? (
                          <p className="text-[10px] text-muted-foreground tabular-nums">{refill}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type PageKind = "pinned" | "summary" | "provider";

interface Page {
  readonly id: string;
  readonly kind: PageKind;
  /** The provider for a provider page. */
  readonly pool: LimitPool | null;
}

function pageName(page: Page): string {
  if (page.pool) return providerLabel(page.pool);
  return page.kind === "pinned" ? "Pinned" : "Summary";
}

/**
 * The limits for the workspace card, one page per view. Pinned (when anything
 * is pinned) shows every pinned provider in full and opens first; Summary shows
 * each provider's tightest window; then a page per provider. Swipe sideways or
 * use the strip, whose pill follows the swipe. The card is as tall as the page
 * showing, up to the room left on screen, and only then scrolls.
 */
export function UsageLimitsCompact({
  presentations,
  now,
  pinnedDrivers = [],
  onTogglePinned,
}: {
  readonly presentations: Parameters<typeof collectLimitAccounts>[0];
  readonly now: number;
  readonly pinnedDrivers?: readonly string[] | undefined;
  readonly onTogglePinned?: ((driver: string) => void) | undefined;
}) {
  const pools = collectLimitPools(collectLimitAccounts(presentations), now);
  const notices = collectLimitNotices(presentations);
  const pinnedPools = pools.filter((pool) => pinnedDrivers.includes(String(pool.driver)));
  const pinned = pinnedPools.map((pool) => String(pool.driver));
  const hasPinned = pinnedPools.length > 0;
  const providerPages: Page[] = pools.map((pool) => ({
    id: String(pool.driver),
    kind: "provider",
    pool,
  }));
  const pages: Page[] =
    pools.length > 1
      ? [
          ...(hasPinned ? [{ id: "pinned", kind: "pinned" as const, pool: null }] : []),
          { id: SUMMARY, kind: "summary" as const, pool: null },
          ...providerPages,
        ]
      : providerPages;

  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const tabs = useRef<HTMLDivElement | null>(null);
  const tabsHidden = useRef(false);
  const lastTop = useRef(0);
  const indicator = useRef<HTMLDivElement | null>(null);
  const tabList = useRef<HTMLDivElement | null>(null);
  const contents = useRef<Array<HTMLDivElement | null>>([]);
  const fitted = useRef(false);

  const setTabsHidden = useCallback((hidden: boolean) => {
    const node = tabs.current;
    if (!node || tabsHidden.current === hidden) return;
    tabsHidden.current = hidden;
    gsap.to(node, {
      height: hidden ? 0 : "auto",
      opacity: hidden ? 0 : 1,
      duration: prefersReducedMotion() ? 0 : 0.16,
      ease: "power1.out",
      overwrite: true,
    });
  }, []);

  useEffect(() => {
    const node = tabs.current;
    return () => {
      if (node) gsap.killTweensOf(node);
    };
  }, []);

  // The Pinned page appearing or going away shifts every index: keep the same page in view.
  const hadPinned = useRef(hasPinned);
  useLayoutEffect(() => {
    if (hadPinned.current === hasPinned) return;
    hadPinned.current = hasPinned;
    const node = scroller.current;
    if (!node) return;
    const shift = hasPinned ? 1 : -1;
    node.scrollLeft = Math.max(0, node.scrollLeft + shift * node.clientWidth);
    setActive((old) => Math.max(0, old + shift));
  }, [hasPinned]);

  // A hidden pane (another card tab) loses its sideways scroll; restore the page when it is shown again.
  const activeRef = useRef(active);
  activeRef.current = active;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      if (width > 0) node.scrollLeft = activeRef.current * width;
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [pages.length]);

  // Many providers overflow the strip: keep the active chip centred as pages change.
  useEffect(() => {
    const list = tabList.current;
    if (!list) return;
    list.scrollTo({
      left: active * CHIP_WIDTH + 2 + CHIP_WIDTH / 2 - list.clientWidth / 2,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [active]);

  // The card is as tall as the page showing, up to a maximum. Past the maximum that page
  // scrolls; under it there is nothing to scroll, so scrolling is switched off outright.
  useLayoutEffect(() => {
    const node = scroller.current;
    const content = contents.current[active];
    const page = content?.parentElement;
    if (!node || !content || !page) return;
    const fit = () => {
      const max = Math.min(MAX_HEIGHT, window.innerHeight * MAX_VIEWPORT_SHARE);
      const natural = Math.ceil(content.offsetHeight);
      const scrolls = natural > max;
      page.style.overflowY = scrolls ? "auto" : "hidden";
      gsap.to(node, {
        height: scrolls ? max : natural,
        duration: fitted.current && !prefersReducedMotion() ? 0.16 : 0,
        ease: "power1.out",
        overwrite: true,
      });
      fitted.current = true;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [active, pages.length]);

  const goTo = useCallback(
    (index: number) => {
      const node = scroller.current;
      if (!node || index < 0) return;
      setTabsHidden(false);
      node.scrollTo({
        left: index * node.clientWidth,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    },
    [setTabsHidden],
  );

  const onScroll = () => {
    const node = scroller.current;
    if (!node || node.clientWidth === 0) return;
    // The pill follows the finger: position is the fractional page, not the settled one.
    if (indicator.current) {
      indicator.current.style.transform = `translateX(${(node.scrollLeft / node.clientWidth) * CHIP_WIDTH}px)`;
    }
    const next = Math.round(node.scrollLeft / node.clientWidth);
    if (next === active) return;
    setActive(next);
    setTabsHidden(false);
  };

  const onPageScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    const delta = top - lastTop.current;
    lastTop.current = top;
    if (top <= 4 || delta < -6) setTabsHidden(false);
    else if (delta > 6) setTabsHidden(true);
  };

  if (pools.length === 0) {
    return (
      <div className="min-w-0 space-y-4">
        <p className="text-[11px] text-muted-foreground">
          No provider reports subscription limits yet.
        </p>
        <LimitNotices notices={notices} />
      </div>
    );
  }

  const toggle = (driver: string) => onTogglePinned?.(driver);

  return (
    <div className="min-w-0">
      {pages.length > 1 ? (
        <div ref={tabs} className="overflow-hidden">
          <div
            ref={tabList}
            className="mb-3 overflow-x-auto rounded-full bg-muted/50 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div
              role="tablist"
              aria-label="Usage pages"
              className="relative mx-auto flex w-max p-0.5"
            >
              <div aria-hidden className="pointer-events-none absolute inset-y-0.5 left-0.5">
                <div ref={indicator} className="h-full w-9 rounded-full bg-foreground/10" />
              </div>
              {pages.map((page, index) => {
                const name = pageName(page);
                return (
                  <button
                    key={page.id}
                    type="button"
                    role="tab"
                    title={name}
                    aria-label={name}
                    aria-selected={active === index}
                    onClick={() => goTo(index)}
                    className={cn(
                      "relative flex h-7 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      active === index
                        ? "text-foreground"
                        : "text-muted-foreground opacity-70 hover:opacity-100",
                    )}
                  >
                    {page.pool ? (
                      <ProviderMark pool={page.pool} size="xs" />
                    ) : page.kind === "pinned" ? (
                      <PinIcon className="size-3.5 fill-current" aria-hidden />
                    ) : (
                      <GaugeIcon className="size-3.5" aria-hidden />
                    )}
                    {page.pool && pinned.includes(page.id) ? (
                      <PinIcon
                        className="absolute top-1 right-1.5 size-2 fill-current"
                        aria-hidden
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((page, index) => (
          <div
            key={page.id}
            aria-hidden={active !== index}
            onScroll={onPageScroll}
            className="h-full w-full shrink-0 snap-start overflow-y-hidden overscroll-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div
              ref={(node) => {
                contents.current[index] = node;
              }}
              className="pb-1"
            >
              {page.kind === "summary" ? (
                <SummaryPage
                  pools={pools}
                  now={now}
                  pinned={pinned}
                  onTogglePin={onTogglePinned ? toggle : null}
                  onOpen={(driver) => goTo(pages.findIndex((p) => p.id === driver))}
                />
              ) : page.kind === "pinned" ? (
                <div className="space-y-5">
                  {pinnedPools.map((pool) => (
                    <ProviderSection
                      key={pool.driver}
                      pool={pool}
                      now={now}
                      pinned
                      onTogglePin={onTogglePinned ? () => toggle(String(pool.driver)) : null}
                    />
                  ))}
                </div>
              ) : page.pool ? (
                <ProviderSection
                  pool={page.pool}
                  now={now}
                  pinned={pinned.includes(page.id)}
                  onTogglePin={onTogglePinned ? () => toggle(page.id) : null}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {notices.length > 0 ? (
        <div className="pt-3">
          <LimitNotices notices={notices} />
        </div>
      ) : null}
    </div>
  );
}
