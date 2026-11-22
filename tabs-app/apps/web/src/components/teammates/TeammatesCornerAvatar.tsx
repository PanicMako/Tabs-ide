import "./teammates.css";
import type { Teammate, TeammateFinish, TeammateItem, TeammateMood } from "@tabs/contracts";
import {
  EyeOffIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PinIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { cn } from "~/lib/utils";
import {
  isDragGesture,
  nudgePosition,
  placeInWindow,
  positionFromOffset,
  readStoredPosition,
  saveStoredPosition,
  type CornerPosition,
  type WindowInsets,
} from "~/lib/cornerPosition";
import { useSurfaceMotionSettings } from "~/panelAnimations";
import {
  clearSurfaceMotion,
  getSurfacePreset,
  playSurfaceEnter,
  playSurfaceExit,
} from "~/lib/motion";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup } from "../ui/popover";
import { NotchAvatar } from "./NotchAvatar";
import { formatBadge, moodLabel } from "./teammates.logic";

export const POSITION_KEY = "tabs:notch-corner-position:v1";
export const DEFAULT_POSITION: CornerPosition = { x: 1, y: 1 };
const SIZE = 56;
const INSETS: WindowInsets = { left: 16, right: 16, top: 52, bottom: 16 };
const NUDGE = 16;
const NUDGE_FAST = 64;
const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 220;
/** The corner avatar that is there as the app loads appears without an entrance. */
const APP_LOAD_GRACE_MS = 4000;

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const place = (position: CornerPosition) => placeInWindow(position, viewport(), SIZE, INSETS);

export interface AvatarNeed {
  readonly id: string;
  readonly title: string;
  readonly question: string | null;
}

export function needsFromItems(
  items: ReadonlyArray<TeammateItem>,
  teammateId: string,
): AvatarNeed[] {
  return items
    .filter((item) => item.teammateId === teammateId && item.status === "needsYou")
    .map((item) => ({ id: item.id, title: item.title, question: item.question }));
}

export interface TeammatesCornerAvatarProps {
  teammate: Pick<Teammate, "id" | "name">;
  mood: TeammateMood;
  label?: string | undefined;
  finish: TeammateFinish;
  badge: number;
  needs: ReadonlyArray<AvatarNeed>;
  teammates: ReadonlyArray<Pick<Teammate, "id" | "name">>;
  open: boolean;
  onToggle: () => void;
  onAsk: (text: string) => Promise<boolean>;
  onOpenChat: () => void;
  onOpenSpace: () => void;
  onPin: (id: string) => void;
  onHide: () => void;
  /** False plays the exit; `onExited` fires when it is done so the owner can unmount. */
  visible?: boolean;
  onExited?: () => void;
}

/**
 * The floating avatar of the pinned teammate. Drag it anywhere (a small threshold keeps a click a
 * click), nudge it with the arrow keys while it has focus, and hover it for a quick card: status,
 * what needs you, an Ask field and a menu. Click it to open the Teammates space.
 */
export function TeammatesCornerAvatar({
  teammate,
  mood,
  label,
  finish,
  badge,
  needs,
  teammates,
  open,
  onToggle,
  onAsk,
  onOpenChat,
  onOpenSpace,
  onPin,
  onHide,
  visible = true,
  onExited,
}: TeammatesCornerAvatarProps) {
  const shell = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLButtonElement>(null);
  const position = useRef<CornerPosition>(readStoredPosition(POSITION_KEY, DEFAULT_POSITION));
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );
  const moved = useRef(false);
  const motion = useSurfaceMotionSettings();
  const { active, seconds } = motion;
  const [dragging, setDragging] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const hold = useRef({ card: false, input: false, menu: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = (animate: boolean) => {
    const node = root.current;
    if (!node) return;
    const target = place(position.current);
    if (animate && active) {
      gsap.to(node, {
        x: target.x,
        y: target.y,
        duration: Math.max(0.1, seconds(0.16)),
        ease: "tabs-swift",
      });
    } else gsap.set(node, { x: target.x, y: target.y });
  };

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    settle(false);
    return () => {
      gsap.killTweensOf(node);
    };
    // oxlint-disable-next-line react/exhaustive-deps -- mount-only placement
  }, []);

  // Enter and exit on a wrapper, so the motion never fights the position on the button.
  useLayoutEffect(() => {
    const node = shell.current;
    if (!node) return;
    const spec = getSurfacePreset("popover");
    if (visible) {
      if (!active || performance.now() < APP_LOAD_GRACE_MS) {
        clearSurfaceMotion(node);
        return;
      }
      const tween = playSurfaceEnter(node, spec, motion, false);
      return () => void tween.kill();
    }
    const exit = active ? playSurfaceExit(node, spec, motion) : null;
    if (!exit) {
      onExited?.();
      return;
    }
    exit.tween.eventCallback("onComplete", () => onExited?.());
    return () => {
      exit.tween.kill();
      exit.hold?.cancel();
      clearSurfaceMotion(node);
    };
    // oxlint-disable-next-line react/exhaustive-deps -- reacts to visibility only
  }, [visible]);

  // Window resize and display changes: keep the avatar inside the window.
  useEffect(() => {
    const onResize = () => settle(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // oxlint-disable-next-line react/exhaustive-deps -- settle reads refs only
  }, []);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  const scheduleOpen = () => {
    clearTimer();
    if (dragging || drag.current) return;
    timer.current = setTimeout(() => setCardOpen(true), HOVER_OPEN_MS);
  };
  const scheduleClose = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      const held = hold.current;
      if (held.card || held.input || held.menu) return;
      setCardOpen(false);
    }, HOVER_CLOSE_MS);
  };

  const commitPosition = (next: CornerPosition, animate: boolean) => {
    position.current = next;
    saveStoredPosition(POSITION_KEY, next);
    settle(animate);
  };

  const status = moodLabel(mood, label);
  return (
    <div ref={shell} className="notch-corner-shell">
      <button
        ref={root}
        type="button"
        aria-label={`${teammate.name}: ${status}${badge > 0 ? `, ${badge} waiting` : ""}`}
        aria-description="Press Enter to open Teammates. Drag, or use the arrow keys, to move."
        aria-expanded={open}
        className={cn("notch-corner no-drag", dragging && "notch-corner-dragging")}
        style={{ width: SIZE, height: SIZE }}
        onPointerEnter={scheduleOpen}
        onPointerLeave={() => {
          clearTimer();
          scheduleClose();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          clearTimer();
          const origin = place(position.current);
          drag.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: origin.x,
            originY: origin.y,
          };
          moved.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state) return;
          const dx = event.clientX - state.startX;
          const dy = event.clientY - state.startY;
          if (!moved.current && !isDragGesture(dx, dy)) return;
          if (!moved.current) {
            moved.current = true;
            setDragging(true);
            setCardOpen(false);
            gsap.killTweensOf(event.currentTarget);
          }
          // Follow the pointer, but never leave the window.
          const clamped = place(
            positionFromOffset(
              { x: state.originX + dx, y: state.originY + dy },
              viewport(),
              SIZE,
              INSETS,
            ),
          );
          gsap.set(event.currentTarget, clamped);
        }}
        onPointerUp={(event) => {
          const state = drag.current;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (!state || !moved.current) return;
          setDragging(false);
          commitPosition(
            positionFromOffset(
              {
                x: state.originX + (event.clientX - state.startX),
                y: state.originY + (event.clientY - state.startY),
              },
              viewport(),
              SIZE,
              INSETS,
            ),
            false,
          );
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          settle(false);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? NUDGE_FAST : NUDGE;
          const delta =
            event.key === "ArrowLeft"
              ? { dx: -step, dy: 0 }
              : event.key === "ArrowRight"
                ? { dx: step, dy: 0 }
                : event.key === "ArrowUp"
                  ? { dx: 0, dy: -step }
                  : event.key === "ArrowDown"
                    ? { dx: 0, dy: step }
                    : null;
          if (!delta) return;
          event.preventDefault();
          setCardOpen(false);
          commitPosition(nudgePosition(position.current, delta, viewport(), SIZE, INSETS), true);
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setCardOpen(true);
        }}
        onClick={() => {
          if (moved.current) {
            moved.current = false;
            return;
          }
          setCardOpen(false);
          onToggle();
        }}
      >
        <NotchAvatar mood={mood} finish={finish} className="pointer-events-none size-10" />
        {badge > 0 ? <span className="notch-badge">{formatBadge(badge)}</span> : null}
      </button>
      <Popover
        open={cardOpen && !open && !dragging}
        onOpenChange={(next, details) => {
          // Focus moving into the menu or the field is not a reason to dismiss the card.
          if (!next && details?.reason === "focus-out") return;
          if (!next) {
            hold.current = { card: false, input: false, menu: false };
            setCardOpen(false);
          }
        }}
      >
        <PopoverPopup
          anchor={root}
          side={position.current.y > 0.5 ? "top" : "bottom"}
          align={position.current.x > 0.5 ? "end" : "start"}
          sideOffset={10}
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
            teammate={teammate}
            mood={mood}
            finish={finish}
            status={status}
            needs={needs}
            teammates={teammates}
            hold={hold}
            onAsk={onAsk}
            onOpenChat={() => {
              setCardOpen(false);
              onOpenChat();
            }}
            onOpenSpace={() => {
              setCardOpen(false);
              onOpenSpace();
            }}
            onPin={(id) => {
              hold.current = { card: false, input: false, menu: false };
              setCardOpen(false);
              onPin(id);
            }}
            onHide={() => {
              setCardOpen(false);
              onHide();
            }}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
}

function HoverCardBody({
  teammate,
  mood,
  finish,
  status,
  needs,
  teammates,
  hold,
  onAsk,
  onOpenChat,
  onOpenSpace,
  onPin,
  onHide,
}: {
  teammate: Pick<Teammate, "id" | "name">;
  mood: TeammateMood;
  finish: TeammateFinish;
  status: string;
  needs: ReadonlyArray<AvatarNeed>;
  teammates: ReadonlyArray<Pick<Teammate, "id" | "name">>;
  hold: React.MutableRefObject<{ card: boolean; input: boolean; menu: boolean }>;
  onAsk: (text: string) => Promise<boolean>;
  onOpenChat: () => void;
  onOpenSpace: () => void;
  onPin: (id: string) => void;
  onHide: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const ok = await onAsk(text);
    setSending(false);
    if (ok) setText("");
  };
  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div className="flex items-center gap-3">
        <NotchAvatar className="size-11 shrink-0" finish={finish} mood={mood} />
        <div className="min-w-0 flex-1">
          <div className="tm-row-title truncate">{teammate.name}</div>
          <div className="tm-supporting truncate">{status}</div>
        </div>
        <Menu
          onOpenChange={(next) => {
            hold.current.menu = next;
          }}
        >
          <MenuTrigger
            aria-label={`${teammate.name} menu`}
            className="no-drag"
            render={<Button size="icon-xs" variant="ghost" />}
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={onOpenSpace}>
              <LayoutGridIcon /> Open Teammates
            </MenuItem>
            <MenuItem onClick={onOpenChat}>
              <MessageSquareIcon /> Open {teammate.name}’s chat
            </MenuItem>
            {teammates.length > 1 ? (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>
                    <PinIcon className="me-1 inline size-3" /> Show on my screen
                  </MenuGroupLabel>
                  <MenuRadioGroup
                    value={teammate.id}
                    onValueChange={(value) => onPin(String(value))}
                  >
                    {teammates.map((entry) => (
                      <MenuRadioItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </>
            ) : null}
            <MenuSeparator />
            <MenuItem onClick={onHide}>
              <EyeOffIcon /> Hide this avatar
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {needs.length > 0 ? (
        <div className="flex flex-col gap-1.5" aria-label="Needs you">
          <div className="tm-section-title">Needs you</div>
          {needs.slice(0, 3).map((need) => (
            <button
              key={need.id}
              type="button"
              className="tm-supporting no-drag block text-left text-foreground hover:underline"
              onClick={onOpenSpace}
            >
              {need.question ?? need.title}
            </button>
          ))}
          {needs.length > 3 ? <div className="tm-meta">and {needs.length - 3} more</div> : null}
        </div>
      ) : null}
      <Input
        aria-label={`Ask ${teammate.name}`}
        placeholder={`Ask ${teammate.name}…`}
        value={text}
        disabled={sending}
        className="no-drag"
        onFocus={() => {
          hold.current.input = true;
        }}
        onBlur={() => {
          hold.current.input = false;
        }}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) void send();
        }}
      />
    </div>
  );
}
