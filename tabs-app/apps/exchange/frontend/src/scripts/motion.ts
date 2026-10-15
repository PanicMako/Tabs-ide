// Finite reveals: content remains visible when scripts or animation APIs are unavailable.
const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
const animations = new Set<Animation>();
let observer: IntersectionObserver | undefined;
function stop() {
  observer?.disconnect();
  for (const animation of animations) animation.cancel();
  animations.clear();
}
if (!preference.matches && typeof IntersectionObserver !== "undefined") {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer!.unobserve(entry.target);
        if (typeof entry.target.animate !== "function" || preference.matches) continue;
        const animation = entry.target.animate(
          [
            { opacity: 0.6, transform: "translateY(18px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 550, easing: "cubic-bezier(.22,1,.36,1)" },
        );
        animations.add(animation);
        void animation.finished.then(
          () => animations.delete(animation),
          () => animations.delete(animation),
        );
      }
    },
    { threshold: 0.12 },
  );
  document
    .querySelectorAll(
      ".toolkit-desk, .reference-shelf, .publication-art, .workshop-route nav > a, .extension-story, .upload-art, .operations-art, .operations-panel, .operations-ledger, .publisher-art, .namespace-create-desk, .access-create-desk",
    )
    .forEach((element) => observer!.observe(element));
}
preference.addEventListener("change", stop);
window.addEventListener("pagehide", stop, { once: true });
export {};
