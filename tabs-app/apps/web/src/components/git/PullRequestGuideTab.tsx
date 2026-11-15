import type {
  PullRequestReviewGuide,
  PullRequestReviewGuideExcerpt,
  PullRequestReviewGuideStop,
} from "@tabs/contracts";
import { useState } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { excerptLines, isGuideStale } from "./guideExcerpt.logic";

const ATTENTION_LABEL: Record<NonNullable<PullRequestReviewGuideStop["attention"]>["kind"], string> = {
  tradeoff: "Tradeoff",
  contract: "Contract",
  product: "Product",
  risk: "Risk",
  accessibility: "Accessibility",
};

function Excerpt({
  excerpt,
  patchOf,
  notes,
}: {
  excerpt: PullRequestReviewGuideExcerpt;
  patchOf: (path: string) => string | null | undefined;
  notes: PullRequestReviewGuideStop["notes"];
}) {
  const lines = excerptLines(patchOf(excerpt.path), excerpt);
  return (
    <figure className="overflow-hidden rounded-md border border-border/70 bg-background">
      <figcaption className="border-b border-border/60 bg-muted/20 px-3 py-1.5">
        <div className="break-all font-mono text-[11px] font-semibold text-foreground">
          {excerpt.path}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {excerpt.side === "new" ? "new" : "old"} {excerpt.start}–{excerpt.end}
          </span>
        </div>
        {excerpt.caption ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{excerpt.caption}</p>
        ) : null}
      </figcaption>
      {lines.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          These lines are not part of the patch the host returned.
        </p>
      ) : (
        <div className="overflow-x-auto font-mono text-[11px] leading-5">
          {lines.map((line) => {
            const number = excerpt.side === "new" ? line.newLine : line.oldLine;
            const lineNotes = notes.filter(
              (note) => note.path === excerpt.path && note.line === number,
            );
            return (
              <div key={line.key}>
                <div
                  className={`grid grid-cols-[3rem_minmax(max-content,1fr)] whitespace-pre ${
                    line.kind === "addition"
                      ? "bg-diff-addition-line"
                      : line.kind === "deletion"
                        ? "bg-diff-deletion-line"
                        : ""
                  }`}
                >
                  <span className="select-none border-r border-border/40 px-1 text-right text-muted-foreground">
                    {number}
                  </span>
                  <span className="px-2">{line.text}</span>
                </div>
                {lineNotes.map((note) => (
                  <div
                    key={`${note.path}:${note.line}:${note.title}`}
                    className="border-y border-border/60 bg-muted/30 px-3 py-2 font-sans text-xs"
                  >
                    <p className="font-semibold text-foreground">{note.title}</p>
                    {note.body ? (
                      <div className="mt-0.5 text-foreground/90">
                        <ChatMarkdown text={note.body} cwd={undefined} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </figure>
  );
}

function Stop({
  stop,
  patchOf,
  onOpenFile,
}: {
  stop: PullRequestReviewGuideStop;
  patchOf: (path: string) => string | null | undefined;
  onOpenFile: (path: string) => void;
}) {
  return (
    <article className="min-w-0 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{stop.title}</h3>
      {stop.summary ? (
        <div className="text-xs text-foreground/90">
          <ChatMarkdown text={stop.summary} cwd={undefined} />
        </div>
      ) : null}
      {stop.attention ? (
        <div className="rounded-md border border-border/70 bg-muted/40 p-2.5 text-xs">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {ATTENTION_LABEL[stop.attention.kind]}
          </p>
          <p className="mt-0.5 text-foreground/90">{stop.attention.note}</p>
        </div>
      ) : null}
      {stop.excerpts.map((excerpt) => (
        <Excerpt
          key={`${excerpt.path}:${excerpt.side}:${excerpt.start}`}
          excerpt={excerpt}
          patchOf={patchOf}
          notes={stop.notes}
        />
      ))}
      {stop.files.length > 0 ? (
        <ul className="space-y-1 text-xs" aria-label="Other files in this stop">
          {stop.files.map((file) => (
            <li key={file.path} className="flex flex-wrap items-baseline gap-x-2">
              <button
                type="button"
                className="break-all font-mono text-[11px] text-foreground underline-offset-2 hover:underline"
                onClick={() => onOpenFile(file.path)}
              >
                {file.path}
              </button>
              {file.note ? <span className="text-muted-foreground">{file.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {stop.questions.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Questions for the author
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-foreground/90">
            {stop.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/**
 * T3's review guide: a short tour of a pull request, one stop at a time, written by the writing
 * model from the diff. The rail names the stops; the page shows the open one with the lines worth
 * reading. Nothing is written until the reader asks, and a guide for an older head says so.
 */
export function PullRequestGuideTab({
  guide,
  run,
  currentHeadSha,
  isLoading,
  writing,
  error,
  onWrite,
  patchOf,
  onOpenFile,
}: {
  guide: PullRequestReviewGuide | null;
  run: { readonly _tag: "Running" | "Failed"; readonly detail?: string } | null;
  currentHeadSha: string | null;
  isLoading: boolean;
  writing: boolean;
  error: unknown;
  onWrite: () => void;
  patchOf: (path: string) => string | null | undefined;
  onOpenFile: (path: string) => void;
}) {
  const [index, setIndex] = useState(0);

  if (isLoading) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Loading the guide…</p>;
  }

  const failure =
    run?._tag === "Failed"
      ? (run.detail ?? "The guide could not be written.")
      : error instanceof Error
        ? error.message
        : null;

  if (guide === null || guide.stops.length === 0) {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-sm font-medium text-foreground">A guided tour of this pull request</p>
        <p className="mx-auto max-w-md text-xs text-muted-foreground">
          The writing model reads the diff and orders the change into a few stops, each with the
          lines worth a reviewer&apos;s attention. It runs once you ask and takes a minute or two.
        </p>
        {failure ? (
          <p role="alert" className="mx-auto max-w-md break-words text-xs text-destructive-foreground">
            {failure}
          </p>
        ) : null}
        <Button size="sm" disabled={writing} onClick={onWrite}>
          {writing ? <Spinner className="size-3.5" /> : null}
          {writing ? "Writing the guide…" : failure ? "Try again" : "Write a review guide"}
        </Button>
      </div>
    );
  }

  const stale = isGuideStale(guide, currentHeadSha);
  const stop = guide.stops[Math.min(index, guide.stops.length - 1)]!;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {stale
            ? "Written for an earlier version of this pull request."
            : `Written ${new Date(guide.generatedAt).toLocaleString()}.`}
        </span>
        <Button size="sm" variant="outline" disabled={writing} onClick={onWrite}>
          {writing ? <Spinner className="size-3.5" /> : null}
          {writing ? "Writing…" : stale ? "Rewrite for the latest" : "Rewrite"}
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="break-words text-xs text-destructive-foreground">
          {failure}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Guide stops" className="min-w-0">
          <ol className="space-y-0.5">
            {guide.stops.map((entry, position) => (
              <li key={`${position}-${entry.title}`}>
                <button
                  type="button"
                  aria-current={position === index ? "step" : undefined}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    position === index
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-foreground hover:bg-muted/40"
                  }`}
                  onClick={() => setIndex(position)}
                >
                  <span className="mt-px w-4 shrink-0 text-right tabular-nums text-muted-foreground">
                    {position + 1}
                  </span>
                  <span className="min-w-0">{entry.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 space-y-3">
          <Stop stop={stop} patchOf={patchOf} onOpenFile={onOpenFile} />
          <div className="flex items-center justify-between border-t border-border/60 pt-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={index === 0}
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {Math.min(index, guide.stops.length - 1) + 1} of {guide.stops.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={index >= guide.stops.length - 1}
              onClick={() => setIndex((current) => Math.min(guide.stops.length - 1, current + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
