import { XIcon } from "lucide-react";
import { useState } from "react";

import { Input } from "../ui/input";
import "./voice-settings.css";

/** Splits typed or pasted text into words, trimming and dropping duplicates of `existing`. */
/** The dictionary's limits (see `SpeechCustomWords`): 50 characters a word, 100 words. */
export const CUSTOM_WORD_MAX_LENGTH = 50;
export const CUSTOM_WORDS_MAX = 100;

export function addCustomWords(
  existing: ReadonlyArray<string>,
  text: string,
): ReadonlyArray<string> {
  const seen = new Set(existing.map((word) => word.toLowerCase()));
  const next = [...existing];
  for (const raw of text.split(/[,\n]/)) {
    const word = raw.trim().slice(0, CUSTOM_WORD_MAX_LENGTH).trim();
    if (next.length >= CUSTOM_WORDS_MAX) break;
    if (word.length === 0 || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    next.push(word);
  }
  return next;
}

/**
 * Names and terms dictation should spell right, as removable chips. Type a
 * word and press Enter or a comma; Backspace in the empty field removes the
 * last one. Pasting a comma-separated list adds them all.
 */
export function CustomWordsField(props: {
  readonly words: ReadonlyArray<string>;
  readonly onChange: (words: ReadonlyArray<string>) => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = (text: string) => {
    const next = addCustomWords(props.words, text);
    if (next.length !== props.words.length) props.onChange(next);
    setDraft("");
  };

  return (
    <div className="custom-words" data-slot="custom-words">
      {props.words.length > 0 && (
        <ul className="custom-words-list" aria-label="Custom words">
          {props.words.map((word) => (
            <li key={word} className="custom-words-chip">
              <span className="truncate">{word}</span>
              <button
                type="button"
                className="custom-words-remove"
                aria-label={`Remove ${word}`}
                onClick={() => props.onChange(props.words.filter((entry) => entry !== word))}
              >
                <XIcon className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        unstyled
        aria-label="Add a custom word"
        placeholder={
          props.words.length === 0 ? "Add a name or term, then press Enter" : "Add another"
        }
        className="custom-words-input"
        value={draft}
        onChange={(event) => {
          const value = event.target.value;
          if (value.includes(",")) commit(value);
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          } else if (event.key === "Backspace" && draft.length === 0 && props.words.length > 0) {
            props.onChange(props.words.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim().length > 0) commit(draft);
        }}
      />
    </div>
  );
}
