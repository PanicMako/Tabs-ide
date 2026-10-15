import { useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { type FontPreferences, resolveFontTypography } from "../../lib/themes";
import {
  captureFontMix,
  matchesFontMix,
  readSavedFontMixes,
  SAVED_FONT_MIXES_KEY,
  type SavedFontMix,
} from "../../lib/savedFontMixes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { TypographyMixer } from "./TypographyMixer";

export function SavedTypography({
  fonts,
  onChange,
  showMixer,
  onCloseMixer,
}: {
  fonts: FontPreferences;
  onChange: (fonts: FontPreferences) => void;
  showMixer: boolean;
  onCloseMixer?: () => void;
}) {
  const [mixes, setMixes] = useState(readSavedFontMixes);
  const [editing, setEditing] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [targetMixId, setTargetMixId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const persist = (next: SavedFontMix[]) => {
    try {
      localStorage.setItem(SAVED_FONT_MIXES_KEY, JSON.stringify(next));
      setMixes(next);
      setError("");
      return true;
    } catch {
      setError("This mix could not be saved. Your browser storage may be full.");
      return false;
    }
  };
  const startSave = () => {
    const active = managing ? mixes.find((mix) => mix.id === targetMixId) : undefined;
    setName(active?.name ?? `Personal Signal${mixes.length ? ` ${mixes.length + 1}` : ""}`);
    setEditing(active?.id ?? "new");
  };
  return (
    <>
      {mixes.length > 0 && (
        <div className="mx-4 mb-4 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold">
              Your collection <span className="text-muted-foreground">· {mixes.length}</span>
            </h4>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground">Saved on this device</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={managing}
                onClick={() => {
                  setManaging(!managing);
                  setTargetMixId(
                    managing ? null : (mixes.find((mix) => matchesFontMix(fonts, mix))?.id ?? null),
                  );
                  setEditing(null);
                  onCloseMixer?.();
                }}
              >
                {managing ? "Done" : "Edit"}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {mixes.map((mix) => {
              const active = matchesFontMix(fonts, mix);

              return (
                <div
                  key={mix.id}
                  className={`rounded-xl border ${active ? "border-primary bg-primary/5" : "border-border/60 bg-card/40"}`}
                >
                  <button
                    type="button"
                    aria-label={`Apply ${mix.name}`}
                    aria-pressed={active}
                    onClick={() => {
                      onChange({ ...fonts, ...mix.fonts });
                      setManaging(false);
                      setEditing(null);
                      onCloseMixer?.();
                    }}
                    className="relative w-full text-left p-3.5 rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {active && <CheckIcon className="absolute right-3 top-3 size-3.5" />}
                    <FontMixSpecimen mix={mix} fonts={fonts} />
                    <p className="mt-3 text-xs font-semibold truncate">{mix.name}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground truncate">
                      {mix.fonts.headingFont.split(",")[0]?.replaceAll("'", "")} +{" "}
                      {mix.fonts.uiFont.split(",")[0]?.replaceAll("'", "")}
                    </p>
                  </button>
                  {managing && (
                    <div className="flex justify-end gap-1 px-2 pb-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Rename ${mix.name}`}
                        onClick={() => {
                          onChange({ ...fonts, ...mix.fonts });
                          setTargetMixId(mix.id);
                          setEditing(mix.id);
                          setName(mix.name);
                        }}
                      >
                        <PencilIcon className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${mix.name}`}
                        onClick={() => {
                          const next = mixes.filter((item) => item.id !== mix.id);
                          if (persist(next) && next.length === 0) {
                            setManaging(false);
                            onCloseMixer?.();
                          }
                          if (editing === mix.id) setEditing(null);
                        }}
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {(showMixer || managing) && (
        <TypographyMixer fonts={fonts} onChange={onChange} onSave={startSave} />
      )}
      {editing && (
        <form
          className="mx-4 mb-4 rounded-xl border border-border p-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            const next =
              editing === "new"
                ? [
                    ...mixes,
                    { id: crypto.randomUUID(), name: trimmed, fonts: captureFontMix(fonts) },
                  ]
                : mixes.map((mix) =>
                    mix.id === editing
                      ? { ...mix, name: trimmed, fonts: captureFontMix(fonts) }
                      : mix,
                  );
            if (persist(next)) {
              setEditing(null);
              setManaging(false);
              onCloseMixer?.();
            }
          }}
        >
          <div className="flex-1 min-w-40">
            <label htmlFor="font-mix-name" className="block text-xs font-semibold mb-2">
              Name your mix
            </label>
            <Input
              id="font-mix-name"
              autoFocus
              maxLength={48}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!name.trim()}>
            Save mix
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mx-4 mb-4 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

/** Fit complete words to the card rather than wrapping wide display faces mid-word. */
function FontMixSpecimen({ mix, fonts }: { mix: SavedFontMix; fonts: FontPreferences }) {
  const container = useRef<HTMLDivElement>(null);
  const typography = resolveFontTypography({ ...fonts, ...mix.fonts });
  const words = mix.name.split(/\s+/);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      for (const line of element.querySelectorAll<HTMLElement>("[data-specimen-line]")) {
        line.style.fontSize = "28px";
        const naturalWidth = line.scrollWidth;
        if (naturalWidth > line.clientWidth && line.clientWidth > 0)
          line.style.fontSize = `${(28 * line.clientWidth) / naturalWidth}px`;
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, [
    mix.name,
    mix.fonts.headingFont,
    mix.fonts.sectionFont,
    typography.headingWeight,
    typography.sectionWeight,
  ]);
  return (
    <div ref={container} className="min-h-16 leading-tight pr-1 pt-3" aria-hidden="true">
      <span
        data-specimen-line
        className="block whitespace-nowrap"
        style={{ fontFamily: mix.fonts.headingFont, fontWeight: typography.headingWeight }}
      >
        {words[0]}
      </span>
      <span
        data-specimen-line
        className="block whitespace-nowrap"
        style={{
          fontFamily: mix.fonts.sectionFont,
          fontWeight: typography.sectionWeight,
          fontStyle: typography.sectionStyle,
        }}
      >
        {words.slice(1).join(" ") || "mix"}
      </span>
    </div>
  );
}
