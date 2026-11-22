import { Button } from "../ui/button";

const BEATS = [
  {
    title: "Ask it anything",
    body: "Type below like you would to a coworker. Small questions it answers itself.",
  },
  {
    title: "It hands off the real work",
    body: "Code changes go to workers in their own threads. You see them under Working on.",
  },
  {
    title: "It looks around and speaks up",
    body: "When it needs a decision it tells you here. Ideas for what to do next show up under Up next.",
  },
] as const;

/** First run: what a teammate is, in three short beats. Dismissed once, then out of the way. */
export function TeammateIntro({
  name,
  starters,
  onPick,
  onDismiss,
}: {
  name: string;
  starters: ReadonlyArray<string>;
  onPick: (ask: string) => void;
  onDismiss: () => void;
}) {
  return (
    <section className="tm-intro" aria-label={`Meet ${name}`}>
      <h3 className="tm-intro-title">Meet {name}, your teammate</h3>
      <ol className="grid gap-5 sm:grid-cols-3">
        {BEATS.map((beat, index) => (
          <li key={beat.title} className="flex flex-col gap-1">
            <span className="tm-meta">{index + 1}</span>
            <span className="tm-row-title">{beat.title}</span>
            <span className="tm-supporting leading-relaxed">{beat.body}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="tm-meta me-1">Try asking</span>
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            className="tm-chip no-drag"
            onClick={() => onPick(starter)}
          >
            {starter}
          </button>
        ))}
        <span className="flex-1" />
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          Got it
        </Button>
      </div>
    </section>
  );
}
