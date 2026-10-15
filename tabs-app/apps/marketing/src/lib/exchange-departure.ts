import "../styles/exchange-departure.css";

let departure: HTMLElement | undefined;
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

function resetDeparture() {
  document.documentElement.classList.remove("exchange-is-leaving");
  departure?.remove();
  departure = undefined;
  clearTimeout(cleanupTimer);
}

window.addEventListener("pageshow", resetDeparture);

document.addEventListener("click", (event) => {
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-exchange-departure]")
      : null;
  if (
    !link ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.hasAttribute("download") ||
    (link.target && link.target !== "_self") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof Element.prototype.animate !== "function"
  )
    return;

  // Keep the real anchor as the fallback, including modifier keys and reduced motion.
  if (departure) return;
  const sheet = document.createElement("div");
  sheet.className = "exchange-departure";
  sheet.setAttribute("aria-hidden", "true");
  const mark = document.createElement("span");
  mark.className = "exchange-departure__mark";
  mark.textContent = "*";
  const title = document.createElement("span");
  title.className = "exchange-departure__title";
  title.textContent = "Tabs Exchange";
  sheet.append(mark, title);

  const rect = link.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const destination = link.href;

  try {
    document.documentElement.classList.add("exchange-is-leaving");
    document.body.append(sheet);
    const reveal = sheet.animate(
      [
        { clipPath: `circle(0px at ${x}px ${y}px)` },
        { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
      ],
      { duration: 420, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" },
    );
    mark.animate(
      [
        { transform: "rotate(-70deg) scale(.65)", opacity: 0 },
        { transform: "rotate(0deg) scale(1)", opacity: 1 },
      ],
      { duration: 420, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" },
    );
    title.animate(
      [
        { transform: "translateY(18px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: 320, delay: 70, easing: "ease-out", fill: "both" },
    );
    departure = sheet;
    event.preventDefault();
    const navigate = () => {
      // A slow destination must never leave the current page covered indefinitely.
      cleanupTimer = setTimeout(resetDeparture, 1500);
      window.location.assign(destination);
    };
    void reveal.finished.then(navigate, navigate);
  } catch {
    sheet.remove();
    resetDeparture();
  }
});
