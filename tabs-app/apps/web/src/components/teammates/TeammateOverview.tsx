import type {
  Teammate,
  TeammateItem,
  TeammateSuggestion,
  TeammatesSnapshot,
  ThreadId,
} from "@tabs/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { attempt, openThread, teammatesApi } from "./teammatesActions";
import {
  itemsWithStatus,
  recentlyFinished,
  sortSuggestions,
  workerStatusLine,
} from "./teammates.logic";
import { useWorkerStates } from "./useTeammates";

function Lane({
  title,
  count,
  hint,
  emphasis = false,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <div className="tm-lane-head">
        <h3 className="tm-section-title">{title}</h3>
        {count !== undefined ? <span className="tm-meta">{count}</span> : null}
        {hint ? <span className="tm-meta">{hint}</span> : null}
      </div>
      <ul className="tm-group" data-emphasis={emphasis}>
        {children}
      </ul>
    </section>
  );
}

function setStatus(item: TeammateItem, status: "done" | "dropped") {
  return attempt("Could not update that", () =>
    teammatesApi().updateItem({ id: item.id, patch: { status } }),
  );
}

function NeedsYouRow({ item, onOpenChat }: { item: TeammateItem; onOpenChat: () => void }) {
  const navigate = useNavigate();
  const worker = item.workerThreadIds.at(-1);
  return (
    <li className="tm-line flex-col !items-stretch gap-3">
      <div className="tm-line-body">
        <div className="tm-line-title">{item.title}</div>
        <div className="tm-supporting text-foreground">
          {item.question ?? item.detail ?? "It is waiting on you."}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="xs"
          onClick={() => (worker ? void openThread(worker, navigate) : onOpenChat())}
        >
          {worker ? "Open the thread" : "Answer in chat"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void setStatus(item, "done")}>
          Mark done
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void setStatus(item, "dropped")}>
          Drop
        </Button>
      </div>
    </li>
  );
}

function WorkingRow({ item }: { item: TeammateItem }) {
  const navigate = useNavigate();
  const ids = item.workerThreadIds;
  const states = useWorkerStates(ids);
  const latestId = ids.at(-1);
  const latest = latestId ? (states.get(latestId) ?? null) : null;
  return (
    <li className="tm-line">
      <div className="tm-line-body">
        <div className="tm-line-title">{item.title}</div>
        <div className="tm-supporting flex items-center gap-1.5">
          {latest?.running ? <Spinner className="size-3.5" /> : null}
          {workerStatusLine(latest, ids.length)}
        </div>
        {item.detail ? <div className="tm-supporting line-clamp-2">{item.detail}</div> : null}
      </div>
      <div className="tm-line-actions">
        {latestId ? (
          <Button size="xs" variant="outline" onClick={() => void openThread(latestId, navigate)}>
            Open
          </Button>
        ) : null}
        <Button size="xs" variant="ghost" onClick={() => void setStatus(item, "dropped")}>
          Drop
        </Button>
      </div>
    </li>
  );
}

function TodoRow({ item }: { item: TeammateItem }) {
  return (
    <li className="tm-line">
      <div className="tm-line-body">
        <div className="tm-line-title">{item.title}</div>
        {item.detail ? <div className="tm-supporting line-clamp-2">{item.detail}</div> : null}
      </div>
      <div className="tm-line-actions">
        <Button size="xs" variant="ghost" onClick={() => void setStatus(item, "done")}>
          Done
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void setStatus(item, "dropped")}>
          Drop
        </Button>
      </div>
    </li>
  );
}

function SuggestionRow({
  suggestion,
  hasProject,
  onNeedsProject,
}: {
  suggestion: TeammateSuggestion;
  hasProject: boolean;
  onNeedsProject: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const started = suggestion.status !== "open";
  return (
    <li className="tm-line">
      <div className="tm-line-body">
        <div className="tm-line-title">{suggestion.title}</div>
        {suggestion.why ? <div className="tm-supporting">{suggestion.why}</div> : null}
      </div>
      {started ? (
        <span className="tm-meta shrink-0 pt-0.5">Started</span>
      ) : (
        <div className="tm-line-actions">
          <Button
            size="xs"
            disabled={busy}
            onClick={async () => {
              if (!hasProject) {
                onNeedsProject();
                return;
              }
              setBusy(true);
              const result = await attempt("Could not start that", () =>
                teammatesApi().startSuggestion({ id: suggestion.id }),
              );
              setBusy(false);
              if (result) {
                toastManager.add({
                  type: "success",
                  title: "Started",
                  description: suggestion.title,
                });
                void openThread(result.workerThreadId as ThreadId, navigate);
              }
            }}
          >
            Start
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void attempt("Could not dismiss that", () =>
                teammatesApi().dismissSuggestion({ id: suggestion.id }),
              )
            }
          >
            Not now
          </Button>
        </div>
      )}
    </li>
  );
}

/** What is going on, in the order that matters: needs you, working on, up next, finished. */
export function TeammateOverview({
  snapshot,
  teammate,
  onGoToSettings,
  onOpenChat,
}: {
  snapshot: TeammatesSnapshot;
  teammate: Teammate;
  onGoToSettings: () => void;
  onOpenChat: () => void;
}) {
  const teammateId = teammate.id;
  const needsYou = useMemo(
    () => itemsWithStatus(snapshot.items, teammateId, ["needsYou"]),
    [snapshot.items, teammateId],
  );
  const working = useMemo(
    () => itemsWithStatus(snapshot.items, teammateId, ["working"]),
    [snapshot.items, teammateId],
  );
  const todo = useMemo(
    () => itemsWithStatus(snapshot.items, teammateId, ["todo"]),
    [snapshot.items, teammateId],
  );
  const suggestions = useMemo(
    () => sortSuggestions(snapshot.suggestions, teammateId),
    [snapshot.suggestions, teammateId],
  );
  const finished = useMemo(
    () => recentlyFinished(snapshot.items, teammateId),
    [snapshot.items, teammateId],
  );
  const [looking, setLooking] = useState(false);
  const [projectNotice, setProjectNotice] = useState(false);
  const nothing = needsYou.length + working.length + todo.length + suggestions.length === 0;

  const lookNow = async () => {
    setLooking(true);
    const result = await attempt("Could not start a look around", () =>
      teammatesApi().lookAroundNow({ id: teammateId }),
    );
    setLooking(false);
    if (result)
      toastManager.add({
        type: "info",
        title:
          result.status === "busy"
            ? `${teammate.name} is already looking around`
            : `${teammate.name} is looking around`,
        description: "Ideas it finds appear under Up next.",
      });
  };

  return (
    <>
      <div className="tm-stats" aria-label="At a glance">
        <div className="tm-stat" data-quiet={needsYou.length === 0}>
          <span className="tm-stat-value">{needsYou.length}</span>
          <span className="tm-meta">Waiting on you</span>
        </div>
        <div className="tm-stat" data-quiet={working.length + todo.length === 0}>
          <span className="tm-stat-value">{working.length + todo.length}</span>
          <span className="tm-meta">In progress</span>
        </div>
        <div className="tm-stat" data-quiet={suggestions.length === 0}>
          <span className="tm-stat-value">{suggestions.length}</span>
          <span className="tm-meta">Ideas to review</span>
        </div>
      </div>
      {needsYou.length > 0 ? (
        <Lane title="Needs you" count={needsYou.length} emphasis>
          {needsYou.map((item) => (
            <NeedsYouRow key={item.id} item={item} onOpenChat={onOpenChat} />
          ))}
        </Lane>
      ) : null}
      {working.length + todo.length > 0 ? (
        <Lane title="Working on" count={working.length + todo.length}>
          {working.map((item) => (
            <WorkingRow key={item.id} item={item} />
          ))}
          {todo.map((item) => (
            <TodoRow key={item.id} item={item} />
          ))}
        </Lane>
      ) : null}
      {suggestions.length > 0 ? (
        <Lane title="Up next" count={suggestions.length}>
          {projectNotice ? (
            <li className="tm-line tm-supporting" data-center="true" role="alert">
              <span>{teammate.name} needs a project to start workers in.</span>
              <Button size="xs" variant="outline" onClick={onGoToSettings}>
                Choose a project
              </Button>
            </li>
          ) : null}
          {suggestions.map((suggestion) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              hasProject={teammate.projectId !== null}
              onNeedsProject={() => setProjectNotice(true)}
            />
          ))}
        </Lane>
      ) : null}
      {nothing ? (
        <section className="tm-empty" aria-label="Nothing in flight">
          <h3 className="tm-row-title">Nothing in flight</h3>
          <p className="tm-supporting max-w-prose leading-relaxed">
            Ask {teammate.name} for something above and work shows up here: what needs you, what is
            running, and what it suggests next.
            {teammate.lookAround.enabled
              ? " It is set to look around on a schedule."
              : " Or let it look around your projects and suggest where to start."}
          </p>
          <div className="flex gap-2">
            {teammate.lookAround.enabled ? null : (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void attempt("Could not update the teammate", () =>
                    teammatesApi().update({
                      id: teammateId,
                      patch: { lookAround: { enabled: true } },
                    }),
                  )
                }
              >
                Turn on looking around
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={looking || teammate.paused}
              onClick={() => void lookNow()}
            >
              Look around now
            </Button>
          </div>
        </section>
      ) : null}
      {finished.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger className="tm-section-title no-drag group flex items-center gap-1">
            <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
            Finished lately
            <span className="tm-meta ms-1">{finished.length}</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <ul className="tm-group mt-2.5">
              {finished.map((item) => (
                <li key={item.id} className="tm-line" data-center="true">
                  <span className="tm-supporting truncate">{item.title}</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void attempt("Could not update that", () =>
                        teammatesApi().updateItem({ id: item.id, patch: { status: "todo" } }),
                      )
                    }
                  >
                    Reopen
                  </Button>
                </li>
              ))}
            </ul>
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
    </>
  );
}
