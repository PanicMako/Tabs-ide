import "./setup-typography.css";
import "./wallpaper-gallery.css";
import {
  CheckIcon,
  DicesIcon,
  PlusIcon,
  PowerOffIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { SegmentedControl } from "../ui/segmented-control";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { WallpaperImportDialog } from "./WallpaperImportDialog";
import {
  WALLPAPERS,
  WALLPAPER_CATEGORIES,
  getCustomWallpapers,
  removeCustomWallpaper,
  type WallpaperCategory,
  type WallpaperOption,
} from "./wallpapers";

export interface WallpaperGalleryModalProps {
  readonly isOpen: boolean;
  /** Keep a wizard-owned portal on its fixed setup typeface. */
  readonly setupTypography?: boolean;
  readonly activeWallpaperUrl: string;
  readonly threadId?: string | null;
  readonly isThreadSpecific?: boolean;
  readonly theme?: "light" | "dark";
  readonly onSelectWallpaper: (wallpaper: WallpaperOption, scope: "global" | "thread") => void;
  readonly onClearThreadWallpaper?: () => void;
  readonly onClose: () => void;
  readonly onDisableWallpaper?: () => void;
  readonly onPlaySound?: () => void;
  /** Optional subset of curated scenes, used by setup. */
  readonly wallpapers?: readonly WallpaperOption[];
}

export function WallpaperGalleryModal({
  isOpen,
  setupTypography = false,
  activeWallpaperUrl,
  threadId = null,
  isThreadSpecific = false,
  theme,
  onSelectWallpaper,
  onClearThreadWallpaper,
  onClose,
  onDisableWallpaper,
  onPlaySound,
  wallpapers = WALLPAPERS,
}: WallpaperGalleryModalProps) {
  const [category, setCategory] = useState<WallpaperCategory>("All");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"thread" | "global">(threadId ? "thread" : "global");
  const [showImport, setShowImport] = useState(false);
  const [imported, setImported] = useState<WallpaperOption[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const importOpener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setScope(threadId ? "thread" : "global");
  }, [threadId]);

  useEffect(() => {
    if (!isOpen) {
      setCategory("All");
      setQuery("");
      setShowImport(false);
    }
  }, [isOpen]);

  const scenes = [
    ...imported.filter(({ id }) => !wallpapers.some((wallpaper) => wallpaper.id === id)),
    ...wallpapers,
  ];
  const active = scenes.find((wallpaper) => wallpaper.url === activeWallpaperUrl);
  const categories = WALLPAPER_CATEGORIES.filter(
    (value) =>
      value === "All" || value === "Custom" || scenes.some((scene) => scene.category === value),
  );
  const search = query.trim().toLowerCase();
  const results = scenes.filter(
    (scene) =>
      (category === "All" || scene.category === category) &&
      (!search ||
        [scene.label, scene.description, scene.category].some((value) =>
          value.toLowerCase().includes(search),
        )),
  );

  const selectScene = (scene: WallpaperOption) => {
    onSelectWallpaper(scene, scope);
    onPlaySound?.();
  };

  const shuffle = () => {
    const otherScenes = scenes.filter(({ url }) => url !== activeWallpaperUrl);
    const random = otherScenes[Math.floor(Math.random() * otherScenes.length)] ?? scenes[0];
    if (random) selectScene(random);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile={false}
        initialFocus={heading}
        backdropClassName="bg-black/50 backdrop-blur-none"
        className={cn(
          "wallpaper-gallery max-w-6xl overflow-hidden bg-background",
          setupTypography && "setup-typography",
        )}
        style={{ colorScheme: theme }}
      >
        <header className="wallpaper-gallery-header">
          <div>
            <DialogTitle ref={heading} tabIndex={-1} className="font-sans text-xl outline-none">
              Wallpaper Gallery
            </DialogTitle>
            <DialogDescription className="mt-1">
              {setupTypography
                ? "Choose a scene for your setup."
                : "Choose a background for your agent workspace."}
            </DialogDescription>
          </div>
          <Button size="icon" variant="ghost" aria-label="Close gallery" onClick={onClose}>
            <XIcon aria-hidden="true" />
          </Button>
        </header>

        <div className="wallpaper-gallery-scroll">
          <div className={cn("wallpaper-gallery-layout", active && "has-current")}>
            {active && (
              <figure className="wallpaper-gallery-current">
                <img
                  src={active.url}
                  alt=""
                  className="aspect-video w-full rounded-xl bg-muted object-cover"
                />
                <figcaption className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Current wallpaper
                  </span>
                  <span className="wrap-anywhere text-base font-semibold">{active.label}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {active.description}
                  </span>
                </figcaption>
              </figure>
            )}
            <section aria-label="Browse wallpapers" className="wallpaper-gallery-library">
              <div className="wallpaper-gallery-filters">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon
                    className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    aria-label="Search wallpapers"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search wallpapers"
                    className="w-full ps-9"
                  />
                </div>
                <Select
                  value={category}
                  items={categories.map((value) => ({
                    value,
                    label: value === "All" ? "All categories" : value,
                  }))}
                  onValueChange={(value) => {
                    if (value) {
                      setCategory(value);
                      onPlaySound?.();
                    }
                  }}
                >
                  <SelectTrigger aria-label="Wallpaper category" className="min-w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup
                    align="end"
                    className={setupTypography ? "setup-typography" : undefined}
                  >
                    {categories.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value === "All" ? "All categories" : value}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button ref={importOpener} variant="outline" onClick={() => setShowImport(true)}>
                  <PlusIcon aria-hidden="true" /> Add Custom
                </Button>
              </div>

              {threadId && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                  <SegmentedControl
                    size="sm"
                    aria-label="Apply wallpaper to"
                    value={scope}
                    onValueChange={setScope}
                    options={[
                      { value: "thread", label: "This thread" },
                      { value: "global", label: "Workspace" },
                    ]}
                  />
                  {isThreadSpecific && onClearThreadWallpaper && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onClearThreadWallpaper();
                        onClose();
                      }}
                    >
                      <RotateCcwIcon aria-hidden="true" /> Use workspace wallpaper
                    </Button>
                  )}
                </div>
              )}

              <p className="my-3 text-xs text-muted-foreground" aria-live="polite">
                {results.length} {results.length === 1 ? "wallpaper" : "wallpapers"}
              </p>
              {results.length ? (
                <ul aria-label="Wallpaper results" className="wallpaper-gallery-results">
                  {results.map((scene) => {
                    const selected = scene.url === activeWallpaperUrl;
                    return (
                      <li key={scene.id} className="relative min-w-0">
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => selectScene(scene)}
                          className={cn("wallpaper-gallery-tile", scene.isCustom && "has-delete")}
                          title={scene.label}
                        >
                          <img src={scene.url} alt="" loading="lazy" />
                          <span className="flex items-center gap-1.5">
                            <span className="truncate">{scene.label}</span>
                            {selected && (
                              <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
                            )}
                          </span>
                        </button>
                        {scene.isCustom && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Delete ${scene.label}`}
                            className="absolute end-0.5 bottom-0 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              removeCustomWallpaper(scene.id);
                              if (!getCustomWallpapers().some(({ id }) => id === scene.id)) {
                                setImported((previous) =>
                                  previous.filter(({ id }) => id !== scene.id),
                                );
                              }
                            }}
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-xl border border-border bg-card p-5">
                  <p className="text-sm font-medium">
                    {category === "Custom" && !search
                      ? "No custom wallpapers yet"
                      : "No matching wallpapers"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {category === "Custom" && !search
                      ? "Use Add Custom to bring in your own image."
                      : "Try another search or category."}
                  </p>
                  {(search || category !== "All") && (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setQuery("");
                        setCategory("All");
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="wallpaper-gallery-footer">
          <p className="text-xs text-muted-foreground">
            {setupTypography
              ? "Select a scene to preview it in setup."
              : scope === "thread"
                ? "Selection applies to this thread."
                : "Selection updates the workspace wallpaper."}
          </p>
          <div className="flex flex-wrap gap-2">
            {onDisableWallpaper && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onDisableWallpaper();
                  onClose();
                }}
              >
                <PowerOffIcon aria-hidden="true" /> Turn off
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={shuffle} disabled={scenes.length === 0}>
              <DicesIcon aria-hidden="true" /> Shuffle
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        </footer>
      </DialogPopup>

      <WallpaperImportDialog
        isOpen={isOpen && showImport}
        onClose={() => setShowImport(false)}
        onImport={(scene) => {
          setImported((previous) => [scene, ...previous]);
          setCategory("Custom");
          setQuery("");
          selectScene(scene);
        }}
        finalFocus={importOpener}
        setupTypography={setupTypography}
      />
    </Dialog>
  );
}
