import { useId, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
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
  const [editor, setEditor] = useState<SavedFontMix | "new" | null>(null);
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
  let nextName = "Personal Signal";
  for (let index = 2; mixes.some((mix) => mix.name === nextName); index++)
    nextName = `Personal Signal ${index}`;
  const openEditor = (mix: SavedFontMix | "new") => {
    setError("");
    setEditor(mix);
  };
  return (
    <>
      <div className="mx-4 mb-4 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-xs font-semibold">
            Your collection <span className="text-muted-foreground">· {mixes.length}</span>
          </h4>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-[11px] text-muted-foreground">
              Saved on this device
            </span>
            {mixes.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  openEditor(mixes.find((mix) => matchesFontMix(fonts, mix)) ?? mixes[0]!)
                }
              >
                Edit
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => openEditor("new")}>
              <PlusIcon className="size-3.5" /> New mix
            </Button>
          </div>
        </div>
        {mixes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Create and save your own font combinations. Each mix stays in your collection.
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {mixes.map((mix) => {
            const active = matchesFontMix(fonts, mix);
            return (
              <div
                data-shape="preview"
                key={mix.id}
                className={`rounded-xl border ${active ? "border-primary/60 bg-primary/5" : "border-border/60 bg-card/40"}`}
              >
                <button
                  data-shape="preview"
                  type="button"
                  aria-label={`Apply ${mix.name}`}
                  aria-pressed={active}
                  onClick={() => onChange({ ...fonts, ...mix.fonts })}
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
                <div className="flex justify-end gap-1 px-2 pb-2">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit ${mix.name}`}
                    onClick={() => openEditor(mix)}
                  >
                    <PencilIcon className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${mix.name}`}
                    onClick={() => persist(mixes.filter((item) => item.id !== mix.id))}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {(showMixer || editor !== null) && (
        <TypographyMixDialog
          initialMix={editor && editor !== "new" ? editor : undefined}
          fonts={fonts}
          defaultName={nextName}
          error={error}
          onClose={() => {
            setEditor(null);
            setError("");
            onCloseMixer?.();
          }}
          onApply={onChange}
          onSave={(mix) => {
            const exists = mixes.some((saved) => saved.id === mix.id);
            return persist(
              exists ? mixes.map((saved) => (saved.id === mix.id ? mix : saved)) : [...mixes, mix],
            );
          }}
        />
      )}
      {error && !showMixer && editor === null && (
        <p role="alert" className="mx-4 mb-4 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function TypographyMixDialog({
  initialMix,
  fonts,
  defaultName,
  error,
  onClose,
  onApply,
  onSave,
}: {
  initialMix?: SavedFontMix | undefined;
  fonts: FontPreferences;
  defaultName: string;
  error: string;
  onClose: () => void;
  onApply: (fonts: FontPreferences) => void;
  onSave: (mix: SavedFontMix) => boolean;
}) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState(() => ({ ...fonts, ...initialMix?.fonts }));
  const [name, setName] = useState(initialMix?.name ?? defaultName);
  const nameId = useId();
  const returnFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const save = (asNew = false) => {
    if (!name.trim()) return;
    const mix = {
      id: !asNew && initialMix ? initialMix.id : crypto.randomUUID(),
      name: name.trim(),
      fonts: captureFontMix(draft),
    };
    if (onSave(mix)) {
      onApply(draft);
      setOpen(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogPopup className="max-w-3xl" bottomStickOnMobile={false} finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>{initialMix ? "Edit typography mix" : "Create typography mix"}</DialogTitle>
          <DialogDescription>
            Choose fonts for each role. Save multiple mixes and switch between them from your
            collection.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogPanel className="space-y-4">
            <div
              data-shape="preview"
              className="rounded-xl border border-border/60 bg-muted/20 px-4 pb-3"
            >
              <FontMixSpecimen
                mix={{
                  id: "preview",
                  name: name.trim() || "Your mix",
                  fonts: captureFontMix(draft),
                }}
                fonts={draft}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={nameId} className="block text-xs font-semibold">
                Name your mix
              </label>
              <Input
                id={nameId}
                autoFocus
                maxLength={48}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <TypographyMixer fonts={draft} onChange={setDraft} embedded />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {initialMix ? (
              <Button
                type="button"
                variant="outline"
                disabled={!name.trim()}
                onClick={() => save(true)}
              >
                Save as new mix
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onApply(draft);
                  setOpen(false);
                }}
              >
                Apply without saving
              </Button>
            )}
            <Button type="submit" disabled={!name.trim()}>
              Save mix
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
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
