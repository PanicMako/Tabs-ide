// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/renderer/src/components/terminal-quick-commands/TerminalQuickCommandDialog.tsx
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  quickCommandProblem,
  type TerminalQuickCommandDraft,
} from "../../lib/terminalQuickCommands";

export interface QuickCommandProjectOption {
  readonly id: string;
  readonly name: string;
}

const GLOBAL_VALUE = "__global__";

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Create or edit one saved command. `draft` null means closed. */
export function TerminalQuickCommandDialog({
  draft: initial,
  projects,
  onSave,
  onCancel,
}: {
  draft: TerminalQuickCommandDraft | null;
  projects: readonly QuickCommandProjectOption[];
  onSave: (draft: TerminalQuickCommandDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TerminalQuickCommandDraft | null>(initial);
  const [showProblem, setShowProblem] = useState(false);
  useEffect(() => {
    if (initial) {
      setDraft(initial);
      setShowProblem(false);
    }
  }, [initial]);
  const problem = draft ? quickCommandProblem(draft) : null;
  const scopeValue = draft?.scope.type === "project" ? draft.scope.projectId : GLOBAL_VALUE;
  const scopeLabel =
    scopeValue === GLOBAL_VALUE
      ? "All projects"
      : (projects.find((project) => project.id === scopeValue)?.name ?? "Unknown project");

  return (
    <Dialog open={initial !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quick command</DialogTitle>
          <DialogDescription>Typed into the active terminal when you choose it.</DialogDescription>
        </DialogHeader>
        {draft ? (
          <form
            className="space-y-4 px-6 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (problem) {
                setShowProblem(true);
                return;
              }
              onSave(draft);
            }}
          >
            <Field label="Name" htmlFor="qc-name" hint="Optional. Shown instead of the command.">
              <Input
                id="qc-name"
                value={draft.label}
                maxLength={80}
                placeholder="Run tests"
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              />
            </Field>
            <Field label="Command" htmlFor="qc-command">
              <Textarea
                id="qc-command"
                autoFocus
                value={draft.command}
                rows={3}
                className="font-mono"
                placeholder="npm run dev"
                onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                    event.currentTarget.form?.requestSubmit();
                }}
              />
            </Field>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Press Enter after typing
                <span className="block text-xs text-muted-foreground">
                  Off leaves it on the prompt so you can edit it first.
                </span>
              </span>
              <Switch
                aria-label="Press Enter after typing"
                checked={draft.appendEnter}
                onCheckedChange={(appendEnter) => setDraft({ ...draft, appendEnter })}
              />
            </label>
            <Field label="Available in" htmlFor="qc-scope">
              <Select
                value={scopeValue}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    scope:
                      value === GLOBAL_VALUE
                        ? { type: "global" }
                        : { type: "project", projectId: String(value) },
                  })
                }
              >
                <SelectTrigger id="qc-scope" aria-label="Available in">
                  <SelectValue>{scopeLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={GLOBAL_VALUE}>All projects</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field
              label="Folder"
              htmlFor="qc-folder"
              hint="Optional. Runs cd into this folder first; empty uses wherever the terminal is."
            >
              <Input
                id="qc-folder"
                value={draft.cwd}
                className="font-mono"
                placeholder="~/projects/app"
                onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
              />
            </Field>
            {showProblem && problem ? (
              <p role="alert" className="text-xs text-destructive">
                {problem}
              </p>
            ) : null}
            <DialogFooter className="px-0">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
