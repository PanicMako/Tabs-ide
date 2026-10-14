import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Shared decoration; each caller continues to own its selection and semantics. */
export function OrbitGroup({
  children,
  className,
  orbitKind = "spotlight",
  symbol,
  onKeyDown,
  onPointerMove,
  ...props
}: ComponentProps<"div"> & {
  orbitKind?: "spotlight" | "theme" | "time" | "icons";
  symbol?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = root.current;
    if (!group) return;
    let frame = 0;
    const observed = new Set<HTMLButtonElement>();
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      const buttons = Array.from(group.children).filter(
        (child): child is HTMLButtonElement => child instanceof HTMLButtonElement,
      );
      for (const button of observed) {
        if (!buttons.includes(button)) {
          resize.unobserve(button);
          observed.delete(button);
        }
      }
      for (const button of buttons) {
        if (!observed.has(button)) {
          resize.observe(button);
          observed.add(button);
        }
      }
      const selected = buttons.find(
        (button) =>
          button.getAttribute("aria-checked") === "true" ||
          button.getAttribute("aria-selected") === "true" ||
          button.getAttribute("aria-pressed") === "true",
      );
      if (!selected) {
        delete group.dataset.orbitReady;
        return;
      }
      const full = group.dataset.orbitKind !== "spotlight";
      const diameter = full ? 36 : selected.offsetWidth;
      const index = buttons.indexOf(selected);
      const x = full
        ? 4 + (index / Math.max(1, buttons.length - 1)) * Math.max(0, group.clientWidth - 44)
        : selected.offsetLeft;
      group.style.setProperty("--orbit-x", `${x}px`);
      group.style.setProperty("--orbit-y", `${full ? 4 : selected.offsetTop}px`);
      group.style.setProperty("--orbit-width", `${diameter}px`);
      group.style.setProperty("--orbit-height", `${full ? 36 : selected.offsetHeight}px`);
      group.dataset.orbitValue =
        selected.dataset.value ?? selected.textContent?.trim().toLowerCase() ?? "";
      group.dataset.orbitReady = "true";
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    const changes = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            !(record.target instanceof Element && record.target.closest("[data-orbit-orb]")),
        )
      )
        schedule();
    });
    changes.observe(group, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "aria-checked",
        "aria-selected",
        "aria-pressed",
        "disabled",
        "data-value",
        "data-orbit-kind",
      ],
    });
    resize.observe(group);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
    };
  }, []);
  return (
    <div
      {...props}
      ref={root}
      data-orbit-kind={orbitKind}
      className={cn("tabs-segmented orbit-group inline-flex items-center", className)}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        if (orbitKind !== "spotlight") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - bounds.left}px`);
        event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - bounds.top}px`);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
        )
          return;
        const buttons = Array.from(event.currentTarget.children).filter(
          (child): child is HTMLButtonElement =>
            child instanceof HTMLButtonElement && !child.disabled,
        );
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0 || !buttons.length) return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + buttons.length) %
                buttons.length;
        buttons[next]?.focus();
        buttons[next]?.click();
      }}
    >
      {children}
      <span data-orbit-orb="" aria-hidden="true" className="orbit-orb">
        {symbol}
      </span>
    </div>
  );
}
