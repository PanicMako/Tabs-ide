/**
 * Marks whichever element is scrolling with `data-scrolling` so the global scrollbar style
 * (index.css) can reveal its thumb while it moves, not only on hover. Scroll events do not
 * bubble, so a single capturing listener on the document covers every scroller.
 */
const HIDE_AFTER_MS = 900;

export function installScrollingIndicator(doc: Document = document): () => void {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();

  const onScroll = (event: Event) => {
    const target = event.target;
    const el = target instanceof Element ? target : target === doc ? doc.documentElement : null;
    if (!el || el.matches("[data-slot=scroll-area-viewport]")) return;
    const pending = timers.get(el);
    if (pending !== undefined) clearTimeout(pending);
    else el.setAttribute("data-scrolling", "");
    timers.set(
      el,
      setTimeout(() => {
        timers.delete(el);
        el.removeAttribute("data-scrolling");
      }, HIDE_AFTER_MS),
    );
  };

  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    doc.removeEventListener("scroll", onScroll, { capture: true });
    for (const [el, timer] of timers) {
      clearTimeout(timer);
      el.removeAttribute("data-scrolling");
    }
    timers.clear();
  };
}
