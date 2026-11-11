import { useState } from "react";
import {
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  PencilIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsSection } from "./SettingsLayout";
import { QUICK_ACTIONS, type QuickSubAction } from "../quick-actions/actions";

function destination(entry: QuickSubAction) {
  if (!entry.query)
    return entry.actionId === "scratch-browser"
      ? "New blank browser"
      : (QUICK_ACTIONS.find((action) => action.id === entry.actionId)?.label ?? "Run action");
  try {
    return new URL(entry.query).hostname;
  } catch {
    return entry.query;
  }
}
export function QuickSubActionsSettings({
  value,
  onChange,
  parentId,
  embedded = false,
}: {
  value: readonly QuickSubAction[];
  onChange: (value: QuickSubAction[]) => void;
  parentId?: string;
  embedded?: boolean;
}) {
  const [selectedParent, setSelectedParent] = useState("scratch-browser");
  const parent = parentId ?? selectedParent;
  const [dragged, setDragged] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuickSubAction | null>(null);
  const children = value.filter((entry) => entry.parentId === parent);
  const move = (from: string, to: string) => {
    if (from === to) return;
    const entries = [...value],
      start = entries.findIndex((entry) => entry.id === from),
      end = entries.findIndex((entry) => entry.id === to);
    if (start < 0 || end < 0) return;
    const [entry] = entries.splice(start, 1);
    entries.splice(end, 0, entry!);
    onChange(entries);
  };
  const create = () =>
    setDraft({ id: crypto.randomUUID(), parentId: parent, actionId: parent, label: "", query: "" });
  const content = (
    <div className="space-y-3 p-4 sm:px-5">
      {!embedded && (
        <Select
          value={parent}
          onValueChange={(next) => {
            if (next) setSelectedParent(next);
          }}
        >
          <SelectTrigger aria-label="Parent action" className="w-full sm:w-64">
            <SelectValue>{QUICK_ACTIONS.find((action) => action.id === parent)?.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {QUICK_ACTIONS.map((action) => (
              <SelectItem key={action.id} value={action.id}>
                {action.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        These appear in a panel beside this action in the launcher. Drag to reorder, or use the
        arrows.
      </p>
      <div className="divide-y divide-border">
        {children.map((entry, index) => (
          <div
            key={entry.id}
            className="flex items-center gap-2 py-2.5"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged) move(dragged, entry.id);
              setDragged(null);
            }}
          >
            <span
              draggable
              onDragStart={(event) => {
                setDragged(entry.id);
                event.dataTransfer.setData("application/x-tabs-shortcut", entry.id);
              }}
              onDragEnd={() => setDragged(null)}
              className="cursor-grab text-muted-foreground/60"
              aria-hidden="true"
            >
              <GripVerticalIcon className="size-3.5" />
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              aria-label={`Edit ${entry.label}`}
              onClick={() => setDraft({ ...entry })}
            >
              <span className="block truncate text-sm font-medium">
                {entry.label || "Untitled shortcut"}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {destination(entry)}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={index === 0}
              aria-label={`Move ${entry.label} earlier`}
              onClick={() => move(entry.id, children[index - 1]!.id)}
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={index === children.length - 1}
              aria-label={`Move ${entry.label} later`}
              onClick={() => move(entry.id, children[index + 1]!.id)}
            >
              <ArrowDownIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Edit ${entry.label} details`}
              onClick={() => setDraft({ ...entry })}
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${entry.label}`}
              onClick={() => onChange(value.filter((item) => item.id !== entry.id))}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
      {!children.length && (
        <p className="py-2 text-xs text-muted-foreground">
          No shortcuts yet. The main action still works with one click.
        </p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={children.length >= 8 || Boolean(draft)}
        onClick={create}
      >
        <PlusIcon className="size-3.5" />
        Add shortcut
      </Button>
      {draft && (
        <form
          className="space-y-3 rounded-xl border border-border bg-background/60 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const next = { ...draft, label: draft.label.trim() };
            if (!next.label) return;
            onChange(
              value.some((entry) => entry.id === draft.id)
                ? value.map((entry) => (entry.id === draft.id ? next : entry))
                : [...value, next],
            );
            setDraft(null);
          }}
        >
          <p className="text-sm font-medium">
            {value.some((entry) => entry.id === draft.id) ? "Edit shortcut" : "New shortcut"}
          </p>
          <label className="grid gap-1.5 text-sm">
            <span>Name</span>
            <Input
              autoFocus
              aria-label="Shortcut name"
              required
              maxLength={40}
              placeholder="For example, Team docs"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-sm">Opens</span>
            <Select
              value={draft.actionId}
              onValueChange={(next) => {
                if (next) setDraft({ ...draft, actionId: next, query: "" });
              }}
            >
              <SelectTrigger aria-label="Shortcut action" className="w-full">
                <SelectValue>
                  {QUICK_ACTIONS.find((action) => action.id === draft.actionId)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {QUICK_ACTIONS.map((action) => (
                  <SelectItem key={action.id} value={action.id}>
                    {action.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          {(draft.actionId === "scratch-browser" || draft.actionId === "search") && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5" aria-label="Suggested destinations">
                {(draft.actionId === "search"
                  ? [
                      { label: "Google", query: "https://www.google.com/search?q={query}" },
                      { label: "DuckDuckGo", query: "https://duckduckgo.com/?q={query}" },
                    ]
                  : [
                      { label: "Blank", query: "" },
                      { label: "Google", query: "https://www.google.com" },
                      { label: "GitHub", query: "https://github.com" },
                    ]
                ).map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        label: draft.label || preset.label,
                        query: preset.query,
                      })
                    }
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <label className="grid gap-1.5 text-sm">
                <span>{draft.actionId === "search" ? "Search address" : "Web address"}</span>
                <Input
                  aria-label="Shortcut destination"
                  placeholder={
                    draft.actionId === "search"
                      ? "Choose a search service above"
                      : "Leave empty for a blank browser"
                  }
                  value={draft.query}
                  onChange={(event) => setDraft({ ...draft, query: event.target.value })}
                />
              </label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {draft.actionId === "search"
                  ? "Choose Google or DuckDuckGo, or use a search address with {query} where the search text belongs."
                  : "Opens in a separate temporary browser tab."}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!draft.label.trim()}>
              Save shortcut
            </Button>
          </div>
        </form>
      )}
    </div>
  );
  return embedded ? (
    content
  ) : (
    <SettingsSection
      title="Action shortcuts"
      description="Choose an action, then add the shortcuts you want beside it."
    >
      {content}
    </SettingsSection>
  );
}
