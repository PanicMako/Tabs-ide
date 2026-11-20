import "./usage.css";
import { useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { EnvironmentId, ServerProvider, ServerProviderUsageWindow } from "@tabs/contracts";
import {
  collectLimitAccounts,
  collectLimitNotices,
  compareRunways,
  formatDuration,
  limitAccountName,
  windowRunway,
  type LimitAccount,
  type WindowRunway,
} from "@tabs/shared/usageLimits";
import { GaugeIcon } from "lucide-react";
import { useServerConfig } from "../../../state/settings";
import { useSettings } from "../../../hooks/useSettings";
import { formatUpcomingTimestamp } from "../../../timestampFormat";
import { useSurfaceMotionSettings } from "../../../panelAnimations";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ResetCredits, UsageLimitsSection, barColor } from "../../usage/UsageLimits";
import { PROVIDER_PRESENTATION } from "../../usage/usageProviders";
import { UsageProviderSettings } from "../UsageProviderSettings";
import { morphTarget, useInlineMorph } from "./useUsageMorph";

const TIMELINE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RunwayRow {
  readonly account: LimitAccount;
  readonly window: ServerProviderUsageWindow;
  readonly runway: WindowRunway;
}

function driverPresentation(driver: ServerProvider["driver"]) {
  const kind =
    driver === "claudeAgent"
      ? "claude"
      : (driver as keyof typeof PROVIDER_PRESENTATION) in PROVIDER_PRESENTATION
        ? (driver as keyof typeof PROVIDER_PRESENTATION)
        : null;
  return kind ? PROVIDER_PRESENTATION[kind] : null;
}

function accountLabel(account: LimitAccount): string {
  return limitAccountName(
    account,
    driverPresentation(account.driver)?.label ?? String(account.driver),
  );
}

/** The runway as a sentence: what happens if work carries on like this. */
export function runwaySentence(runway: WindowRunway): string {
  const resetsIn = runway.resetsInMs === null ? null : formatDuration(runway.resetsInMs);
  switch (runway.verdict) {
    case "exhausted":
      return resetsIn ? `Out of quota · back in ${resetsIn}` : "Out of quota";
    case "runsOut": {
      const dryIn = formatDuration(runway.runsOutInMs ?? 0);
      const early =
        runway.resetsInMs !== null && runway.runsOutInMs !== null
          ? formatDuration(runway.resetsInMs - runway.runsOutInMs)
          : null;
      return early
        ? `At this pace, runs out in ${dryIn}, ${early} before reset`
        : `At this pace, runs out in ${dryIn}`;
    }
    case "tight":
      return `Cutting it close · about ${runway.projectedLeftPercent}% left at reset`;
    case "spare":
      return runway.projectedLeftPercent === 100
        ? "Untouched this window"
        : `On track · about ${runway.projectedLeftPercent}% to spare at reset`;
    case "early":
      return "Window just opened · too early to project";
    case "unknown":
      return `${runway.remainingPercent}% left`;
  }
}

export function LimitsTab() {
  const serverConfig = useServerConfig();
  // Countdowns anchor to the latest config instead of ticking every second.
  const now = useMemo(() => Date.now(), [serverConfig]);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const motion = useSurfaceMotionSettings();
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const presentations = useMemo(
    () =>
      new Map([
        ["local" as EnvironmentId, { entry: { target: { label: "Local" } }, serverConfig }],
      ]),
    [serverConfig],
  );
  const accounts = useMemo(() => collectLimitAccounts(presentations), [presentations]);
  const notices = useMemo(() => collectLimitNotices(presentations), [presentations]);
  const rows = useMemo<RunwayRow[]>(
    () =>
      accounts.flatMap((account) =>
        account.limits.windows.map((window) => ({
          account,
          window,
          runway: windowRunway(window, now),
        })),
      ),
    [accounts, now],
  );
  const ordered = useMemo(
    () =>
      accounts
        .map((account) => ({
          account,
          rows: rows
            .filter((row) => row.account.key === account.key)
            .toSorted((a, b) => compareRunways(a.runway, b.runway)),
        }))
        .toSorted((a, b) =>
          a.rows[0] && b.rows[0] ? compareRunways(a.rows[0].runway, b.rows[0].runway) : 0,
        ),
    [accounts, rows],
  );
  const tightest = ordered[0]?.rows[0];
  const attention = rows.filter(
    (row) => row.runway.verdict === "exhausted" || row.runway.verdict === "runsOut",
  ).length;

  const jumpTo = (accountKey: string) => {
    const node = sectionsRef.current?.querySelector<HTMLElement>(
      `[data-account="${CSS.escape(accountKey)}"]`,
    );
    if (!node) return;
    node.scrollIntoView({ block: "nearest", behavior: motion.active ? "smooth" : "auto" });
    if (!motion.active) return;
    gsap.fromTo(
      node,
      { backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
      {
        backgroundColor: "transparent",
        duration: motion.seconds(0.9),
        ease: motion.profile.ease,
        clearProps: "backgroundColor",
      },
    );
  };

  return (
    <div className="usage-runway">
      {tightest ? (
        <section className="usage-hero" aria-label="Limits overview">
          <div className="usage-hero-lead">
            <span className="usage-caption">
              {attention > 0
                ? `${attention} ${attention === 1 ? "window needs" : "windows need"} attention`
                : "Most urgent window"}
            </span>
            <strong className="usage-hero-figure">
              {tightest.runway.remainingPercent}
              <span>% left</span>
            </strong>
            <p className="usage-hero-sub">
              {accountLabel(tightest.account)} · {tightest.window.label} —{" "}
              {runwaySentence(tightest.runway)}
            </p>
          </div>
          <dl className="usage-hero-facts">
            <div>
              <dt>Accounts</dt>
              <dd>{accounts.length}</dd>
            </div>
            <div>
              <dt>Windows tracked</dt>
              <dd>{rows.length}</dd>
            </div>
            <div>
              <dt>On track</dt>
              <dd>
                {rows.filter((row) => row.runway.verdict === "spare").length} / {rows.length}
              </dd>
            </div>
          </dl>
        </section>
      ) : (
        <div className="usage-empty">
          <GaugeIcon className="size-5" aria-hidden />
          <h3>No plan limits reported yet</h3>
          <p>
            Signed-in Codex, Claude, Cursor and Antigravity accounts report here. Missing data does
            not mean unlimited usage.
          </p>
        </div>
      )}

      {rows.length > 0 ? (
        <ResetTimeline
          rows={rows}
          now={now}
          hoverKey={hoverKey}
          onHover={setHoverKey}
          onJump={jumpTo}
        />
      ) : null}

      <div ref={sectionsRef} className="usage-accounts">
        {ordered.map(({ account, rows: accountRows }) => (
          <AccountRunway
            key={account.key}
            account={account}
            rows={accountRows}
            now={now}
            highlighted={hoverKey === account.key}
          />
        ))}
      </div>

      {notices.length > 0 ? (
        <ul className="usage-notices" aria-label="Providers without limits">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}

      <details className="usage-fold">
        <summary>
          Pooled view <span>Every account per provider, side by side</span>
        </summary>
        <div className="usage-fold-body">
          <UsageLimitsSection />
        </div>
      </details>
      <details className="usage-fold">
        <summary>
          Usage connections <span>Add a quota hub or another account</span>
        </summary>
        <div className="usage-fold-body">
          <UsageProviderSettings />
        </div>
      </details>
    </div>
  );
}

/**
 * The week ahead as one line: every window's reset sits where it lands, so
 * "when do I get quota back" reads at a glance. Later resets park at the edge.
 */
function ResetTimeline({
  rows,
  now,
  hoverKey,
  onHover,
  onJump,
}: {
  readonly rows: readonly RunwayRow[];
  readonly now: number;
  readonly hoverKey: string | null;
  readonly onHover: (accountKey: string | null) => void;
  readonly onJump: (accountKey: string) => void;
}) {
  const timestampFormat = useSettings((settings) => settings.timestampFormat);
  const span = TIMELINE_DAYS * DAY_MS;
  const marks = rows
    .filter((row) => row.runway.resetsInMs !== null)
    .map((row) => ({ ...row, at: Math.min(1, (row.runway.resetsInMs ?? 0) / span) }))
    .toSorted((a, b) => a.at - b.at);
  if (marks.length === 0) return null;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const ticks = Array.from({ length: TIMELINE_DAYS + 1 }, (_, day) => {
    const at = startOfToday.getTime() + day * DAY_MS;
    return {
      at: (at - now) / span,
      label: day === 0 ? "Today" : new Date(at).toLocaleDateString(undefined, { weekday: "short" }),
    };
  }).filter((tick) => tick.at >= -0.001 || tick.label === "Today");

  return (
    <section className="usage-timeline" aria-label="Upcoming resets">
      <div className="usage-section-head">
        <h3>Quota coming back</h3>
        <span className="usage-caption">Next {TIMELINE_DAYS} days</span>
      </div>
      <div className="usage-timeline-track" onPointerLeave={() => onHover(null)}>
        <div className="usage-timeline-rule" aria-hidden />
        {ticks.map((tick) => (
          <span
            key={tick.label + tick.at}
            className="usage-timeline-tick"
            style={{ left: `${Math.max(0, tick.at) * 100}%` }}
            aria-hidden
          >
            {tick.label}
          </span>
        ))}
        {marks.map((mark, index) => {
          const presentation = driverPresentation(mark.account.driver);
          const Mark = presentation?.mark;
          const resetsAt = mark.window.resetsAt
            ? formatUpcomingTimestamp(mark.window.resetsAt, timestampFormat, now)
            : "";
          return (
            <Tooltip key={`${mark.account.key}:${mark.window.id}`}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="usage-timeline-mark"
                    style={{ left: `${mark.at * 100}%`, top: `${(index % 3) * 22}px` }}
                    data-dim={hoverKey && hoverKey !== mark.account.key ? "" : undefined}
                    data-later={mark.at >= 1 ? "" : undefined}
                    onPointerEnter={() => onHover(mark.account.key)}
                    onFocus={() => onHover(mark.account.key)}
                    onBlur={() => onHover(null)}
                    onClick={() => onJump(mark.account.key)}
                    aria-label={`${accountLabel(mark.account)} ${mark.window.label} resets ${resetsAt}`}
                  />
                }
              >
                {Mark ? <Mark className="size-3" aria-hidden /> : null}
                <span>{mark.window.label}</span>
              </TooltipTrigger>
              <TooltipPopup side="top" className="text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground">
                    {accountLabel(mark.account)} · {mark.window.label}
                  </span>
                  <span className="text-muted-foreground">
                    Resets {resetsAt} · gives back {100 - mark.runway.remainingPercent}%
                  </span>
                </div>
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </section>
  );
}

function AccountRunway({
  account,
  rows,
  now,
  highlighted,
}: {
  readonly account: LimitAccount;
  readonly rows: readonly RunwayRow[];
  readonly now: number;
  readonly highlighted: boolean;
}) {
  const presentation = driverPresentation(account.driver);
  const Mark = presentation?.mark;
  const color = barColor(account.driver);
  const checkedAgo = formatDuration(now - Date.parse(account.limits.checkedAt));
  const where = account.sourceLabel ?? account.environments.map((env) => env.label).join(", ");
  const listRef = useRef<HTMLUListElement>(null);
  useInlineMorph(listRef, ".usage-runway-fill, .usage-runway-burn", "width", [rows]);
  useInlineMorph(listRef, ".usage-runway-burn", "left", [rows], { fromZero: false });
  return (
    <section
      className="usage-account"
      data-account={account.key}
      data-highlighted={highlighted ? "" : undefined}
      aria-label={accountLabel(account)}
    >
      <header className="usage-account-head">
        {Mark ? <Mark className="size-4" aria-hidden /> : null}
        <h3>{accountLabel(account)}</h3>
        {account.plan ? <span className="usage-tag">{account.plan}</span> : null}
        <span className="usage-caption usage-account-meta">
          {[account.email, where && where !== "Local" ? where : null, `checked ${checkedAgo} ago`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </header>
      <ul ref={listRef} className="usage-windows">
        {rows.map((row) => (
          <li key={row.window.id} data-verdict={row.runway.verdict}>
            <span className="usage-window-label">{row.window.label}</span>
            <RunwayBar row={row} color={color} now={now} />
            <span className="usage-window-left">{row.runway.remainingPercent}%</span>
            <span className="usage-window-verdict">{runwaySentence(row.runway)}</span>
          </li>
        ))}
      </ul>
      {account.redeem && account.limits.resetCredits ? (
        <ResetCredits
          environmentId={account.redeem.environmentId}
          input={account.redeem.input}
          credits={account.limits.resetCredits}
          now={now}
        />
      ) : null}
    </section>
  );
}

/**
 * Quota left as a fill. The hairline is where even spending would be; the
 * hatched run is what the current pace will spend before reset.
 */
function RunwayBar({
  row,
  color,
  now,
}: {
  readonly row: RunwayRow;
  readonly color: string;
  readonly now: number;
}) {
  const timestampFormat = useSettings((settings) => settings.timestampFormat);
  const { runway, window } = row;
  const left = runway.remainingPercent;
  const projected = runway.projectedLeftPercent;
  const timeLeft =
    runway.resetsInMs !== null && window.windowDurationMins
      ? Math.min(100, (runway.resetsInMs / (window.windowDurationMins * 60_000)) * 100)
      : null;
  const resetsAt = window.resetsAt
    ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)
    : null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="usage-runway-bar"
            role="img"
            tabIndex={0}
            aria-label={`${window.label}: ${left}% left. ${runwaySentence(runway)}`}
          />
        }
      >
        <i
          className="usage-runway-fill"
          data-key={`fill:${window.id}`}
          {...morphTarget("width", `${left}%`)}
          style={{ width: `${left}%`, background: color }}
        />
        {projected !== null && projected < left ? (
          <i
            className="usage-runway-burn"
            data-key={`burn:${window.id}`}
            {...morphTarget("left", `${projected}%`)}
            {...morphTarget("width", `${left - projected}%`)}
            style={{ left: `${projected}%`, width: `${left - projected}%` }}
          />
        ) : null}
        {timeLeft !== null ? (
          <i className="usage-runway-pace" style={{ left: `${timeLeft}%` }} />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-72 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">
            {left}% left{timeLeft !== null ? ` · ${Math.round(timeLeft)}% of the window to go` : ""}
          </span>
          <span className="text-muted-foreground">
            The line marks even spending; the hatching is what this pace uses before reset.
          </span>
          {resetsAt ? <span className="text-muted-foreground">Resets {resetsAt}</span> : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
