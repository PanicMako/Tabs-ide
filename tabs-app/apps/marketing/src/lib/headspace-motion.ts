// Motion follows the product: projects settle into place, then tools follow.
// Content stays visible without JavaScript.
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const activeAnimations = new Set<Animation>();
function animate(element: Element, frames: Keyframe[], duration = 850, delay = 0) {
  if (preference.matches) return;
  const animation = element.animate(frames, {
    duration,
    delay,
    easing: "cubic-bezier(.22,1,.36,1)",
    fill: "backwards",
  });
  activeAnimations.add(animation);
  const forget = () => activeAnimations.delete(animation);
  animation.addEventListener("finish", forget, { once: true });
  animation.addEventListener("cancel", forget, { once: true });
}
preference.addEventListener("change", () => {
  if (preference.matches) activeAnimations.forEach((animation) => animation.cancel());
});
const rise: Keyframe[] = [
  { opacity: 0, transform: "translateY(24px)" },
  { opacity: 1, transform: "translateY(0)" },
];
function enterHero() {
  document
    .querySelectorAll(".hs-hero-copy > *")
    .forEach((element, index) => animate(element, rise, 1100, 150 + index * 85));
  const art = document.querySelector(".hs-hero-art");
  if (art)
    animate(
      art,
      [
        { opacity: 0, transform: "translateY(35px) rotate(2deg)" },
        { opacity: 1, transform: "translateY(0) rotate(0)" },
      ],
      1400,
      200,
    );
}
const loader = document.getElementById("tabs-page-loader");
if (loader && !loader.hidden)
  document.addEventListener("tabs:intro-complete", enterHero, { once: true });
else enterHero();
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const element = entry.target;
      if (element.matches(".hs-principles, .hs-custom-toolbar, .hs-domain-showcase")) {
        [...element.children].forEach((child, index) =>
          animate(
            child,
            [
              { opacity: 0, transform: "translateY(18px) rotate(-2deg)" },
              { opacity: 1, transform: "translateY(0) rotate(0)" },
            ],
            900,
            index * 90,
          ),
        );
      } else animate(element, rise, 1000);
    }
  },
  { threshold: 0.12 },
);
document
  .querySelectorAll(
    ".hs-room-heading, .hs-room-copy, .hs-principles, .hs-work-heading, .hs-workflow-heading, .hs-custom-toolbar, .hs-domain-showcase, .hs-wcli-layout, .hs-wpreset-copy, .wf-row, .hs-agents",
  )
  .forEach((element) => observer.observe(element));
// This demonstration never executes shell commands or navigates to local servers.
const demo = document.querySelector<HTMLElement>("[data-preset-demo]");
const run = demo?.querySelector<HTMLButtonElement>("[data-preset-run]");
if (demo && run) {
  const rows = [...demo.querySelectorAll<HTMLElement>("[data-preset-step]")];
  const preview = demo.querySelector<HTMLElement>("[data-preset-preview]");
  const status = demo.querySelector<HTMLElement>("[data-preset-status]");
  let timers: number[] = [];
  const reset = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  run.addEventListener("click", () => {
    if (run.getAttribute("aria-disabled") === "true") return;
    reset();
    rows.forEach((row) => (row.dataset.state = "waiting"));
    if (preview) preview.hidden = true;
    run.setAttribute("aria-disabled", "true");
    run.textContent = "Starting example…";
    if (status) status.textContent = "Example: starting the saved command steps.";
    rows.forEach((row, index) => {
      timers.push(
        window.setTimeout(
          () => {
            row.dataset.state = "ready";
          },
          preference.matches ? 0 : 350 + index * 450,
        ),
      );
    });
    timers.push(
      window.setTimeout(
        () => {
          if (preview) {
            preview.hidden = false;
            animate(preview, rise, 650);
          }
          run.setAttribute("aria-disabled", "false");
          run.textContent = "Replay example ↗";
          if (status)
            status.textContent =
              "Example complete. The preset opens its preview URL and switches to Browser.";
        },
        preference.matches ? 0 : 1850,
      ),
    );
  });
  window.addEventListener("pagehide", reset, { once: true });
}
