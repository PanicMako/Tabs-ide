import { useState, type DragEvent } from "react";
import {
  ArrowUpRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CircleDotIcon,
  EyeOffIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { TabsMascot } from "../TabsMascot";
import { QUICK_ACTION_ICONS } from "../quick-actions/RadialActions";
import {
  RING_SLOTS,
  actionZones,
  customActionDraft,
  newCustomActionDraft,
  placeAction,
  type ActionZone,
  type CustomQuickAction,
  type QuickAction,
  type QuickSubAction,
} from "../quick-actions/actions";
import { QuickCustomActionForm } from "./QuickCustomActionForm";
import { QuickSubActionsSettings } from "./QuickSubActionsSettings";

const DRAG_TYPE = "application/x-tabs-action";

const ZONES: readonly {
  zone: ActionZone;
  title: string;
  short: string;
  hint: string;
  empty: string;
  Icon: typeof CircleDotIcon;
}[] = [
  {
    zone: "ring",
    title: "On the ring",
    short: "Ring",
    hint: "One click away, clockwise from the top.",
    empty: "Drop an action here to put it on the ring.",
    Icon: CircleDotIcon,
  },
  {
    zone: "more",
    title: "In More",
    short: "More",
    hint: "Tucked behind the More button.",
    empty: "Everything fits on the ring, so there is no More button.",
    Icon: MoreHorizontalIcon,
  },
  {
    zone: "hidden",
    title: "Hidden",
    short: "Hide",
    hint: "Not shown in the launcher.",
    empty: "Drop an action here to hide it.",
    Icon: EyeOffIcon,
  },
];

/** Arrange the launcher: which zone each action lives in, and in what order. */
export function QuickActionsArranger({
  order,
  hidden,
  subActions,
  customActions,
  onPatch,
}: {
  order: readonly string[];
  hidden: readonly string[];
  subActions: readonly QuickSubAction[];
  customActions: readonly CustomQuickAction[];
  onPatch: (value: {
    actionOrder?: string[];
    hiddenActions?: string[];
    subActions?: QuickSubAction[];
    customActions?: CustomQuickAction[];
  }) => void;
}) {
  const zones = actionZones(order, hidden, customActions);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [pointedAt, setPointedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ zone: ActionZone; index: number } | null>(null);

  const place = (id: string, zone: ActionZone, index: number) => {
    onPatch(placeAction(order, hidden, id, zone, index, customActions));
  };
  /** A new action goes straight onto the ring, where it can be seen and moved. */
  const create = (saved: CustomQuickAction) => {
    const next = [...customActions, saved];
    onPatch({
      customActions: next,
      ...placeAction(order, hidden, saved.id, "ring", RING_SLOTS - 1, next),
    });
    setCreatingId(null);
  };
  const update = (saved: CustomQuickAction) => {
    onPatch({
      customActions: customActions.map((entry) => (entry.id === saved.id ? saved : entry)),
    });
    setExpanded(null);
  };
  const remove = (id: string) => {
    onPatch({
      customActions: customActions.filter((entry) => entry.id !== id),
      actionOrder: order.filter((entry) => entry !== id),
      hiddenActions: hidden.filter((entry) => entry !== id),
      subActions: subActions.filter((entry) => entry.parentId !== id),
    });
    setExpanded(null);
  };
  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };
  const drop = (event: DragEvent, zone: ActionZone, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragging) place(dragging, zone, index);
    endDrag();
  };
  const hover = (event: DragEvent, zone: ActionZone, index: number) => {
    if (!dragging || (zone === "hidden" && dragging === "customize")) return;
    event.preventDefault();
    event.stopPropagation();
    setDropAt((current) =>
      current?.zone === zone && current.index === index ? current : { zone, index },
    );
  };

  const row = (action: QuickAction, zone: ActionZone, index: number, list: QuickAction[]) => {
    const Icon = QUICK_ACTION_ICONS[action.icon];
    const count = subActions.filter((entry) => entry.parentId === action.id).length;
    const open = expanded === action.id;
    const flat = [...zones.ring, ...zones.more];
    const flatIndex = flat.findIndex((entry) => entry.id === action.id);
    /** Arrows step through the ring and More as one sequence. */
    const step = (delta: number) => {
      if (zone === "hidden") {
        place(action.id, zone, index + delta);
        return;
      }
      const target = flatIndex + delta;
      if (target < RING_SLOTS) place(action.id, "ring", target);
      else place(action.id, "more", target - RING_SLOTS);
    };
    const canEarlier = zone === "hidden" ? index > 0 : flatIndex > 0;
    const canLater = zone === "hidden" ? index < list.length - 1 : flatIndex < flat.length - 1;
    return (
      <div key={action.id}>
        {dropAt?.zone === zone && dropAt.index === index && <DropLine />}
        <div
          data-slot="settings-row"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, action.id);
            event.dataTransfer.effectAllowed = "move";
            setDragging(action.id);
          }}
          onDragEnd={endDrag}
          onDragOver={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            hover(event, zone, event.clientY > box.top + box.height / 2 ? index + 1 : index);
          }}
          onDrop={(event) => drop(event, zone, dropAt?.index ?? index)}
          onPointerEnter={() => setPointedAt(action.id)}
          onPointerLeave={() => setPointedAt(null)}
          data-zone={zone}
          data-open={open}
          className={cn("qa-arr-row group", dragging === action.id && "opacity-40")}
        >
          <GripVerticalIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 cursor-grab text-muted-foreground/50"
          />
          {zone === "ring" && (
            <span className="w-3 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">
              {index + 1}
            </span>
          )}
          <span className="qa-arr-icon">
            <Icon aria-hidden="true" width={15} height={15} size={15} />
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            aria-expanded={open}
            aria-label={`Configure ${action.label}`}
            onClick={() => setExpanded(open ? null : action.id)}
          >
            <span className="qa-arr-name">{action.label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {"custom" in action
                ? `Custom · ${action.detail}`
                : count
                  ? `${count} shortcut${count === 1 ? "" : "s"}`
                  : action.detail}
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <span className="qa-arr-reveal">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Move ${action.label} earlier`}
                disabled={!canEarlier}
                onClick={() => step(-1)}
              >
                <ArrowUpIcon className="size-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Move ${action.label} later`}
                disabled={!canLater}
                onClick={() => step(1)}
              >
                <ArrowDownIcon className="size-3.5" />
              </Button>
            </span>
            <div
              role="group"
              aria-label={`Where ${action.label} appears`}
              className="ml-1 flex rounded-full bg-muted p-0.5"
            >
              {ZONES.map((entry) => {
                const locked = entry.zone === "hidden" && action.id === "customize";
                return (
                  <button
                    key={entry.zone}
                    type="button"
                    title={locked ? "Customize always stays reachable" : entry.title}
                    aria-label={`${entry.title}: ${action.label}`}
                    aria-pressed={zone === entry.zone}
                    disabled={locked}
                    onClick={() =>
                      zone !== entry.zone &&
                      place(
                        action.id,
                        entry.zone,
                        entry.zone === "ring"
                          ? Math.min(zones.ring.length, RING_SLOTS - 1)
                          : zones[entry.zone].length,
                      )
                    }
                    className={cn(
                      "h-6 rounded-full px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-ring",
                      zone === entry.zone && "bg-background text-foreground shadow-xs",
                    )}
                  >
                    {entry.short}
                  </button>
                );
              })}
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Configure ${action.label} shortcuts`}
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : action.id)}
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", open && "rotate-180")}
              />
            </Button>
          </div>
        </div>
        {open && (
          <div className="mb-1 ml-8 mt-1 rounded-xl border border-border bg-muted/20">
            {"custom" in action ? (
              <QuickCustomActionForm
                initial={customActionDraft(customActions.find((entry) => entry.id === action.id)!)}
                onSave={update}
                onCancel={() => setExpanded(null)}
                onDelete={() => remove(action.id)}
              />
            ) : (
              <QuickSubActionsSettings
                parentId={action.id}
                embedded
                value={subActions}
                onChange={(next) => onPatch({ subActions: next })}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="qa-arr">
      <ol className="qa-arr-guide">
        <li>
          <b>1</b>
          <span>
            <strong>Choose what shows</strong>
            Set each action to Ring, More or Hide.
          </span>
        </li>
        <li>
          <b>2</b>
          <span>
            <strong>Put it in order</strong>
            Drag a row. The map shows the result.
          </span>
        </li>
        <li>
          <b>3</b>
          <span>
            <strong>Make it yours</strong>
            Click a row to edit, or add a new action.
          </span>
        </li>
      </ol>
      <div className="qa-arr-library">
        {creatingId && (
          <div className="rounded-xl border border-border bg-muted/20">
            <QuickCustomActionForm
              key={creatingId}
              initial={newCustomActionDraft(creatingId)}
              onSave={create}
              onCancel={() => setCreatingId(null)}
            />
          </div>
        )}
        {ZONES.map(({ zone, title, hint, empty }) => {
          const list = zones[zone];
          return (
            <section
              key={zone}
              aria-label={title}
              data-drop={dropAt?.zone === zone || undefined}
              className="qa-arr-zone"
              onDragOver={(event) => hover(event, zone, list.length)}
              onDrop={(event) => drop(event, zone, dropAt?.index ?? list.length)}
            >
              <header className="qa-arr-zone-head">
                <h4>{title}</h4>
                <span className="qa-arr-count">
                  {zone === "ring" ? `${list.length}/${RING_SLOTS}` : list.length}
                </span>
                <small>{hint}</small>
              </header>
              {list.map((action, index) => row(action, zone, index, list))}
              {dropAt?.zone === zone && dropAt.index >= list.length && <DropLine />}
              {!list.length && <p className="qa-arr-empty">{empty}</p>}
            </section>
          );
        })}
      </div>
      <aside className="qa-arr-aside">
        <div className="qa-arr-map" aria-hidden="true">
          <TabsMascot mode="still" eyeColor="var(--card)" />
          {[...zones.ring, ...(zones.more.length ? [undefined] : [])].map((action, index, all) => {
            const angle = (index * 2 * Math.PI) / all.length;
            const Icon = action ? QUICK_ACTION_ICONS[action.icon] : MoreHorizontalIcon;
            return (
              <span
                key={action?.id ?? "more"}
                className="qa-arr-slot"
                data-on={action?.id === pointedAt || undefined}
                style={{
                  left: `calc(50% + ${(84 * Math.sin(angle)).toFixed(1)}px)`,
                  top: `calc(50% - ${(84 * Math.cos(angle)).toFixed(1)}px)`,
                }}
              >
                <Icon width={15} height={15} size={15} />
              </span>
            );
          })}
        </div>
        <p className="qa-arr-map-caption">Your ring, as it opens.</p>
        <div className="qa-arr-actions">
          <button
            type="button"
            disabled={Boolean(creatingId)}
            onClick={() => setCreatingId(`custom:${crypto.randomUUID()}`)}
          >
            <PlusIcon aria-hidden="true" />
            <span>New action</span>
            <ArrowUpRightIcon aria-hidden="true" />
          </button>
        </div>
      </aside>
    </div>
  );
}

function DropLine() {
  return <div aria-hidden="true" className="mx-3 my-0.5 h-0.5 rounded-full bg-primary" />;
}
