import {
  ArrowRightIcon,
  GlobeIcon,
  HistoryIcon,
  HouseIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import {
  displayAddress,
  recentBrowserPages,
  resolveOmniboxInput,
  resolveSavedLocalInput,
} from "./browserOmnibox";
import { useBrowserLocalsStore } from "~/stores/browserLocalsStore";

const LOCAL_PORTS = [3000, 5173, 8080, 4321] as const;

/**
 * A new browser tab. Nothing loads until you say where to go: one field takes an address, a
 * localhost port or a search, with the project's home page and pages from other tabs beneath it.
 */
export function BrowserStartPage({
  surfaceId,
  projectName,
  homeUrl,
  onStart,
}: {
  surfaceId: string;
  projectName?: string | undefined;
  homeUrl?: string | undefined;
  onStart: (url: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const workspaces = useCompanionSurfaceStore((state) => state.workspaces);
  const recents = recentBrowserPages(workspaces, surfaceId);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  const go = (input: string) => {
    try {
      onStart(resolveOmniboxInput(input));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const home = homeUrl && !/^https?:\/\/(www\.)?google\.com\/?$/i.test(homeUrl) ? homeUrl : null;
  return (
    <div className="browser-start">
      <div className="browser-start-inner">
        <p className="browser-start-eyebrow">New tab{projectName ? ` · ${projectName}` : ""}</p>
        <form
          className="browser-start-field"
          data-invalid={!!error}
          onSubmit={(event) => {
            event.preventDefault();
            go(value);
          }}
        >
          <SearchIcon aria-hidden="true" size={16} />
          <input
            ref={field}
            aria-label="Search or enter address"
            aria-describedby="browser-start-hint"
            placeholder="Search or enter address"
            spellCheck={false}
            autoComplete="off"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          <button type="submit" aria-label="Go" disabled={!value.trim()}>
            <ArrowRightIcon aria-hidden="true" size={15} />
          </button>
        </form>
        <p
          id="browser-start-hint"
          className="browser-start-hint"
          role={error ? "alert" : undefined}
        >
          {error ?? "Type a port such as 5173 to open localhost."}
        </p>

        <LocalPages home={home} onStart={onStart} />

        {recents.length > 0 && (
          <section className="browser-start-section" aria-label="Open elsewhere">
            <h3>Open in other tabs</h3>
            <ul className="browser-start-recents">
              {recents.map((page) => (
                <li key={page.url}>
                  <button type="button" onClick={() => onStart(page.url)} title={page.url}>
                    <span className="browser-start-mono" aria-hidden="true">
                      {displayAddress(page.url).charAt(0).toUpperCase() || <GlobeIcon size={12} />}
                    </span>
                    <span className="browser-start-recent-title">{page.title}</span>
                    <span className="browser-start-recent-host">
                      {displayAddress(page.url).split("/")[0]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {recents.length === 0 && (
          <p className="browser-start-empty">
            <HistoryIcon aria-hidden="true" size={13} />
            Pages you open in other tabs show up here.
          </p>
        )}
      </div>
    </div>
  );
}

/** Saved local addresses, one click each. The plus saves a port or address for next time. */
function LocalPages({ home, onStart }: { home: string | null; onStart: (url: string) => void }) {
  const pages = useBrowserLocalsStore((state) => state.pages);
  const add = useBrowserLocalsStore((state) => state.add);
  const remove = useBrowserLocalsStore((state) => state.remove);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = () => {
    try {
      add(resolveSavedLocalInput(draft));
      setDraft("");
      setProblem(null);
      setAdding(false);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <section className="browser-start-section" aria-label="Local">
      <div className="browser-start-section-head">
        <h3>Local</h3>
        <button
          type="button"
          className="browser-start-add"
          aria-label="Save a local address"
          title="Save a local address"
          aria-expanded={adding}
          onClick={() => {
            setAdding(!adding);
            setProblem(null);
          }}
        >
          <PlusIcon aria-hidden="true" size={13} />
        </button>
      </div>
      {adding && (
        <form
          className="browser-start-save"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            autoFocus
            aria-label="Port or address to save"
            placeholder="5173 or localhost:3000/admin"
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAdding(false);
            }}
          />
          <button type="submit" disabled={!draft.trim()}>
            Save
          </button>
        </form>
      )}
      {problem && (
        <p role="alert" className="browser-start-hint">
          {problem}
        </p>
      )}
      <div className="browser-start-ports">
        {home && (
          <button type="button" onClick={() => onStart(home)} title={home}>
            <HouseIcon aria-hidden="true" size={13} />
            {displayAddress(home)}
          </button>
        )}
        {pages.map((page) => (
          <span key={page.url} className="browser-start-saved">
            <button type="button" onClick={() => onStart(page.url)} title={page.url}>
              {displayAddress(page.url).replace(/^localhost(?=:)/, "")}
            </button>
            <button
              type="button"
              className="browser-start-unsave"
              aria-label={`Remove ${displayAddress(page.url)}`}
              title="Remove"
              onClick={() => remove(page.url)}
            >
              <XIcon aria-hidden="true" size={11} />
            </button>
          </span>
        ))}
        {pages.length === 0 &&
          LOCAL_PORTS.map((port) => (
            <button
              key={port}
              type="button"
              onClick={() => onStart(`http://localhost:${port}/`)}
              title={`http://localhost:${port}`}
            >
              :{port}
            </button>
          ))}
      </div>
    </section>
  );
}
