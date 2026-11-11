import { useEffect, useId, useRef, useState } from "react";
import {
  BookmarkPlusIcon,
  CornerDownLeftIcon,
  ListPlusIcon,
  PlayIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { DockUfoIcon } from "../DockUfoIcon";
import type { ScriptSuggestion } from "./scriptSuggestions";

type Props = {
  projectName: string;
  cwd: string;
  onNewTerminal: () => void;
  onAdd: () => void;
  /** Run a command once in a fresh Dock terminal. */
  onRunCommand: (command: string) => void;
  /** Save a command as a preset, optionally running it right away. */
  onSaveCommand: (input: { label: string; command: string; run: boolean }) => void;
  /** The project's own scripts, detected from package.json and friends. */
  loadSuggestions?: (() => Promise<ScriptSuggestion[]>) | undefined;
};

function presetLabelFor(command: string): string {
  const words = command.trim().split(/\s+/);
  // "npm run dev" → "dev"; "cargo test" → "cargo test".
  if (words.length >= 3 && words[1] === "run") return words.slice(2).join(" ");
  return words.slice(0, 2).join(" ");
}

/**
 * Empty Dock: a prompt to run something right now, the project's own scripts
 * one click away, and the two ways to start from scratch. Nothing runs without
 * an explicit Enter or click.
 */
export function DockLaunchpad({
  projectName,
  cwd,
  onNewTerminal,
  onAdd,
  onRunCommand,
  onSaveCommand,
  loadSuggestions,
}: Props) {
  const [command, setCommand] = useState("");
  const [suggestions, setSuggestions] = useState<ScriptSuggestion[] | null>(
    loadSuggestions ? null : [],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const directory = cwd.split(/[\\/]/).filter(Boolean).at(-1) || projectName;

  useEffect(() => {
    if (!loadSuggestions) return;
    let active = true;
    loadSuggestions()
      .then((next) => active && setSuggestions(next))
      .catch(() => active && setSuggestions([]));
    return () => {
      active = false;
    };
  }, [loadSuggestions]);

  const submit = (save: boolean) => {
    const trimmed = command.trim();
    if (!trimmed) return;
    if (save) onSaveCommand({ label: presetLabelFor(trimmed), command: trimmed, run: true });
    else onRunCommand(trimmed);
    setCommand("");
  };

  return (
    <section className="dock-setup" aria-label="Set up Dock">
      <div className="dock-launchpad">
        <header className="dock-launchpad-heading">
          <div className="dock-launchpad-mascot" aria-hidden="true">
            <DockUfoIcon className="dock-launchpad-mark" />
            <span className="dock-launchpad-beam" />
          </div>
          <h2>Nothing running yet.</h2>
          <p>
            Run a command, open a shell, or keep the ones you use every day as presets you can
            start, restart and watch from here.
          </p>
        </header>

        <form
          className="dock-launchpad-prompt"
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
          onClick={() => inputRef.current?.focus()}
        >
          <span className="dock-launchpad-path" title={cwd}>
            {directory}
          </span>
          <span className="dock-launchpad-caret" aria-hidden="true">
            ❯
          </span>
          <input
            ref={inputRef}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit(true);
              }
            }}
            placeholder="Run a command…"
            aria-label={`Run a command in ${projectName}`}
            aria-describedby={hintId}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
          />
          <button
            type="submit"
            className="dock-launchpad-run"
            disabled={!command.trim()}
            aria-label="Run command"
          >
            <CornerDownLeftIcon aria-hidden="true" />
          </button>
        </form>
        <p id={hintId} className="dock-launchpad-hint">
          <kbd>⏎</kbd> runs it once · <kbd>⌘</kbd>
          <kbd>⏎</kbd> saves it as a preset and runs it
        </p>

        {suggestions === null ? (
          <div className="dock-launchpad-scripts" aria-busy="true">
            <div className="dock-launchpad-section-label">From this project</div>
            {[0, 1, 2].map((index) => (
              <div key={index} className="dock-launchpad-script is-placeholder" />
            ))}
          </div>
        ) : suggestions.length > 0 ? (
          <div className="dock-launchpad-scripts">
            <div className="dock-launchpad-section-label">From this project</div>
            <ul aria-label="Project scripts">
              {suggestions.map((suggestion) => (
                <li key={suggestion.name} className="dock-launchpad-script">
                  <button
                    type="button"
                    className="dock-launchpad-script-run"
                    onClick={() => onRunCommand(suggestion.command)}
                    aria-label={`Run ${suggestion.command}`}
                  >
                    <PlayIcon aria-hidden="true" className="dock-launchpad-script-icon" />
                    <span className="dock-launchpad-script-name">{suggestion.name}</span>
                    <code title={suggestion.detail}>{suggestion.detail}</code>
                  </button>
                  <button
                    type="button"
                    className="dock-launchpad-script-save"
                    onClick={() =>
                      onSaveCommand({
                        label: suggestion.name,
                        command: suggestion.command,
                        run: false,
                      })
                    }
                    aria-label={`Save ${suggestion.name} as a preset`}
                    title="Save as a preset"
                  >
                    <BookmarkPlusIcon aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="dock-launchpad-actions">
          <button type="button" onClick={onNewTerminal} aria-label="Open a terminal">
            <SquareTerminalIcon aria-hidden="true" />
            <span>
              <strong>Open a terminal</strong>
              <small>A shell in {directory}</small>
            </span>
          </button>
          <button type="button" onClick={onAdd} aria-label="Create a preset">
            <ListPlusIcon aria-hidden="true" />
            <span>
              <strong>Create a preset</strong>
              <small>Commands, a preview URL, dependencies</small>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
