import type { Teammate } from "@tabs/contracts";
import { TEAMMATE_SOUL_MAX_LENGTH } from "@tabs/contracts";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { attempt, teammatesApi } from "./teammatesActions";

/** Lines worth adding. Each appends one instruction to the soul. */
export const SOUL_EXAMPLES: ReadonlyArray<{ label: string; line: string }> = [
  { label: "Be blunt", line: "Be direct. Skip the cushioning and say what is wrong first." },
  { label: "Explain simply", line: "Explain things like I am new to this part of the code." },
  {
    label: "Ask before big changes",
    line: "Ask before touching more than three files or any config.",
  },
  { label: "Stay off main", line: "Never commit to main. Always work on a branch." },
  { label: "Keep it short", line: "Answer in a few sentences unless I ask for detail." },
];

/** Appends a line on its own line, never duplicating it. */
export function appendSoulLine(soul: string, line: string): string {
  if (
    soul.split("\n").some((existing) => existing.trim() === `- ${line}` || existing.trim() === line)
  ) {
    return soul;
  }
  const base = soul.endsWith("\n") || soul === "" ? soul : `${soul}\n`;
  return `${base}- ${line}\n`;
}

/** SOUL.md: who this teammate is. Plain text, with guidance and one-click examples. */
export function TeammateSoul({ teammate }: { teammate: Pick<Teammate, "id" | "name"> }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    let live = true;
    setSaved(null);
    void attempt("Could not load the soul", () =>
      teammatesApi().getSoul({ id: teammate.id as never }),
    ).then((result) => {
      if (live && result) {
        setSaved(result.soul);
        setDraft(result.soul);
      }
    });
    return () => {
      live = false;
    };
  }, [teammate.id]);

  const dirty = saved !== null && draft !== saved;
  const save = useCallback(async () => {
    setSaving(true);
    const result = await attempt("Could not save the soul", () =>
      teammatesApi().setSoul({ id: teammate.id as never, soul: draft }),
    );
    setSaving(false);
    if (result) {
      setSaved(result.soul);
      setJustSaved(true);
    }
  }, [draft, teammate.id]);

  if (saved === null) return <p className="tm-supporting">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="tm-supporting max-w-prose leading-relaxed">
        The soul is {teammate.name}’s personality and standing orders, in plain words. It reads it
        at the start of every chat. Say how it should talk, what it should care about, and what it
        must never do.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="tm-meta me-1">Add a line</span>
        {SOUL_EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            className="tm-chip no-drag"
            onClick={() => {
              setDraft((current) => appendSoulLine(current, example.line));
              setJustSaved(false);
            }}
          >
            {example.label}
          </button>
        ))}
      </div>
      <textarea
        className="tm-soul no-drag"
        value={draft}
        rows={14}
        maxLength={TEAMMATE_SOUL_MAX_LENGTH}
        aria-label={`${teammate.name}'s soul`}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          setJustSaved(false);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            if (dirty && !saving) void save();
          }
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="tm-meta" role="status">
          {justSaved && !dirty
            ? "Saved. A running chat picks it up on its next turn."
            : `${draft.length.toLocaleString()} / ${TEAMMATE_SOUL_MAX_LENGTH.toLocaleString()}`}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => setDraft(saved)}
          >
            Revert
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
