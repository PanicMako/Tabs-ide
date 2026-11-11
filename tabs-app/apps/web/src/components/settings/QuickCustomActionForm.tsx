import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { cn } from "../../lib/utils";
import { QUICK_ACTION_ICONS } from "../quick-actions/RadialActions";
import {
  CUSTOM_ACTION_ICONS,
  QUICK_ACTIONS,
  customActionFromDraft,
  customActionProblem,
  type CustomActionDraft,
  type CustomActionKind,
  type CustomQuickAction,
  type QuickActionId,
} from "../quick-actions/actions";

const KINDS: readonly {
  kind: CustomActionKind;
  label: string;
  field?: string;
  placeholder?: string;
  help?: string;
}[] = [
  {
    kind: "web",
    label: "Open a website",
    field: "Web address",
    placeholder: "https://example.com/dashboard",
    help: "Opens in a separate temporary browser tab.",
  },
  {
    kind: "search",
    label: "Search a site",
    field: "Search address",
    placeholder: "https://github.com/search?q={query}",
    help: "Asks what to search for, then puts it where {query} is.",
  },
  {
    kind: "command",
    label: "Run a terminal command",
    field: "Command",
    placeholder: "bun run test",
    help: "Runs in a new terminal tab, in the open project, each time you choose this action.",
  },
  { kind: "builtin", label: "Run a built-in action" },
];

/** Create or edit one custom action, in place in the settings list. */
export function QuickCustomActionForm({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: CustomActionDraft;
  onSave: (saved: CustomQuickAction) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const kind = KINDS.find((entry) => entry.kind === draft.kind)!;
  const problem = customActionProblem(draft);
  return (
    <form
      className="space-y-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!problem) onSave(customActionFromDraft(draft));
      }}
    >
      <p className="text-sm font-medium">{onDelete ? "Edit action" : "New action"}</p>
      <label className="grid gap-1.5 text-sm">
        <span>Name</span>
        <Input
          autoFocus
          aria-label="Action name"
          maxLength={40}
          placeholder="For example, Run tests"
          value={draft.label}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
        />
      </label>
      <div className="space-y-1.5">
        <span className="text-sm">Icon</span>
        <div role="group" aria-label="Action icon" className="flex flex-wrap gap-1">
          {CUSTOM_ACTION_ICONS.map((icon) => {
            const Icon = QUICK_ACTION_ICONS[icon];
            return (
              <button
                key={icon}
                type="button"
                aria-label={`Use the ${icon} icon`}
                aria-pressed={draft.icon === icon}
                onClick={() => setDraft({ ...draft, icon })}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  draft.icon === icon && "border-ring/50 bg-accent text-foreground",
                )}
              >
                <Icon aria-hidden="true" width={15} height={15} size={15} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <span className="text-sm">What it does</span>
        <Select
          value={draft.kind}
          onValueChange={(next) => {
            if (next) setDraft({ ...draft, kind: next as CustomActionKind, value: "" });
          }}
        >
          <SelectTrigger aria-label="What it does" className="w-full">
            <SelectValue>{kind.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {KINDS.map((entry) => (
              <SelectItem key={entry.kind} value={entry.kind}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {draft.kind === "builtin" ? (
        <div className="space-y-1.5">
          <span className="text-sm">Action</span>
          <Select
            value={draft.builtin}
            onValueChange={(next) => {
              if (next) setDraft({ ...draft, builtin: next as QuickActionId });
            }}
          >
            <SelectTrigger aria-label="Built-in action" className="w-full">
              <SelectValue>
                {QUICK_ACTIONS.find((action) => action.id === draft.builtin)?.label}
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
      ) : (
        <label className="grid gap-1.5 text-sm">
          <span>{kind.field}</span>
          <Input
            aria-label={kind.field}
            placeholder={kind.placeholder}
            className={draft.kind === "command" ? "font-mono" : undefined}
            value={draft.value}
            onChange={(event) => setDraft({ ...draft, value: event.target.value })}
          />
          <span className="text-xs leading-relaxed text-muted-foreground">{kind.help}</span>
        </label>
      )}
      {tried && problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {onDelete && (
          <Button type="button" size="sm" variant="ghost" className="mr-auto" onClick={onDelete}>
            <Trash2Icon className="size-3.5" />
            Delete action
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save action
        </Button>
      </div>
    </form>
  );
}
