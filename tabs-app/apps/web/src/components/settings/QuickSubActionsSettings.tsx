import { useState } from "react";
import { GripVerticalIcon, PlusIcon, Trash2Icon, ArrowUpIcon, ArrowDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsSection } from "./SettingsLayout";
import { QUICK_ACTIONS, type QuickSubAction } from "../quick-actions/actions";

export function QuickSubActionsSettings({
  value,
  onChange,
}: {
  value: readonly QuickSubAction[];
  onChange: (value: QuickSubAction[]) => void;
}) {
  const [parent, setParent] = useState("scratch-browser");
  const [dragged, setDragged] = useState<string | null>(null);
  const children = value.filter((entry) => entry.parentId === parent);
  const update = (id: string, patch: Partial<QuickSubAction>) =>
    onChange(value.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  const move = (from: string, to: string) => {
    if (from === to) return;
    const entries = [...value];
    const start = entries.findIndex((entry) => entry.id === from);
    const end = entries.findIndex((entry) => entry.id === to);
    if (start < 0 || end < 0) return;
    const [entry] = entries.splice(start, 1);
    entries.splice(end, 0, entry!);
    onChange(entries);
  };
  return (
    <SettingsSection
      title="Sub-actions"
      description="Hover or focus an action to reveal its shortcuts. Drag to reorder, or use the arrow buttons. Up to eight shortcuts per action."
    >
      <div className="space-y-4 p-4 sm:p-5">
        <Select
          value={parent}
          onValueChange={(next) => {
            if (next) setParent(next);
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
        <div className="space-y-3">
          {children.map((entry, index) => (
            <div
              key={entry.id}
              className="space-y-2 border-b border-border pb-3 last:border-b-0"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged) move(dragged, entry.id);
                setDragged(null);
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  draggable
                  onDragStart={(event) => {
                    setDragged(entry.id);
                    event.dataTransfer.setData("text/plain", entry.id);
                  }}
                  onDragEnd={() => setDragged(null)}
                  className="cursor-grab text-muted-foreground"
                  aria-hidden="true"
                >
                  <GripVerticalIcon className="size-4" />
                </span>
                <Input
                  aria-label={`Shortcut name ${index + 1}`}
                  value={entry.label}
                  placeholder="Shortcut name"
                  maxLength={40}
                  onChange={(event) => update(entry.id, { label: event.target.value })}
                />
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
                  aria-label={`Remove ${entry.label}`}
                  onClick={() => onChange(value.filter((item) => item.id !== entry.id))}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={entry.actionId}
                  onValueChange={(next) => {
                    if (next) update(entry.id, { actionId: next });
                  }}
                >
                  <SelectTrigger aria-label={`Shortcut action ${index + 1}`} className="w-full">
                    <SelectValue>
                      {QUICK_ACTIONS.find((action) => action.id === entry.actionId)?.label ??
                        "Choose action"}
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
                {(entry.actionId === "scratch-browser" || entry.actionId === "search") && (
                  <Input
                    aria-label={`Shortcut URL or search ${index + 1}`}
                    placeholder={
                      entry.actionId === "search"
                        ? "Search URL · use {query} for search text"
                        : "URL · blank for a new tab"
                    }
                    value={entry.query}
                    onChange={(event) => update(entry.id, { query: event.target.value })}
                  />
                )}
              </div>
            </div>
          ))}
          {!children.length && (
            <p className="text-sm text-muted-foreground">
              No sub-actions yet. Add a shortcut below.
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={children.length >= 8}
          onClick={() =>
            onChange([
              ...value,
              {
                id: crypto.randomUUID(),
                parentId: parent,
                actionId: parent,
                label: "New shortcut",
                query: "",
              },
            ])
          }
        >
          <PlusIcon className="size-3.5" />
          Add sub-action
        </Button>
      </div>
    </SettingsSection>
  );
}
