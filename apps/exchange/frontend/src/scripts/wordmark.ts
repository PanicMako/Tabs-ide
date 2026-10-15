import { wordmarkSize } from "../lib/wordmarkSize";
const wordmark = document.querySelector<HTMLElement>('.exchange-signature[data-official="true"]');
if (wordmark) {
  let disposed = false;
  let lastWidth = 0;
  const fit = (force = false) => {
    if (disposed || !wordmark.isConnected) return;
    const available = wordmark.clientWidth;
    if (!force && available === lastWidth) return;
    lastWidth = available;
    // Font shaping and pixel rounding are not perfectly proportional across sizes.
    // Remeasure after sizing so a desktop-to-mobile resize cannot leave overflow.
    for (let pass = 0; pass < 3; pass++) {
      const current = Number.parseFloat(getComputedStyle(wordmark).fontSize);
      const width = [...wordmark.children].reduce(
        (sum, child) => sum + child.getBoundingClientRect().width,
        0,
      );
      const size = wordmarkSize(available, width, current);
      if (size <= 0 || Math.abs(size - current) < 0.01) break;
      wordmark.style.fontSize = `${size}px`;
    }
  };
  const observer = new ResizeObserver(() => fit());
  observer.observe(wordmark);
  fit(true);
  void document.fonts.ready.then(() => fit(true));
  const cleanup = new AbortController();
  window.addEventListener(
    "pagehide",
    (event) => {
      disposed = true;
      observer.disconnect();
      if (!event.persisted) cleanup.abort();
    },
    { signal: cleanup.signal },
  );
  window.addEventListener(
    "pageshow",
    (event) => {
      if (!event.persisted) return;
      disposed = false;
      observer.observe(wordmark);
      fit(true);
    },
    { signal: cleanup.signal },
  );
}
