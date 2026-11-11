import { useMemo, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { projectsAtom, threadsAtom } from "../../state/threads";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import { Switch } from "../ui/switch";
import { SegmentedControl } from "../ui/segmented-control";
import { UsageLimitsSection } from "../usage/UsageLimits";
import { deriveAwaySummary, deriveInbox, type InboxItem } from "./glanceLogic";
import type { GlanceId, QuickActionId } from "./actions";

const TITLES: Record<GlanceId, string> = {
  usage: "Usage & limits",
  inbox: "Waiting for you",
  away: "While you were away",
  toggles: "Quick toggles",
};

/** Where "Open full page" goes, when the glance has one. */
const FULL_PAGE: Partial<Record<GlanceId, QuickActionId>> = { usage: "usage" };

export interface QuickGlanceProps {
  readonly glance: GlanceId;
  /** When the away summary counts from, in epoch ms. */
  readonly awaySince: number;
  readonly onBack: () => void;
  readonly onClose: () => void;
  /** Runs a launcher action directly (never opens another glance). */
  readonly run: (id: QuickActionId, query: string) => Promise<void>;
}

/**
 * A quick look inside the launcher: what you came to check, without leaving
 * your place. The full pages stay one click away.
 */
export function QuickGlance(props: QuickGlanceProps) {
  const fullPage = FULL_PAGE[props.glance];
  const go = (id: QuickActionId, query = "") =>
    void props.run(id, query).then(props.onClose, () => undefined);
  return (
    <section
      className="qa-glance flex w-[min(30rem,calc(100vw-2rem))] max-h-[min(34rem,calc(100dvh-4rem))] flex-col overflow-hidden rounded-[22px] border border-border/70 bg-popover text-popover-foreground shadow-2xl"
      aria-label={TITLES[props.glance]}
      data-testid="quick-glance"
    >
      <header className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <button
          type="button"
          onClick={props.onBack}
          aria-label="Back to quick actions"
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{TITLES[props.glance]}</h2>
        {fullPage ? (
          <button
            type="button"
            onClick={() => go(fullPage)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Open full page <ArrowUpRightIcon className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {props.glance === "usage" ? (
          <UsageLimitsSection />
        ) : props.glance === "inbox" ? (
          <InboxGlance onOpen={(item) => go("open-thread", threadKey(item))} />
        ) : props.glance === "away" ? (
          <AwayGlance
            since={props.awaySince}
            onOpen={(environmentId, threadId) =>
              go("open-thread", `${environmentId ?? ""}:${threadId}`)
            }
          />
        ) : (
          <TogglesGlance />
        )}
      </div>
    </section>
  );
}

function threadKey(item: Pick<InboxItem, "environmentId" | "threadId">): string {
  return `${item.environmentId ?? ""}:${item.threadId}`;
}

function useProjectNames(): ReadonlyMap<string, string> {
  const projects = useAtomValue(projectsAtom);
  return useMemo(
    () => new Map(projects.map((project) => [project.id as string, project.name])),
    [projects],
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function InboxGlance({ onOpen }: { onOpen: (item: InboxItem) => void }) {
  const threads = useAtomValue(threadsAtom);
  const names = useProjectNames();
  const items = useMemo(() => deriveInbox(threads, names), [threads, names]);
  if (items.length === 0)
    return <Empty>Nothing is waiting for you. Agents are on their own.</Empty>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, index) => {
        const Icon = item.kind === "question" ? MessageCircleQuestionIcon : ShieldQuestionIcon;
        return (
          <li key={`${item.threadId}:${item.kind}:${index}`}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex w-full items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-left hover:border-border hover:bg-accent/50"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs text-muted-foreground">
                  {item.projectName} · {item.threadTitle}
                </span>
                <span className="line-clamp-2 text-sm">{item.summary}</span>
              </span>
              <span className="ml-auto shrink-0 self-center text-[11px] text-muted-foreground">
                {item.kind === "question" ? "Answer" : "Review"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AwayGlance({
  since,
  onOpen,
}: {
  since: number;
  onOpen: (environmentId: string | undefined, threadId: string) => void;
}) {
  const threads = useAtomValue(threadsAtom);
  const names = useProjectNames();
  const projects = useMemo(() => deriveAwaySummary(threads, names, since), [threads, names, since]);
  if (projects.length === 0) return <Empty>Nothing new since you last looked.</Empty>;
  const sinceLabel = new Date(since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-xs text-muted-foreground">Since {sinceLabel}</p>
      {projects.map((project) => (
        <article
          key={project.projectId}
          className="rounded-xl border border-border/60 bg-card/50 px-3 py-2"
        >
          <h3 className="text-sm font-medium">{project.projectName}</h3>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {project.finished.length ? (
              <Stat icon={<CircleCheckIcon className="size-3.5 text-emerald-500" />}>
                {project.finished.length} finished
              </Stat>
            ) : null}
            {project.waiting ? (
              <Stat icon={<MessageCircleQuestionIcon className="size-3.5 text-amber-500" />}>
                {project.waiting} waiting for you
              </Stat>
            ) : null}
            {project.failed.length ? (
              <Stat icon={<CircleAlertIcon className="size-3.5 text-destructive" />}>
                {project.failed.length} stopped or failed
              </Stat>
            ) : null}
            {project.running.length ? (
              <Stat icon={<LoaderCircleIcon className="size-3.5" />}>
                {project.running.length} still running
              </Stat>
            ) : null}
          </div>
          <ul className="mt-1.5 flex flex-col">
            {[...project.failed, ...project.finished].slice(0, 4).map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => onOpen(thread.environmentId, thread.id)}
                  className="w-full truncate rounded-md px-1 py-0.5 text-left text-xs hover:bg-accent"
                >
                  {thread.title || "Untitled conversation"}
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function Stat({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {icon}
      {children}
    </span>
  );
}

const SETTING_TOGGLES = [
  {
    key: "inAppNotificationsEnabled",
    label: "In-app notifications",
    hint: "Banners inside Tabs when agents finish or need you",
  },
  {
    key: "planModeEnabled",
    label: "Build/Plan switch",
    hint: "Show the legacy Build/Plan toggle in the composer",
  },
  {
    key: "contextWindowMeterEnabled",
    label: "Context window meter",
    hint: "Show how full the conversation's context is",
  },
  { key: "wordWrap", label: "Editor word wrap", hint: "Wrap long lines in the code editor" },
  {
    key: "confirmTabClose",
    label: "Confirm closing tabs",
    hint: "Ask before closing a project tab",
  },
] as const;

function TogglesGlance() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { theme, resolvedTheme, setTheme } = useTheme();
  // Palettes are named ("tabs-light", "dracula"…); the toggle shows their mode.
  const appearance: "system" | "light" | "dark" =
    theme === "system" ? "system" : resolvedTheme === "light" ? "light" : "dark";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5">
        <span className="text-sm">Appearance</span>
        <SegmentedControl
          size="sm"
          orbitKind="theme"
          aria-label="Appearance"
          value={appearance}
          onValueChange={(next) => setTheme(next)}
          options={[
            { value: "system", label: "Auto" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      {SETTING_TOGGLES.map((toggle) => {
        const checked = Boolean((settings as Record<string, unknown>)[toggle.key]);
        return (
          <label
            key={toggle.key}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-1.5 hover:bg-accent/40",
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm">{toggle.label}</span>
              <span className="truncate text-xs text-muted-foreground">{toggle.hint}</span>
            </span>
            <Switch
              aria-label={toggle.label}
              checked={checked}
              onCheckedChange={(next) => void updateSettings({ [toggle.key]: next })}
            />
          </label>
        );
      })}
    </div>
  );
}
