import gsap from "gsap";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";

import { cn } from "~/lib/utils";
import { useSurfaceMotionSettings } from "~/panelAnimations";

interface DisclosureContextValue {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly panelId: string;
}

const DisclosureContext = createContext<DisclosureContextValue | null>(null);

/**
 * App-owned disclosure that replaces native `<Details>`. It renders a plain element that
 * mirrors the `open` attribute, so existing `[open]` selectors and Tailwind `group-open:`
 * variants keep working, while the summary is a real keyboard-operable button-role control.
 * Children other than `<Summary>` are hidden while closed (see index.css).
 */
function Details({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "onToggle"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const startHeight = useRef<number | null>(null);
  const firstRun = useRef(true);
  const { active, seconds, profile } = useSurfaceMotionSettings();

  // Quick height + opacity enter/exit. Children stay displayed while closing (`data-closing`)
  // so the exit can play; reduced motion or suppressed panels skip straight to the end state.
  useLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const el = rootRef.current;
    const from = startHeight.current;
    startHeight.current = null;
    if (!el || from === null || !active) return;
    const panels = Array.from(el.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.tagName !== "SUMMARY",
    );
    const finish = () => {
      el.removeAttribute("data-closing");
      gsap.set([el, ...panels], { clearProps: "height,overflow,opacity" });
    };
    gsap.killTweensOf([el, ...panels]);
    if (open) {
      const to = el.scrollHeight;
      gsap.fromTo(
        el,
        { height: from, overflow: "hidden" },
        {
          height: to,
          duration: seconds(0.22),
          ease: profile.ease,
          onComplete: finish,
          overwrite: true,
        },
      );
      gsap.fromTo(
        panels,
        { opacity: 0 },
        { opacity: 1, duration: seconds(0.2), ease: profile.ease, overwrite: true },
      );
    } else {
      el.setAttribute("data-closing", "");
      el.style.height = "";
      el.removeAttribute("data-closing");
      const to = el.offsetHeight;
      el.setAttribute("data-closing", "");
      gsap.fromTo(
        el,
        { height: from, overflow: "hidden" },
        {
          height: to,
          duration: seconds(0.16),
          ease: profile.exitEase,
          onComplete: finish,
          overwrite: true,
        },
      );
      gsap.to(panels, {
        opacity: 0,
        duration: seconds(0.14),
        ease: profile.exitEase,
        overwrite: true,
      });
    }
  }, [open, active, seconds, profile]);

  const toggle = useCallback(() => {
    startHeight.current = rootRef.current?.offsetHeight ?? null;
    const next = !open;
    if (controlledOpen === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange, open]);
  const value = useMemo(() => ({ open, toggle, panelId }), [open, toggle, panelId]);
  return (
    <DisclosureContext.Provider value={value}>
      <div
        ref={rootRef}
        data-slot="disclosure"
        {...props}
        data-disclosure=""
        data-state={open ? "open" : "closed"}
        {...(open ? { open: true } : {})}
        className={className}
      >
        {children}
      </div>
    </DisclosureContext.Provider>
  );
}

function Summary({ className, onClick, onKeyDown, children, ...props }: ComponentProps<"summary">) {
  const ctx = useContext(DisclosureContext);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      ctx?.toggle();
    }
  };
  return (
    <summary
      role="button"
      tabIndex={0}
      aria-expanded={ctx?.open ?? false}
      data-slot="disclosure-summary"
      className={cn("cursor-pointer select-none", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) ctx?.toggle();
      }}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </summary>
  );
}

export { Details, Summary };
