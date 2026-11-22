import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { useEffect, useRef, useState } from "react";

import { Tooltip, TooltipPopup } from "./tooltip";

const SHOW_DELAY_MS = 450;
const TITLE_ATTR_SELECTOR = "[title]";
const STASH_ATTR = "data-tooltip-title";

/** Elements whose `title` is an accessibility name, not a hover hint. */
function isTooltipTarget(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "IFRAME" || el.tagName === "TITLE" || el.tagName === "ABBR") return false;
  return true;
}

/**
 * Moves an element's native `title` into data-tooltip-title so the OS tooltip never shows,
 * keeping an accessible name for icon-only controls. Returns the tooltip text.
 */
export function stashNativeTitle(el: HTMLElement): string | null {
  const title = el.getAttribute("title")?.trim();
  if (el.hasAttribute("title")) el.removeAttribute("title");
  if (title) {
    el.setAttribute(STASH_ATTR, title);
    if (
      !el.hasAttribute("aria-label") &&
      !el.hasAttribute("aria-labelledby") &&
      !(el.textContent ?? "").trim() &&
      (el.matches("button, a, [role=button], [role=menuitem], input, [role=tab]") ||
        el.hasAttribute("tabindex"))
    ) {
      el.setAttribute("aria-label", title);
    }
    return title;
  }
  return el.getAttribute(STASH_ATTR);
}

export function findTitleTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  const el = start.closest(`${TITLE_ATTR_SELECTOR}, [${STASH_ATTR}]`);
  return el && isTooltipTarget(el) ? el : null;
}

/**
 * Renders every `title="..."` hint in the app through the themed Tooltip instead of the
 * operating system's native tooltip. One delegated listener covers all current and future
 * call sites; mount it once near the app root.
 */
export function TitleTooltipHost() {
  const [state, setState] = useState<{ el: HTMLElement; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clear();
      setState(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      const text = stashNativeTitle(el);
      if (!text) return;
      clear();
      timer.current = setTimeout(() => {
        if (el.isConnected) setState({ el, text });
      }, delay);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const el = findTitleTarget(event.target);
      if (!el) return;
      // Strip immediately so the browser's own tooltip can never start its timer.
      const text = stashNativeTitle(el);
      if (!text) return;
      setState((current) => (current?.el === el ? current : null));
      show(el, SHOW_DELAY_MS);
    };
    const onOut = (event: PointerEvent) => {
      const el = findTitleTarget(event.target);
      if (el && event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) return;
      hide();
    };
    const onFocus = (event: FocusEvent) => {
      const el = findTitleTarget(event.target);
      if (el?.matches(":focus-visible")) show(el, 0);
    };
    const opts = { capture: true } as const;
    document.addEventListener("pointerover", onOver, opts);
    document.addEventListener("pointerout", onOut, opts);
    document.addEventListener("pointerdown", hide, opts);
    document.addEventListener("keydown", hide, opts);
    document.addEventListener("scroll", hide, opts);
    document.addEventListener("focusin", onFocus, opts);
    document.addEventListener("focusout", hide, opts);
    return () => {
      document.removeEventListener("pointerover", onOver, opts);
      document.removeEventListener("pointerout", onOut, opts);
      document.removeEventListener("pointerdown", hide, opts);
      document.removeEventListener("keydown", hide, opts);
      document.removeEventListener("scroll", hide, opts);
      document.removeEventListener("focusin", onFocus, opts);
      document.removeEventListener("focusout", hide, opts);
      clear();
    };
  }, []);

  return (
    <TooltipPrimitive.Provider>
      <Tooltip open={state !== null} onOpenChange={(open) => !open && setState(null)}>
        <TooltipPopup anchor={state?.el ?? null} side="top" className="max-w-72">
          <span data-slot="title-tooltip-text" className="whitespace-pre-line">
            {state?.text}
          </span>
        </TooltipPopup>
      </Tooltip>
    </TooltipPrimitive.Provider>
  );
}
