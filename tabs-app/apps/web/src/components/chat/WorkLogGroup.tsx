import {
  BotIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EllipsisIcon,
  EyeIcon,
  GlobeIcon,
  InfoIcon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";
import { memo, useState } from "react";

import type { WorkLogEntry } from "../../session-logic";
import { cn } from "~/lib/utils";
import { AnimatedHeight } from "../AnimatedHeight";
import { MessageCopyButton } from "./MessageCopyButton";
import { normalizeCompactToolLabel } from "./MessagesTimeline.logic";
import {
  splitDisplayPath,
  summarizeWorkSteps,
  workStepKind,
  type WorkStepKind,
} from "./workLogPresentation";

const VISIBLE_STEPS = 6;
const VISIBLE_FILES = 4;

const STEP_STYLE: Record<WorkStepKind, { readonly icon: LucideIcon; readonly tile: string }> = {
  command: { icon: TerminalIcon, tile: "bg-foreground/[0.06] text-foreground/70" },
  edit: { icon: SquarePenIcon, tile: "bg-foreground/[0.06] text-foreground/70" },
  read: { icon: EyeIcon, tile: "bg-foreground/[0.04] text-muted-foreground" },
  search: { icon: GlobeIcon, tile: "bg-foreground/[0.06] text-foreground/70" },
  tool: { icon: WrenchIcon, tile: "bg-foreground/[0.06] text-foreground/70" },
  agent: { icon: UsersIcon, tile: "bg-foreground/[0.06] text-foreground/70" },
  thinking: { icon: BotIcon, tile: "bg-foreground/[0.04] text-muted-foreground" },
  error: { icon: CircleAlertIcon, tile: "bg-destructive/10 text-destructive" },
  info: { icon: InfoIcon, tile: "bg-foreground/[0.04] text-muted-foreground" },
};

/** What a running step is doing, in Tabs' own voice rather than a bare "In progress". */
const ACTIVE_LABEL: Record<WorkStepKind, string> = {
  command: "Running",
  edit: "Scribbling",
  read: "Reading",
  search: "Hunting",
  tool: "Tinkering",
  agent: "Delegating",
  thinking: "Thinking",
  error: "In progress",
  info: "In progress",
};

/** Three quiet dots that take turns; they stand still for people who prefer less motion. */
function WorkingDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="size-[3px] rounded-full bg-current opacity-30 animate-pulse motion-reduce:animate-none"
          style={{ animationDelay: `${dot * 180}ms` }}
        />
      ))}
    </span>
  );
}

function capitalize(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}` : value;
}

export function workStepTitle(entry: Pick<WorkLogEntry, "label" | "toolTitle">): string {
  return capitalize(normalizeCompactToolLabel(entry.toolTitle ?? entry.label));
}

function stepDetail(entry: WorkLogEntry): string | null {
  if (entry.command) return entry.command;
  if (entry.detail) return entry.detail;
  return null;
}

/** Why a failed step failed. Shown on its own line because the inline detail is the command. */
function stepFailure(entry: WorkLogEntry): string | null {
  if (entry.tone !== "error") return null;
  const reason = entry.detail?.trim();
  if (!reason || reason === entry.command) return null;
  return reason;
}

const WorkStep = memo(function WorkStep(props: {
  readonly entry: WorkLogEntry;
  readonly active: boolean;
}) {
  const { entry, active } = props;
  const kind = workStepKind(entry);
  const { icon: Icon, tile } = STEP_STYLE[kind];
  const title = workStepTitle(entry);
  const detail = stepDetail(entry);
  const failure = stepFailure(entry);
  const [failureOpen, setFailureOpen] = useState(false);
  const files = entry.changedFiles ?? [];
  const showFiles = files.length > 0;
  return (
    <li className="relative flex gap-3 py-1" data-step-kind={kind}>
      <span
        aria-hidden="true"
        className={cn(
          "relative z-10 mt-px flex size-[22px] shrink-0 items-center justify-center rounded-md ring-1 ring-inset ring-border/50",
          tile,
          active && "ring-primary/50",
        )}
      >
        <Icon className="size-3" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              "min-w-0 max-w-full break-words text-[12.5px] font-medium leading-[22px] text-foreground/85 [overflow-wrap:anywhere]",
              kind === "error" && "text-destructive",
            )}
          >
            {title}
          </span>
          {detail && !title.includes(detail.slice(0, 40)) && (
            <span
              className={cn(
                "min-w-0 truncate font-mono text-[11.5px] leading-[22px] text-muted-foreground/85",
                kind === "error" && "text-destructive/75",
              )}
              title={detail}
            >
              {detail}
            </span>
          )}
          {active && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11px] leading-[22px] text-muted-foreground">
              {ACTIVE_LABEL[kind]}
              <WorkingDots />
            </span>
          )}
        </div>
        {failure && (
          <button
            type="button"
            onClick={() => setFailureOpen((open) => !open)}
            aria-expanded={failureOpen}
            title={failureOpen ? "Show less" : "Show the whole error"}
            className={cn(
              "mt-0.5 block w-full cursor-pointer whitespace-pre-wrap break-words rounded-[var(--radius-tile)] text-left font-mono text-[11px] leading-4 text-destructive/80 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !failureOpen && "line-clamp-3",
            )}
          >
            {failure}
          </button>
        )}
        {showFiles && (
          <div className="mt-1 flex flex-wrap gap-1">
            {files.slice(0, VISIBLE_FILES).map((path) => {
              const { directory, name } = splitDisplayPath(path);
              return (
                <span
                  key={`${entry.id}:${path}`}
                  className="inline-flex max-w-72 items-center rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 font-mono text-[10.5px] leading-4"
                  title={path}
                >
                  <span className="truncate text-muted-foreground/70">{directory}</span>
                  <span className="shrink-0 text-foreground/75">{name}</span>
                </span>
              );
            })}
            {files.length > VISIBLE_FILES && (
              <span className="px-1 text-[10.5px] leading-5 text-muted-foreground/75">
                +{files.length - VISIBLE_FILES} more
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
});

/** One agent work burst: a plain-language summary over a rail of its steps. */
export const WorkLogGroup = memo(function WorkLogGroup(props: {
  readonly entries: ReadonlyArray<WorkLogEntry>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** True only for the latest group while the agent is still working. */
  readonly active: boolean;
}) {
  const { entries, expanded, onToggle, active } = props;
  const hidden = expanded ? 0 : Math.max(0, entries.length - VISIBLE_STEPS);
  const visible = hidden > 0 ? entries.slice(-VISIBLE_STEPS) : entries;
  const summary = summarizeWorkSteps(entries);
  const copyText = entries
    .map((entry) => {
      const detail = stepDetail(entry);
      return detail ? `${workStepTitle(entry)} — ${detail}` : workStepTitle(entry);
    })
    .join("\n");
  const canToggle = entries.length > VISIBLE_STEPS;

  return (
    <section
      data-work-log="true"
      className="group/work relative w-full overflow-hidden rounded-[var(--radius-joined)] border border-border/60 bg-card/40"
      aria-label={summary}
    >
      <div
        data-work-log-head="true"
        className="flex items-center gap-2 border-b border-border/50 px-3 py-2"
      >
        <button
          type="button"
          onClick={canToggle ? onToggle : undefined}
          aria-expanded={canToggle ? expanded : undefined}
          disabled={!canToggle}
          className="flex min-w-0 items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          {canToggle && (
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/75 transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
            />
          )}
          <span className="truncate text-xs font-medium text-foreground/70">{summary}</span>
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/75">
          {entries.length === 1 ? "1 step" : `${entries.length} steps`}
        </span>
        <span className="ml-auto opacity-0 transition-opacity duration-150 group-hover/work:opacity-100 group-focus-within/work:opacity-100">
          <MessageCopyButton text={copyText} variant="ghost" size="icon-xs" />
        </span>
      </div>
      <AnimatedHeight>
        <ol className="relative px-3 py-1.5">
          {/* The rail: one hairline behind every step tile. */}
          <span
            aria-hidden="true"
            className="absolute bottom-4 left-[22.5px] top-4 w-px bg-border"
          />
          {hidden > 0 && (
            <li className="relative flex gap-3 py-1">
              <span
                aria-hidden="true"
                className="relative z-10 flex size-[22px] shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-card text-muted-foreground/75"
              >
                <EllipsisIcon className="size-3" />
              </span>
              <button
                type="button"
                onClick={onToggle}
                className="rounded-md text-[12px] leading-[22px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Show {hidden} earlier {hidden === 1 ? "step" : "steps"}
              </button>
            </li>
          )}
          {visible.map((entry, index) => (
            <WorkStep
              key={`work-step:${entry.id}`}
              entry={entry}
              active={active && index === visible.length - 1 && entry.tone !== "error"}
            />
          ))}
        </ol>
      </AnimatedHeight>
    </section>
  );
});
