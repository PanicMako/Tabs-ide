import { useAtomValue } from "@effect/atom-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CornerDownLeftIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { TerminalQuickCommand } from "@tabs/contracts";
import { useConfirm } from "../../hooks/useConfirm";
import { useTerminalQuickCommands } from "../../hooks/useTerminalQuickCommands";
import {
  moveQuickCommand,
  newTerminalQuickCommandDraft,
  QUICK_COMMAND_TEMPLATES,
  quickCommandFromDraft,
  quickCommandFromLine,
  quickCommandTitle,
  removeQuickCommand,
  searchQuickCommands,
  upsertQuickCommand,
  type TerminalQuickCommandDraft,
} from "../../lib/terminalQuickCommands";
import { randomUUID } from "../../lib/utils";
import { projectsAtom } from "../../state/threads";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { TerminalQuickCommandDialog } from "../terminal-quick-commands/TerminalQuickCommandDialog";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";

function draftFrom(command: TerminalQuickCommand): TerminalQuickCommandDraft {
  return { ...command };
}

function CommandRow(props: {
  command: TerminalQuickCommand;
  scopeLabel: string;
  canDrag: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { command } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: command.id, disabled: !props.canDrag });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-dragging={isDragging || undefined}
      className="flex items-center gap-2 bg-transparent px-3 py-2.5 data-[dragging]:relative data-[dragging]:z-10 data-[dragging]:bg-muted"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        disabled={!props.canDrag}
        aria-label={`Reorder ${quickCommandTitle(command)}`}
        className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="truncate text-sm text-foreground"
            style={{ fontFamily: "var(--font-row, var(--font-sans))" }}
          >
            {quickCommandTitle(command)}
          </span>
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
          >
            {props.scopeLabel}
            {command.appendEnter ? "" : " · waits for Enter"}
          </span>
        </div>
        <div
          className="truncate text-xs text-muted-foreground"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {command.cwd ? `${command.cwd} · ` : ""}
          {command.command.split(/\r?\n/, 1)[0]}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Edit ${quickCommandTitle(command)}`}
        onClick={props.onEdit}
      >
        <PencilIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${quickCommandTitle(command)}`}
        onClick={props.onDelete}
      >
        <Trash2Icon className="size-4" />
      </Button>
    </li>
  );
}

export default function TerminalCommandsSettings() {
  const { commands, save } = useTerminalQuickCommands();
  const projects = useAtomValue(projectsAtom);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<TerminalQuickCommandDraft | null>(null);
  const [query, setQuery] = useState("");
  const [line, setLine] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projectOptions = useMemo(
    () => projects.map((project) => ({ id: project.id, name: project.title ?? project.name })),
    [projects],
  );
  const scopeLabel = (command: TerminalQuickCommand) => {
    const { scope } = command;
    if (scope.type === "global") return "All projects";
    return (
      projectOptions.find((project) => project.id === scope.projectId)?.name ?? "Unknown project"
    );
  };
  const shown = useMemo(() => searchQuickCommands(commands, query), [commands, query]);
  const filtering = query.trim().length > 0;

  const remove = async (command: TerminalQuickCommand) => {
    const ok = await confirm(`Delete "${quickCommandTitle(command)}"? This cannot be undone.`);
    if (ok) void save(removeQuickCommand(commands, command.id));
  };

  const addLine = (event?: FormEvent) => {
    event?.preventDefault();
    const next = quickCommandFromLine(randomUUID(), line);
    if (!next) return;
    void save(upsertQuickCommand(commands, next));
    setLine("");
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const toIndex = commands.findIndex((command) => command.id === over.id);
    void save(moveQuickCommand(commands, String(active.id), toIndex));
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Terminal Commands"
        description="Save commands you type often. Run them in the active terminal from its toolbar (the lightning bolt), the Command Palette or Quick Actions."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(newTerminalQuickCommandDraft(randomUUID()))}
          >
            <PlusIcon className="size-4" />
            Add with options
          </Button>
        }
      />
      <SettingsSection title="Saved commands">
        <form onSubmit={addLine} className="flex items-center gap-2 border-b border-border/60 p-3">
          <Input
            value={line}
            aria-label="New command"
            placeholder="Type a command and press Enter, for example npm run dev"
            className="font-mono"
            onChange={(event) => setLine(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!line.trim()}>
            Add <CornerDownLeftIcon className="size-3" />
          </Button>
        </form>
        {commands.length === 0 ? (
          <div className="space-y-3 px-4 py-8 text-center">
            <p className="text-sm text-foreground">One click to run what you always type</p>
            <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
              Saved commands are typed into the terminal you are looking at. Start with one of
              these, or write your own above.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {QUICK_COMMAND_TEMPLATES.map((template) => (
                <Button
                  key={template.command}
                  size="xs"
                  variant="outline"
                  aria-label={`Add ${template.command}`}
                  onClick={() => {
                    const next = quickCommandFromLine(
                      randomUUID(),
                      template.command,
                      template.label,
                    );
                    if (next) void save(upsertQuickCommand(commands, next));
                  }}
                >
                  <PlusIcon />
                  <span style={{ fontFamily: "var(--font-mono)" }}>{template.command}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {commands.length > 4 ? (
              <div className="border-b border-border/60 p-3">
                <Input
                  value={query}
                  aria-label="Search commands"
                  placeholder="Search commands"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            ) : null}
            {shown.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nothing matches that search.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={shown.map((command) => command.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="divide-y divide-border/60" aria-label="Saved commands">
                    {shown.map((command) => (
                      <CommandRow
                        key={command.id}
                        command={command}
                        scopeLabel={scopeLabel(command)}
                        canDrag={!filtering}
                        onEdit={() => setEditing(draftFrom(command))}
                        onDelete={() => void remove(command)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            <p
              className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground"
              style={{ fontFamily: "var(--font-ui-meta, var(--font-sans))" }}
            >
              Drag <GripVerticalIcon className="inline size-3" /> to reorder, or focus it and press{" "}
              <Kbd>Space</Kbd> then arrow keys.
            </p>
          </>
        )}
      </SettingsSection>
      <TerminalQuickCommandDialog
        draft={editing}
        projects={projectOptions}
        onCancel={() => setEditing(null)}
        onSave={(draft) => {
          void save(upsertQuickCommand(commands, quickCommandFromDraft(draft)));
          setEditing(null);
        }}
      />
      {confirmDialog}
    </div>
  );
}
