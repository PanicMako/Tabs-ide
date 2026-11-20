import {
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEventHandler,
  type PointerEventHandler,
} from "react";
import { GripVerticalIcon, SearchIcon } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { SegmentedControl } from "../ui/segmented-control";
import { moveProvider } from "./providerOrder";
import "./providers.css";

export interface ProviderDirectoryEntry {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  enabled: boolean;
  status: string;
  statusClass: string;
  modelCount: number;
  action?: { label: string; disabled?: boolean; onClick: () => void } | undefined;
}

/** Press and move this far before a row lifts, so a plain click still selects it. */
const DRAG_ACTIVATION_DISTANCE_PX = 5;

export function ProviderDirectory({
  entries,
  selectedId,
  onSelect,
  onReorder,
  isCustomOrder = false,
  onResetOrder,
}: {
  /** Already in the user's saved order. */
  entries: readonly ProviderDirectoryEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Receives every provider id in its new order. Omit to make the list fixed. */
  onReorder?: (orderedIds: string[]) => void;
  isCustomOrder?: boolean;
  onResetOrder?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = entries.filter(
    (entry) =>
      (filter !== "enabled" || entry.enabled) &&
      entry.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  // A search result is no place to set an order; filtering by Enabled is.
  const canReorder = onReorder !== undefined && query.trim() === "" && visible.length > 1;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Releasing a dragged row would also click it; that drop must not select it.
  const suppressSelect = useRef(false);
  const releaseSelect = () => {
    setTimeout(() => {
      suppressSelect.current = false;
    }, 0);
  };
  const select = (id: string) => {
    if (!suppressSelect.current) onSelect(id);
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    releaseSelect();
    if (!onReorder || !over || active.id === over.id) return;
    onReorder(
      moveProvider(
        entries.map((entry) => entry.id),
        String(active.id),
        String(over.id),
      ),
    );
  };

  return (
    <nav className="provider-directory" aria-label="Provider directory">
      <div className="provider-directory-heading">
        <span>Your agents</span>
        {isCustomOrder && onResetOrder ? (
          <button type="button" className="provider-directory-reset" onClick={onResetOrder}>
            Reset order
          </button>
        ) : (
          <span aria-hidden>↗</span>
        )}
      </div>
      <label className="provider-search">
        <SearchIcon size={14} aria-hidden />
        <input
          aria-label="Find a provider"
          placeholder="Find a provider…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <SegmentedControl
        size="sm"
        value={filter}
        onValueChange={setFilter}
        aria-label="Provider filter"
        options={[
          { value: "all", label: `All ${entries.length}` },
          { value: "enabled", label: `Enabled ${entries.filter((entry) => entry.enabled).length}` },
        ]}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        modifiers={[restrictToParentElement]}
        onDragStart={() => {
          suppressSelect.current = true;
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={releaseSelect}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "To reorder this provider, press space, use the arrow keys to move it, then press space again to drop it.",
          },
        }}
      >
        <SortableContext
          items={visible.map((entry) => entry.id)}
          // The list becomes a two-column grid on narrow windows.
          strategy={rectSortingStrategy}
          disabled={!canReorder}
        >
          <div className="provider-directory-list" data-reorderable={canReorder || undefined}>
            {visible.map((entry) => (
              <SortableProviderEntry
                key={entry.id}
                entry={entry}
                selected={entry.id === selectedId}
                onSelect={select}
                reorderable={canReorder}
              />
            ))}
            {visible.length === 0 ? (
              <p role="status" className="provider-directory-empty">
                No matching providers.
              </p>
            ) : null}
          </div>
        </SortableContext>
      </DndContext>
    </nav>
  );
}

function SortableProviderEntry({
  entry: { id, name, icon: Icon, enabled, status, statusClass, modelCount, action },
  selected,
  onSelect,
  reorderable,
}: {
  entry: ProviderDirectoryEntry;
  selected: boolean;
  onSelect: (id: string) => void;
  reorderable: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !reorderable });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="provider-directory-entry"
      data-action={action ? "true" : undefined}
      data-dragging={isDragging || undefined}
      // Pressing anywhere on the row and moving lifts it; the handle below
      // carries the keyboard and screen reader affordance.
      onPointerDown={
        reorderable
          ? (listeners?.onPointerDown as PointerEventHandler<HTMLDivElement> | undefined)
          : undefined
      }
    >
      {reorderable ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="provider-directory-handle"
          aria-label={`Reorder ${name}`}
          title="Drag to reorder"
          {...attributes}
          onKeyDown={listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}
        >
          <GripVerticalIcon size={14} aria-hidden />
        </button>
      ) : null}
      <button
        className="provider-directory-select"
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(id)}
      >
        <span className="provider-directory-icon" aria-hidden>
          <Icon className="provider-brand-icon size-4" data-provider={id} />
        </span>
        <span className="provider-directory-name">
          <strong>{name}</strong>
          <span>{enabled ? status : "Disabled"}</span>
        </span>
        <span
          className={`provider-directory-dot ${enabled ? statusClass : "bg-muted-foreground/40"}`}
          aria-hidden
        />
        {!action ? (
          <span className="provider-directory-count" title={`${modelCount} models`}>
            {modelCount}
          </span>
        ) : null}
      </button>
      {action ? (
        <button
          type="button"
          className="provider-directory-action"
          aria-label={`${action.label} ${name}`}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
