// Search past agent sessions (Claude Code, Codex, Gemini, OpenCode) from one keyboard-first list.
// The index lives on the server and is built lazily in a worker, so opening this never blocks.
import {
  SESSION_SEARCH_AGENTS,
  type SessionSearchAgent,
  type SessionSearchHit,
  type SessionSearchQueryResult,
  type SessionSearchStatus,
} from "@tabs/contracts";
import {
  CopyIcon,
  CornerDownLeftIcon,
  HistoryIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { environmentApi } from "../../connection/environmentApiRegistry";
import { writeClipboardTextWithNativeFallback } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Skeleton } from "../ui/skeleton";
import { SessionSearchPreview, type PreviewState } from "./SessionSearchPreview";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import {
  moveSelection,
  projectLabel,
  relativeTime,
  SESSION_SEARCH_AGENT_LABELS,
  splitHighlight,
  indexingProgress,
  SESSION_SEARCH_SOURCE_HINT,
  terminalResumeCommand,
  toggleAgent,
} from "./sessionSearchLogic";
import { useSessionSearchStore } from "./sessionSearchStore";

const DAY_MS = 86_400_000;
const DATE_RANGES = [
  { id: "any", label: "Any time", days: null },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
] as const;
type DateRangeId = (typeof DATE_RANGES)[number]["id"];

const QUERY_DEBOUNCE_MS = 120;
const INDEXING_POLL_MS = 1500;
const RESULT_LIMIT = 40;
const PREVIEW_DELAY_MS = 60;
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

function Highlighted({ snippet }: { snippet: string }) {
  return (
    <>
      {splitHighlight(snippet).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="bg-foreground/15 px-0.5 font-medium text-foreground">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function Chip(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={cn(
        "border px-2.5 py-0.5 text-xs transition-colors",
        props.active
          ? "border-foreground/30 bg-foreground/10 text-foreground"
          : "border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
      style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
    >
      {props.label}
    </button>
  );
}

export function SessionSearchPanel(props: {
  /** Runs a shell command in a new terminal tab; absent when no project is open. */
  readonly runInTerminal?: ((command: string) => Promise<void>) | undefined;
}) {
  const open = useSessionSearchStore((state) => state.open);
  const initialQuery = useSessionSearchStore((state) => state.initialQuery);
  const closePanel = useSessionSearchStore((state) => state.closePanel);

  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState<SessionSearchAgent[]>([]);
  const [range, setRange] = useState<DateRangeId>("any");
  const [result, setResult] = useState<SessionSearchQueryResult | null>(null);
  const [status, setStatus] = useState<SessionSearchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [tick, setTick] = useState(0);
  const [resultQuery, setResultQuery] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const previewRequest = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setSelected(0);
    setError(null);
    // The first call lazily starts the worker and the background index pass.
    void environmentApi()
      .then((api) => api.sessionSearch.status())
      .then(setStatus)
      .catch(() => undefined);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      const days = DATE_RANGES.find((entry) => entry.id === range)?.days ?? null;
      void environmentApi()
        .then((api) =>
          api.sessionSearch.query({
            query,
            limit: RESULT_LIMIT,
            ...(agents.length > 0 ? { agents } : {}),
            ...(days !== null ? { since: Date.now() - days * DAY_MS } : {}),
          }),
        )
        .then((next) => {
          if (request !== requestRef.current) return;
          setResult(next);
          setResultQuery(query);
          setError(null);
          setSelected((current) => Math.min(current, Math.max(0, next.hits.length - 1)));
        })
        .catch((cause: unknown) => {
          if (request !== requestRef.current) return;
          setError(cause instanceof Error ? cause.message : "Search failed.");
        });
    }, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query, agents, range, tick]);

  // While the index is still being built, refresh results (and the counts) as it fills in.
  const indexing = result?.indexing === true;
  useEffect(() => {
    if (!open || !indexing) return;
    const timer = window.setTimeout(() => {
      setTick((value) => value + 1);
      void environmentApi()
        .then((api) => api.sessionSearch.status())
        .then(setStatus)
        .catch(() => undefined);
    }, INDEXING_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [open, indexing, tick]);

  const hits = result?.hits ?? [];

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, hits.length]);

  const selectedHit = hits[selected];
  const selectedKey = selectedHit ? `${selectedHit.agent}:${selectedHit.sessionId}` : null;
  useEffect(() => {
    if (!open || !selectedHit) return;
    const request = ++previewRequest.current;
    setPreview({ status: "loading" });
    const timer = window.setTimeout(() => {
      void environmentApi()
        .then((api) =>
          api.sessionSearch.preview({
            agent: selectedHit.agent,
            sessionId: selectedHit.sessionId,
            query: resultQuery,
          }),
        )
        .then((data) => {
          if (request === previewRequest.current) setPreview({ status: "ready", data });
        })
        .catch((cause: unknown) => {
          if (request !== previewRequest.current) return;
          setPreview({
            status: "error",
            message: cause instanceof Error ? cause.message : "",
          });
        });
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
    // The key identifies the hit; the hit object itself changes on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedKey, resultQuery]);

  const resolveResume = useCallback(async (hit: SessionSearchHit) => {
    const api = await environmentApi();
    return api.sessionSearch.resume({ agent: hit.agent, sessionId: hit.sessionId });
  }, []);

  const copy = useCallback(async (text: string, title: string) => {
    try {
      await writeClipboardTextWithNativeFallback(text);
      toastManager.add({ type: "success", title });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not copy",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  const copyResume = useCallback(
    async (hit: SessionSearchHit) => {
      try {
        const resume = await resolveResume(hit);
        const command = terminalResumeCommand(resume);
        if (command) await copy(command, "Resume command copied");
        else if (resume.transcriptPath) await copy(resume.transcriptPath, "Transcript path copied");
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: "Could not resolve this session",
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [copy, resolveResume],
  );

  const resume = useCallback(
    async (hit: SessionSearchHit) => {
      try {
        const info = await resolveResume(hit);
        const command = terminalResumeCommand(info);
        if (command && props.runInTerminal) {
          closePanel();
          await props.runInTerminal(command);
          return;
        }
        // No resume flag for this agent, or no project to open a terminal in.
        await copyResume(hit);
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: "Could not resume session",
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [closePanel, copyResume, props, resolveResume],
  );

  const reindex = useCallback(async () => {
    try {
      const api = await environmentApi();
      setStatus(await api.sessionSearch.reindex({ full: true }));
      setTick((value) => value + 1);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not rebuild the index",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setSelected((current) => moveSelection(current, 1, hits.length));
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setSelected((current) => moveSelection(current, -1, hits.length));
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      const hit = hits[selected];
      if (!hit) return;
      event.preventDefault();
      void (event.metaKey || event.ctrlKey ? copyResume(hit) : resume(hit));
    }
  };

  const now = Date.now();
  const progress = status ? indexingProgress(status) : null;
  const totalSessions = status?.sessions ?? 0;
  const countFor = (agent: SessionSearchAgent) =>
    status?.byAgent.find((entry) => entry.agent === agent)?.sessions ?? 0;
  const hasQuery = query.trim().length > 0;
  const noIndexYet = status !== null && totalSessions === 0;
  const resumeLabel =
    selectedHit?.agent === "gemini"
      ? "Copy transcript path"
      : props.runInTerminal
        ? "Resume in terminal"
        : "Copy resume command";

  const emptyBody = (() => {
    if (error)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p role="alert" className="text-sm text-foreground">
            Search hit a problem
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => setTick((value) => value + 1)}>
            <RefreshCwIcon /> Try again
          </Button>
        </div>
      );
    if (result === null)
      return (
        <div className="space-y-3 px-4 py-3" aria-busy="true" aria-label="Searching">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      );
    if (indexing && noIndexYet)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-sm text-foreground">Reading your past sessions</p>
          <p className="text-xs text-muted-foreground">
            This happens once. Results appear here as sessions are read.
          </p>
        </div>
      );
    if (noIndexYet)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
          <HistoryIcon className="size-5 text-muted-foreground" />
          <p className="text-sm text-foreground">No past sessions found</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            {SESSION_SEARCH_SOURCE_HINT} Run one of them once and it will show up here.
          </p>
          <Button size="sm" variant="outline" onClick={() => void reindex()}>
            <RefreshCwIcon /> Scan again
          </Button>
        </div>
      );
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <p className="text-sm text-foreground">
          {hasQuery ? `Nothing matches "${query.trim()}"` : "No sessions in this range"}
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {agents.length > 0 || range !== "any"
            ? "Try clearing the filters or searching fewer words."
            : "Try fewer or shorter words. Searches match the start of each word."}
        </p>
        {agents.length > 0 || range !== "any" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAgents([]);
              setRange("any");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    );
  })();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closePanel()}>
      <DialogPopup
        showCloseButton={false}
        className="h-[min(78vh,40rem)] max-w-5xl gap-0 overflow-hidden p-0"
        aria-describedby="session-search-description"
      >
        <DialogTitle className="sr-only">Search past agent sessions</DialogTitle>
        <DialogDescription id="session-search-description" className="sr-only">
          Search Claude Code, Codex, Gemini and OpenCode sessions on this machine.
        </DialogDescription>
        <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(0);
              }}
              placeholder="Search everything you have said to an agent"
              aria-label="Search past agent sessions"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
              style={{ fontFamily: "var(--font-sans)" }}
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="inline-flex size-5 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : (
              <Kbd>Esc</Kbd>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-4 py-2">
            <Chip active={agents.length === 0} label="All" onClick={() => setAgents([])} />
            {SESSION_SEARCH_AGENTS.map((agent) => (
              <Chip
                key={agent}
                active={agents.includes(agent)}
                label={
                  status && countFor(agent) > 0
                    ? `${SESSION_SEARCH_AGENT_LABELS[agent]} ${countFor(agent).toLocaleString()}`
                    : SESSION_SEARCH_AGENT_LABELS[agent]
                }
                onClick={() => setAgents((current) => toggleAgent(current, agent))}
              />
            ))}
            <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
            {DATE_RANGES.map((entry) => (
              <Chip
                key={entry.id}
                active={range === entry.id}
                label={entry.label}
                onClick={() => setRange(entry.id)}
              />
            ))}
          </div>
          <div className="flex min-h-0 flex-1">
            <div
              ref={listRef}
              role="list"
              aria-label="Matching sessions"
              className="min-h-0 w-[40%] shrink-0 overflow-y-auto border-r border-border/60 py-1"
            >
              {error || hits.length === 0 ? (
                emptyBody
              ) : (
                <>
                  {!hasQuery ? (
                    <p
                      className="px-4 pb-1 pt-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/80"
                      style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
                    >
                      Recent sessions
                    </p>
                  ) : null}
                  {hits.map((hit, index) => (
                    <div
                      key={`${hit.agent}:${hit.sessionId}`}
                      role="listitem"
                      aria-current={index === selected ? "true" : undefined}
                      data-index={index}
                      onMouseMove={() => index !== selected && setSelected(index)}
                      onClick={() => setSelected(index)}
                      onDoubleClick={() => void resume(hit)}
                      className={cn(
                        "mx-1.5 cursor-pointer rounded-[var(--radius-control)] px-3 py-2",
                        index === selected ? "bg-foreground/8" : "hover:bg-foreground/5",
                      )}
                    >
                      <span
                        className="block truncate text-sm text-foreground"
                        style={{ fontFamily: "var(--font-row, var(--font-sans))" }}
                      >
                        {hit.title}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                        style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
                      >
                        {SESSION_SEARCH_AGENT_LABELS[hit.agent]}
                        {hit.cwd ? ` · ${projectLabel(hit.cwd)}` : ""} ·{" "}
                        {relativeTime(hit.timestamp, now)}
                        {hit.matchCount > 1 ? ` · ${hit.matchCount} matches` : ""}
                      </span>
                      {hasQuery ? (
                        <p
                          className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground"
                          style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
                        >
                          <Highlighted snippet={hit.snippet} />
                        </p>
                      ) : null}
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Transcript preview">
              {selectedHit && !error ? (
                <>
                  <div className="flex items-start gap-3 border-b border-border/60 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm font-medium text-foreground"
                        style={{ fontFamily: "var(--font-row, var(--font-sans))" }}
                      >
                        {selectedHit.title}
                      </p>
                      <p
                        className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {selectedHit.cwd ?? SESSION_SEARCH_AGENT_LABELS[selectedHit.agent]}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copyResume(selectedHit)}
                    >
                      <CopyIcon /> Copy <Kbd>{MOD}↵</Kbd>
                    </Button>
                    <Button size="sm" onClick={() => void resume(selectedHit)}>
                      <PlayIcon /> {resumeLabel} <CornerDownLeftIcon className="size-3" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SessionSearchPreview hit={selectedHit} state={preview} />
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
                  <SearchIcon className="size-5 text-muted-foreground" />
                  <p className="text-sm text-foreground">Find a conversation you had before</p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Type a few words from the prompt or the answer. Pick a result to read the
                    conversation around it, then resume it in a terminal.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div
            className="flex items-center gap-3 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground"
            style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
          >
            {indexing && status ? (
              <span className="flex items-center gap-2" role="status">
                <span className="relative h-1 w-20 overflow-hidden rounded-full bg-foreground/10">
                  <span
                    className="absolute inset-y-0 left-0 bg-foreground/50"
                    style={{ width: `${Math.round((progress ?? 0.15) * 100)}%` }}
                  />
                </span>
                Indexing {status.pending > 0 ? `${status.pending.toLocaleString()} left` : ""}
              </span>
            ) : (
              <span role="status">
                {status
                  ? `${totalSessions.toLocaleString()} sessions indexed${
                      status.state === "error" ? " · index error" : ""
                    }`
                  : "Reading the index…"}
              </span>
            )}
            <button
              type="button"
              onClick={() => void reindex()}
              className="inline-flex items-center gap-1 hover:text-foreground"
              aria-label="Rebuild the session index"
            >
              <RefreshCwIcon className="size-3" />
              Rebuild
            </button>
            <span className="ml-auto inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> Browse
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>↵</Kbd> {props.runInTerminal ? "Resume" : "Copy command"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>{MOD}↵</Kbd> Copy
              </span>
            </span>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
