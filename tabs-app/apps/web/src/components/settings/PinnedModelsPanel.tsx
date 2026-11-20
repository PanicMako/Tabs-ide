import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  BotIcon,
  CheckIcon,
  GripVerticalIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  PROVIDER_DISPLAY_NAMES,
  type ServerProvider,
  type ServerProviderModel,
  type UnifiedSettings,
} from "@tabs/contracts";
import {
  AntigravityIcon,
  ClaudeAI,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  FxIcon,
  GrokIcon,
  KiloIcon,
  KiroIcon,
  MuseIcon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
  PiIcon,
} from "~/components/Icons";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogViewport,
} from "~/components/ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { OrbitGroup } from "../ui/orbit-group";
import {
  getPinnedModels,
  isPinnedModel,
  reorderPinnedModels,
  togglePinnedModel,
} from "~/modelPinning";
import { getDefaultServerModel, getProviderModels } from "~/providerModels";
import { getSurfacePreset, playSurfaceExit } from "~/lib/motion";
import { useGsapEnter } from "~/hooks/useGsapSurface";
import { useSurfaceMotionSettings } from "~/panelAnimations";
import { cn } from "~/lib/utils";
import "./pinnedModels.css";

export const PROVIDER_ICONS_BY_KIND: Record<string, any> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  copilot: CopilotIcon,
  grok: GrokIcon,
  kiro: KiroIcon,
  fx: FxIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
  droid: DroidIcon,
  antigravity: AntigravityIcon,
  openrouter: OpenRouterIcon,
  pi: PiIcon,
  muse: MuseIcon,
};

/** How many one-click suggestions the empty state offers. */
const MAX_SUGGESTIONS = 4;

export interface PinnedModelsProvider {
  readonly provider: string;
  readonly title: string;
  readonly enabled: boolean;
}

interface PinnedModelsPanelProps {
  serverProviders: ReadonlyArray<ServerProvider>;
  settings: Partial<UnifiedSettings> | null | undefined;
  updateSettings: (next: Partial<UnifiedSettings>) => void;
  /** In the order the user arranged the provider directory. */
  providers: ReadonlyArray<PinnedModelsProvider>;
}

function providerName(provider: string, fallback?: string): string {
  return (
    PROVIDER_DISPLAY_NAMES[provider as keyof typeof PROVIDER_DISPLAY_NAMES] ?? fallback ?? provider
  );
}

const pinKey = (provider: string, model: string) => `${provider}:${model}`;

/**
 * Pinned models are the shortcuts shown first in the model picker, across
 * providers, in the order kept here.
 */
export function PinnedModelsPanel({
  serverProviders,
  settings,
  updateSettings,
  providers,
}: PinnedModelsPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pinned = getPinnedModels(settings);
  const motion = useSurfaceMotionSettings();
  const rowNodes = useRef(new Map<string, HTMLElement>());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Stable, so a row's ref (and its entrance) never changes on re-render.
  const registerRow = useCallback((key: string, node: HTMLElement | null) => {
    if (node) rowNodes.current.set(key, node);
    else rowNodes.current.delete(key);
  }, []);

  const unpin = (provider: string, model: string) => {
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      updateSettings({ pinnedModels: togglePinnedModel(settings, provider, model) as any });
    };
    const node = rowNodes.current.get(pinKey(provider, model));
    const spec = getSurfacePreset("panel");
    const exit =
      node && motion.active
        ? playSurfaceExit(node, spec, { seconds: motion.seconds, profile: motion.profile })
        : null;
    if (!exit) {
      commit();
      return;
    }
    void exit.tween.then(commit);
    // A killed tween never resolves; the row must still go.
    setTimeout(commit, motion.seconds(spec.exitDuration) * 1000 + 120);
  };

  const suggestions = useMemo(() => {
    const picks: Array<{ provider: string; model: ServerProviderModel }> = [];
    for (const entry of providers) {
      if (!entry.enabled || picks.length >= MAX_SUGGESTIONS) continue;
      const slug = getDefaultServerModel(serverProviders, entry.provider);
      const model = getProviderModels(serverProviders, entry.provider).find((m) => m.slug === slug);
      if (model && !isPinnedModel(pinned, entry.provider, model.slug))
        picks.push({ provider: entry.provider, model });
    }
    return picks;
  }, [pinned, providers, serverProviders]);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = pinned.findIndex((entry) => pinKey(entry.provider, entry.model) === active.id);
    const to = pinned.findIndex((entry) => pinKey(entry.provider, entry.model) === over.id);
    if (from === -1 || to === -1) return;
    updateSettings({ pinnedModels: reorderPinnedModels(settings?.pinnedModels, from, to) as any });
  };

  return (
    <section className="pinned-models" aria-labelledby="pinned-models-title">
      <header className="pinned-models-header">
        <div className="pinned-models-heading">
          <h3 id="pinned-models-title" className="pinned-models-title">
            Pinned models
          </h3>
          <p className="pinned-models-description">
            {pinned.length > 0
              ? "Shown first in the model picker, in this order. Drag to rearrange."
              : "Pin the models you reach for most and they sit at the top of the model picker."}
          </p>
        </div>
        <div className="pinned-models-actions">
          {pinned.length > 0 ? (
            <span className="pinned-models-count">{pinned.length} pinned</span>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            className="gap-1.5"
            onClick={() => setPickerOpen(true)}
          >
            <PlusIcon className="size-3.5" aria-hidden />
            Pin a model
          </Button>
        </div>
      </header>

      {pinned.length === 0 ? (
        suggestions.length > 0 ? (
          <div className="pinned-models-suggestions" aria-label="Suggested models">
            <span className="pinned-models-suggestions-label">Suggested</span>
            {suggestions.map(({ provider, model }) => {
              const Icon = PROVIDER_ICONS_BY_KIND[provider] ?? BotIcon;
              return (
                <Button
                  key={pinKey(provider, model.slug)}
                  size="xs"
                  variant="ghost"
                  className="pinned-models-suggestion gap-1.5"
                  aria-label={`Pin ${model.name} from ${providerName(provider)}`}
                  onClick={() =>
                    updateSettings({
                      pinnedModels: togglePinnedModel(settings, provider, model.slug) as any,
                    })
                  }
                >
                  <Icon
                    className="provider-brand-icon size-3.5"
                    data-provider={provider}
                    aria-hidden
                  />
                  {model.name}
                  <PlusIcon className="size-3 text-muted-foreground" aria-hidden />
                </Button>
              );
            })}
          </div>
        ) : null
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={pinned.map((entry) => pinKey(entry.provider, entry.model))}
            strategy={verticalListSortingStrategy}
          >
            <ol className="pinned-models-list">
              {pinned.map((entry, index) => {
                const key = pinKey(entry.provider, entry.model);
                const model = getProviderModels(serverProviders, entry.provider).find(
                  (candidate) => candidate.slug === entry.model,
                );
                return (
                  <PinnedModelRow
                    key={key}
                    id={key}
                    position={index + 1}
                    provider={entry.provider}
                    providerLabel={providerName(entry.provider)}
                    name={model?.name ?? entry.model}
                    slug={entry.model}
                    available={model !== undefined}
                    registerRow={registerRow}
                    onUnpin={() => unpin(entry.provider, entry.model)}
                  />
                );
              })}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <PinModelPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        serverProviders={serverProviders}
        settings={settings}
        updateSettings={updateSettings}
        providers={providers}
      />
    </section>
  );
}

function PinnedModelRow({
  id,
  position,
  provider,
  providerLabel,
  name,
  slug,
  available,
  registerRow,
  onUnpin,
}: {
  id: string;
  position: number;
  provider: string;
  providerLabel: string;
  name: string;
  slug: string;
  available: boolean;
  registerRow: (key: string, node: HTMLElement | null) => void;
  onUnpin: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const setRow = useCallback(
    (node: HTMLLIElement | null) => {
      setNodeRef(node);
      registerRow(id, node);
    },
    [id, registerRow, setNodeRef],
  );
  const enterRef = useGsapEnter<HTMLLIElement>("panel", setRow);
  const Icon = PROVIDER_ICONS_BY_KIND[provider] ?? BotIcon;
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <li
      ref={enterRef}
      style={style}
      className="pinned-model-row"
      data-dragging={isDragging || undefined}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="pinned-model-handle"
        aria-label={`Reorder ${name}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon size={14} aria-hidden />
      </button>
      <span className="pinned-model-position" aria-hidden>
        {position}
      </span>
      <Icon
        className="provider-brand-icon pinned-model-icon"
        data-provider={provider}
        aria-hidden
      />
      <span className="pinned-model-text">
        <span className="pinned-model-name">{name}</span>
        <span className="pinned-model-provider">
          {providerLabel}
          {available ? null : " · not available right now"}
        </span>
      </span>
      <code className="pinned-model-slug" title={slug}>
        {slug}
      </code>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              className="pinned-model-unpin"
              aria-label={`Unpin ${name}`}
              onClick={onUnpin}
            >
              <PinOffIcon className="size-3.5" aria-hidden />
            </Button>
          }
        />
        <TooltipPopup side="top">Unpin</TooltipPopup>
      </Tooltip>
    </li>
  );
}

interface PickerModel {
  readonly provider: string;
  readonly providerLabel: string;
  readonly model: ServerProviderModel;
}

/** Search every provider's models and pin or unpin them in place. */
function PinModelPicker({
  open,
  onOpenChange,
  serverProviders,
  settings,
  updateSettings,
  providers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverProviders: ReadonlyArray<ServerProvider>;
  settings: Partial<UnifiedSettings> | null | undefined;
  updateSettings: (next: Partial<UnifiedSettings>) => void;
  providers: ReadonlyArray<PinnedModelsProvider>;
}) {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const pinned = getPinnedModels(settings);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: Array<{ provider: string; label: string; models: PickerModel[] }> = [];
    for (const entry of providers) {
      if (providerFilter && entry.provider !== providerFilter) continue;
      const label = providerName(entry.provider, entry.title);
      const models = getProviderModels(serverProviders, entry.provider)
        .filter(
          (model) =>
            !q ||
            model.name.toLowerCase().includes(q) ||
            model.slug.toLowerCase().includes(q) ||
            label.toLowerCase().includes(q),
        )
        .map((model) => ({ provider: entry.provider, providerLabel: label, model }));
      if (models.length > 0) result.push({ provider: entry.provider, label, models });
    }
    return result;
  }, [providerFilter, providers, query, serverProviders]);

  const providersWithModels = providers.filter(
    (entry) => getProviderModels(serverProviders, entry.provider).length > 0,
  );
  const resultCount = groups.reduce((sum, group) => sum + group.models.length, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup showCloseButton={false} className="pin-picker w-full max-w-xl p-0 my-auto">
            <div className="pin-picker-search">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models across providers…"
                aria-label="Search models"
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  className="pin-picker-clear"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <XIcon className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>

            {providersWithModels.length > 1 ? (
              <div className="pin-picker-filters">
                <OrbitGroup
                  className="tabs-segmented inline-flex items-center shrink-0 rounded-full"
                  role="group"
                  aria-label="Provider filter"
                >
                  {[{ provider: null as string | null, title: "All" }, ...providersWithModels].map(
                    (entry) => {
                      const selected = providerFilter === entry.provider;
                      return (
                        <button
                          key={entry.provider ?? "all"}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setProviderFilter(selected ? null : entry.provider)}
                          className={cn(
                            "px-2.5 py-1 text-xs whitespace-nowrap cursor-pointer",
                            selected
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {entry.provider ? providerName(entry.provider, entry.title) : "All"}
                        </button>
                      );
                    },
                  )}
                </OrbitGroup>
              </div>
            ) : null}

            <div className="pin-picker-results" role="list" aria-label="Models">
              {groups.length === 0 ? (
                <p className="pin-picker-empty" role="status">
                  {query ? `No models match “${query.trim()}”.` : "No models are available yet."}
                </p>
              ) : (
                groups.map((group) => {
                  const Icon = PROVIDER_ICONS_BY_KIND[group.provider] ?? BotIcon;
                  return (
                    <div key={group.provider} className="pin-picker-group" role="presentation">
                      <div className="pin-picker-group-label">
                        <Icon
                          className="provider-brand-icon size-3.5"
                          data-provider={group.provider}
                          aria-hidden
                        />
                        {group.label}
                      </div>
                      {group.models.map(({ provider, model }) => {
                        const isPinned = isPinnedModel(pinned, provider, model.slug);
                        return (
                          <button
                            key={pinKey(provider, model.slug)}
                            type="button"
                            role="listitem"
                            aria-pressed={isPinned}
                            className="pin-picker-row"
                            onClick={() =>
                              updateSettings({
                                pinnedModels: togglePinnedModel(
                                  settings,
                                  provider,
                                  model.slug,
                                ) as any,
                              })
                            }
                          >
                            <span className="pin-picker-row-text">
                              <span className="pin-picker-row-name">{model.name}</span>
                              <code className="pin-picker-row-slug">{model.slug}</code>
                            </span>
                            <span
                              className="pin-picker-row-state"
                              data-pinned={isPinned || undefined}
                            >
                              {isPinned ? (
                                <>
                                  <CheckIcon className="size-3.5" aria-hidden />
                                  Pinned
                                </>
                              ) : (
                                <>
                                  <PinIcon className="size-3.5" aria-hidden />
                                  Pin
                                </>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            <footer className="pin-picker-footer">
              <span>
                {pinned.length} pinned
                {query ? ` · ${resultCount} ${resultCount === 1 ? "result" : "results"}` : ""}
              </span>
              <Button size="xs" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </footer>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
}
