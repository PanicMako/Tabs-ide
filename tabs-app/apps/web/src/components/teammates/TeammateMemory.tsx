import type { Teammate, TeammateMemoryFact } from "@tabs/contracts";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { attempt, teammatesApi } from "./teammatesActions";
import { filterMemoryFacts, groupMemoryFacts, memorySourceLabel } from "./teammates.logic";

/** How long "Forgot" can be undone before the fact is really removed. */
export const FORGET_UNDO_MS = 5_000;
/** Search only earns its place once the list is long enough to scan. */
const SEARCH_THRESHOLD = 6;

/** Facts the teammate remembers. Forgetting waits a few seconds so it can be undone. */
export function TeammateMemory({
  teammate,
  refreshKey,
  undoMs = FORGET_UNDO_MS,
}: {
  teammate: Pick<Teammate, "id" | "name">;
  /** Re-fetched when this changes (snapshot updates). */
  refreshKey: string;
  undoMs?: number;
}) {
  const [facts, setFacts] = useState<ReadonlyArray<TeammateMemoryFact> | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let live = true;
    void attempt("Could not load memory", () =>
      teammatesApi().listMemory({ teammateId: teammate.id as never }),
    ).then((result) => {
      if (live && result) setFacts(result.facts);
    });
    return () => {
      live = false;
    };
  }, [teammate.id, refreshKey]);

  const commit = useCallback(async (id: string) => {
    timers.current.delete(id);
    const result = await attempt("Could not forget that", () =>
      teammatesApi().forgetMemory({ id: id as never }),
    );
    setPending((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    if (result) setFacts((current) => current?.filter((fact) => fact.id !== id) ?? null);
  }, []);

  // Leaving the screen is a decision: whatever was forgotten stays forgotten.
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const [id, timer] of live) {
        clearTimeout(timer);
        void teammatesApi().forgetMemory({ id: id as never });
      }
      live.clear();
    };
  }, []);

  const forget = (id: string) => {
    setPending((current) => new Set(current).add(id));
    timers.current.set(
      id,
      setTimeout(() => void commit(id), undoMs),
    );
  };
  const undo = (id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setPending((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  if (!facts) return <p className="tm-supporting">Loading memory…</p>;
  const visible = filterMemoryFacts(facts, query);
  const groups = groupMemoryFacts(visible);
  const showSearch = facts.length > SEARCH_THRESHOLD;
  return (
    <div className="tm-page">
      <div className="tm-page-head">
        <div>
          <h2 className="tm-page-title">Memory</h2>
          <p className="tm-page-lede">
            What {teammate.name} remembers between chats. It saves things you tell it to remember
            and things you correct it on. Forget anything that is wrong or out of date.
          </p>
        </div>
        {facts.length > 0 ? (
          <span className="tm-meta shrink-0 pb-1">
            {facts.length} {facts.length === 1 ? "fact" : "facts"}
          </span>
        ) : null}
      </div>
      {showSearch ? (
        <Input
          type="search"
          aria-label="Search memory"
          placeholder="Search what it remembers"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {facts.length === 0 ? (
        <div className="tm-empty">
          <h3 className="tm-row-title">Nothing remembered yet</h3>
          <p className="tm-supporting max-w-prose leading-relaxed">
            Try telling {teammate.name} “remember that I prefer small pull requests” in chat. It
            shows up here.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="tm-empty">
          <h3 className="tm-row-title">No matches</h3>
          <p className="tm-supporting">Nothing remembered mentions “{query.trim()}”.</p>
        </div>
      ) : (
        groups.map((group) => (
          <section
            key={group.topic ?? "__general__"}
            className="flex flex-col gap-2.5"
            aria-label={group.topic ?? "General"}
          >
            {groups.length > 1 ? (
              <div className="tm-lane-head">
                <h3 className="tm-section-title">{group.topic ?? "General"}</h3>
                <span className="tm-meta">{group.facts.length}</span>
              </div>
            ) : null}
            <ul className="tm-group">
              {group.facts.map((fact) => {
                const forgotten = pending.has(fact.id);
                return (
                  <li
                    key={fact.id}
                    className="tm-line tm-fact"
                    data-forgotten={forgotten}
                    data-center={forgotten}
                  >
                    {forgotten ? (
                      <>
                        <span className="tm-supporting" role="status">
                          Forgotten.
                        </span>
                        <span
                          className="tm-undo-timer"
                          style={{ "--tm-undo-ms": `${undoMs}ms` } as CSSProperties}
                          aria-hidden="true"
                        />
                      </>
                    ) : (
                      <div className="tm-line-body">
                        <div className="tm-fact-text">{fact.text}</div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {fact.topic && groups.length === 1 ? (
                            <span className="tm-tag">{fact.topic}</span>
                          ) : null}
                          <span className="tm-meta">{memorySourceLabel(fact.source)}</span>
                        </div>
                      </div>
                    )}
                    <div className="tm-line-actions">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => (forgotten ? undo(fact.id) : forget(fact.id))}
                      >
                        {forgotten ? "Undo" : "Forget"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
