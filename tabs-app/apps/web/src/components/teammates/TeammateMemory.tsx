import type { Teammate, TeammateMemoryFact } from "@tabs/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { attempt, teammatesApi } from "./teammatesActions";

/** How long "Forgot" can be undone before the fact is really removed. */
export const FORGET_UNDO_MS = 5_000;

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
  return (
    <div className="flex flex-col gap-4">
      <p className="tm-supporting max-w-prose leading-relaxed">
        What {teammate.name} remembers between chats. It saves things you tell it to remember and
        things you correct it on. Forget anything that is wrong or out of date.
      </p>
      {facts.length === 0 ? (
        <div className="tm-empty">
          <h3 className="tm-row-title">Nothing remembered yet</h3>
          <p className="tm-supporting max-w-prose leading-relaxed">
            Try telling {teammate.name} “remember that I prefer small pull requests” in chat. It
            shows up here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {facts.map((fact) => {
            const forgotten = pending.has(fact.id);
            return (
              <li key={fact.id} className="tm-card flex items-start justify-between gap-3">
                {forgotten ? (
                  <span className="tm-supporting py-0.5" role="status">
                    Forgotten.
                  </span>
                ) : (
                  <div className="min-w-0">
                    <div className="tm-row-title whitespace-pre-wrap">{fact.text}</div>
                    <div className="tm-meta">
                      {fact.topic ? `${fact.topic} · ` : ""}
                      {fact.source}
                    </div>
                  </div>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => (forgotten ? undo(fact.id) : forget(fact.id))}
                >
                  {forgotten ? "Undo" : "Forget"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
