import type { EnvironmentSpeechModel } from "@tabs/contracts";
import { CheckIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { type ModelView, modelFacts, visibleModels } from "./speechModelPicker.logic";
import "./voice-settings.css";

const INITIAL_ROWS = 6;

type ModelAction = "download" | "select" | "remove";

function ModelRow(props: {
  readonly model: EnvironmentSpeechModel;
  readonly language: string;
  readonly busy: boolean;
  readonly onAction: (action: ModelAction) => void;
}) {
  const { model, language, busy, onAction } = props;
  const downloading = model.state === "downloading";
  const progress =
    downloading && model.downloaded !== undefined && model.size > 0
      ? Math.min(100, Math.round((model.downloaded / model.size) * 100))
      : null;
  return (
    <li
      data-slot="speech-model"
      data-active={model.active || undefined}
      className={cn("px-4 py-3 sm:px-5", model.active && "bg-muted/30")}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-foreground">{model.name}</span>
            {model.active ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-foreground">
                <CheckIcon className="size-3" aria-hidden="true" />
                In use
              </span>
            ) : model.recommended ? (
              <span className="shrink-0 text-[11px] text-muted-foreground/80">Recommended</span>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground/80">{model.description}</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            {modelFacts(model, language).join("  ·  ")}
          </p>
          {model.linkedFrom ? (
            <p className="truncate text-[11px] text-muted-foreground/60" title={model.linkedFrom}>
              Used from {model.linkedFrom}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {model.state === "installed" && !model.active ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onAction("select")}
              >
                Use
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("remove")}>
                Remove
              </Button>
            </>
          ) : null}
          {model.state === "downloadable" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAction("download")}
            >
              Download
            </Button>
          ) : null}
          {model.state === "verifying" ? (
            <span className="text-[11px] text-muted-foreground">Checking the download…</span>
          ) : null}
          {downloading ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {progress === null ? "Downloading…" : `${progress}%`}
            </span>
          ) : null}
        </div>
      </div>
      {downloading ? (
        <div
          role="progressbar"
          aria-label={`Downloading ${model.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? undefined}
          className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/10"
        >
          <div
            className="h-full rounded-full bg-foreground/60 transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${progress ?? 8}%` }}
          />
        </div>
      ) : null}
    </li>
  );
}

/** Picks the speech model: what is in use first, then a short filtered list instead of every model. */
export function SpeechModelPicker(props: {
  readonly models: ReadonlyArray<EnvironmentSpeechModel>;
  readonly language: string;
  readonly busyModelId: string | null;
  readonly onAction: (modelId: string, action: ModelAction) => void;
}) {
  const { models, language, busyModelId, onAction } = props;
  const [view, setView] = useState<ModelView>("recommended");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const list = visibleModels(models, { view, query, language });
  const shown = expanded || query ? list : list.slice(0, INITIAL_ROWS);
  const hidden = list.length - shown.length;

  return (
    <div data-slot="speech-model-picker">
      <div className="speech-picker-toolbar">
        <label className="speech-picker-search">
          <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <Input
            unstyled
            aria-label="Search speech models"
            placeholder="Search by name or language"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="speech-picker-search-input"
          />
        </label>
        <div role="tablist" aria-label="Which models to show" className="speech-picker-tabs">
          {(
            [
              { value: "recommended", label: "Recommended" },
              { value: "installed", label: "Downloaded" },
              { value: "all", label: `All ${models.length}` },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={view === option.value}
              className="speech-picker-tab"
              onClick={() => {
                setView(option.value);
                setExpanded(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground/80 sm:px-5">
          {view === "installed"
            ? "Nothing downloaded yet. Pick one from Recommended."
            : "No model matches that search."}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {shown.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              language={language}
              busy={busyModelId === model.id}
              onAction={(action) => onAction(model.id, action)}
            />
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <div className="border-t border-border px-4 py-2 sm:px-5">
          <Button size="xs" variant="ghost" onClick={() => setExpanded(true)}>
            Show {hidden} more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
