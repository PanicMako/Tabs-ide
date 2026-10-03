// Short, one-time entrances. No scroll capture, continuous loops, or hidden content.
export {};
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const running = new Set<Animation>();
function play(element: Element, frames: Keyframe[], duration = 850, delay = 0) {
  if (reduced.matches || document.hidden) return;
  const animation = element.animate(frames, {
    duration,
    delay,
    easing: "cubic-bezier(.22,1,.36,1)",
    fill: "backwards",
  });
  running.add(animation);
  const forget = () => running.delete(animation);
  animation.addEventListener("finish", forget, { once: true });
  animation.addEventListener("cancel", forget, { once: true });
}
const rise = [
  { opacity: 0, transform: "translateY(22px)" },
  { opacity: 1, transform: "translateY(0)" },
];
function intro() {
  document
    .querySelectorAll(".e2-hero > .e2-eyebrow, .e2-hero h1, .e2-hero-bottom")
    .forEach((el, i) =>
      play(
        el,
        [
          { opacity: 0, transform: "translateY(24px)", clipPath: "inset(0 0 100% 0)" },
          { opacity: 1, transform: "translateY(0)", clipPath: "inset(0 0 0% 0)" },
        ],
        1100,
        i * 130,
      ),
    );
}
const loader = document.querySelector<HTMLElement>("#tabs-page-loader");
if (loader && !loader.hidden)
  document.addEventListener("tabs:intro-complete", intro, { once: true });
else intro();
const entrances = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entrances.unobserve(entry.target);
      const el = entry.target;
      if (el.matches(".e2-project-tabs, .tour-nav, .tool-setup-paths")) {
        [...el.children].forEach((child, i) =>
          play(
            child,
            [
              { opacity: 0, transform: "translateY(18px) rotate(-2deg)" },
              { opacity: 1, transform: "translateY(0) rotate(0)" },
            ],
            800,
            i * 75,
          ),
        );
      } else if (el.matches(".e2-design-circle")) {
        play(
          el,
          [
            { transform: "translateX(80px) scale(.5)", opacity: 0 },
            { transform: "translateX(0) scale(1)", opacity: 1 },
          ],
          1250,
        );
      } else if (el.matches(".e2-design-square")) {
        play(
          el,
          [
            { transform: "translateY(-40px) rotate(-25deg)", opacity: 0 },
            { transform: "translateY(0) rotate(20deg)", opacity: 1 },
          ],
          1300,
          120,
        );
      } else if (el.matches(".e2-cross")) {
        play(
          el,
          [
            { transform: "rotate(-90deg) scale(.7)", opacity: 0 },
            { transform: "rotate(0) scale(1)", opacity: 1 },
          ],
          1500,
        );
      } else if (el.matches(".e2-stage")) {
        play(
          el,
          [
            { opacity: 0, transform: "perspective(1200px) rotateX(7deg) translateY(35px)" },
            { opacity: 1, transform: "perspective(1200px) rotateX(0deg) translateY(0)" },
          ],
          1100,
        );
      } else play(el, rise, 950);
    }),
  { threshold: 0.15 },
);
document
  .querySelectorAll(
    ".e2-stage, .e2-project-tabs, .e2-principle, .e2-cross, .e2-section-heading, .tour-nav, .tool-setup-paths, .gallery-summary, .gallery-image-stage, .diagnostics-window-showcase, .e2-workflow-studio, .e2-design-circle, .e2-design-square, .agent-roster-intro, .e2-release, .hs-end-top, .platform-shelf, .hs-cl-release",
  )
  .forEach((el) => entrances.observe(el));
const stop = () => running.forEach((animation) => animation.cancel());
reduced.addEventListener("change", () => {
  if (reduced.matches) stop();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
