import type { TeammateMood } from "@tabs/contracts";
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { HOVER_CLOSE_MS, HOVER_OPEN_MS, HoverCardBody } from "./TeammatesCornerAvatar";
import { useEyeGaze } from "./eyeGaze";
import { activityFor, moodLabel } from "./teammates.logic";
import { dockFlight, useTeammatesUiStore } from "./teammatesStore";
import { useAvatarProps } from "./useAvatarProps";
import { useTeammatesData, useTeammatesEnabled } from "./useTeammates";

/** One minimised teammate, as far as the dock needs to know. */
export interface DockMember {
  readonly id: string;
  readonly name: string;
  readonly mood: TeammateMood;
  /** How many things are waiting on the owner. */
  readonly waiting: number;
}

/**
 * A teammate reduced to its two eyes. They follow your cursor, blink, look around when left alone,
 * scan while it works, and widen when it needs you (see `useEyeGaze`).
 */
function Eyes({ member }: { member: DockMember }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEyeGaze(ref, member.mood, member.waiting > 0);
  return (
    <span
      ref={ref}
      className="tm-dock-eyes"
      data-mood={member.mood}
      data-attention={member.waiting > 0}
    >
      <i />
      <i />
    </span>
  );
}

/**
 * The minimised teammate: its eyes, and a quiet "+2" when other teammates are minimised with it.
 * The first member leads, and its eyes are the ones that blink and glance.
 */
export function DockFace({ members }: { members: ReadonlyArray<DockMember> }) {
  const [lead] = members;
  if (!lead) return null;
  return (
    <>
      <Eyes member={lead} />
      {members.length > 1 ? <span className="tm-dock-text">+{members.length - 1}</span> : null}
    </>
  );
}

/**
 * The minimised teammate, beside Settings in the top bar. Hover it for the same quick card the
 * floating avatar has (ask, what needs you, and a menu that includes bringing the avatar back to
 * the screen); click it to open the Teammates space.
 */
export function TeammateDock() {
  const enabled = useTeammatesEnabled();
  const minimised = useTeammatesUiStore((state) => state.cornerHidden);
  const setCornerHidden = useTeammatesUiStore((state) => state.setCornerHidden);
  const { teammates, pinned, snapshot } = useTeammatesData();
  const props = useAvatarProps();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const hold = useRef({ card: false, input: false, menu: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  const scheduleOpen = () => {
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };
  const scheduleClose = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      const held = hold.current;
      if (held.card || held.input || held.menu) return;
      setOpen(false);
    }, HOVER_CLOSE_MS);
  };
  if (!enabled || !minimised || !pinned || !props) return null;

  const member = (teammate: { id: string; name: string }): DockMember => {
    const activity = activityFor(snapshot?.activity ?? [], teammate.id);
    return {
      id: teammate.id,
      name: teammate.name,
      mood: activity.mood,
      waiting: activity.needsYouCount,
    };
  };
  const members = [pinned, ...teammates.filter((teammate) => teammate.id !== pinned.id)].map(
    member,
  );
  const waiting = members.reduce((total, entry) => total + entry.waiting, 0);
  const closeCard = () => {
    hold.current = { card: false, input: false, menu: false };
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // A press on the eyes is handled by the button; only outside presses and Escape close it.
        if (details?.reason === "trigger-press" || details?.reason === "focus-out") return;
        if (!next) closeCard();
      }}
    >
      <PopoverTrigger
        render={
          <button
            ref={trigger}
            type="button"
            data-teammate-dock="true"
            aria-haspopup="dialog"
            aria-expanded={props.open}
            aria-label={`${pinned.name}: ${moodLabel(props.mood, props.label)}${waiting > 0 ? `, ${waiting} waiting` : ""}`}
            className="tm-dock no-drag"
            onPointerEnter={scheduleOpen}
            onPointerLeave={() => {
              clearTimer();
              scheduleClose();
            }}
            onClick={() => {
              // Hover shows the quick card; a click opens the whole Teammates space, where you
              // create, manage and work with every teammate.
              clearTimer();
              closeCard();
              props.onToggle();
            }}
          />
        }
      >
        <DockFace members={members} />
      </PopoverTrigger>
      <PopoverPopup
        anchor={trigger}
        side="bottom"
        align="end"
        sideOffset={8}
        initialFocus={false}
        finalFocus={false}
        className="tm-hover rounded-(--radius-preview)"
        viewportClassName="!p-0"
        onPointerEnter={() => {
          hold.current.card = true;
          clearTimer();
        }}
        onPointerLeave={() => {
          hold.current.card = false;
          scheduleClose();
        }}
      >
        <HoverCardBody
          teammate={props.teammate}
          mood={props.mood}
          finish={props.finish}
          status={moodLabel(props.mood, props.label)}
          needs={props.needs}
          teammates={props.teammates}
          hold={hold}
          onAsk={props.onAsk}
          onOpenChat={() => {
            closeCard();
            props.onOpenChat();
          }}
          onOpenSpace={() => {
            closeCard();
            props.onOpenSpace();
          }}
          onPin={(id) => {
            closeCard();
            props.onPin(id);
          }}
          onHide={closeCard}
          onRestore={() => {
            const box = trigger.current?.getBoundingClientRect();
            if (box) dockFlight.from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            closeCard();
            setCornerHidden(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}
