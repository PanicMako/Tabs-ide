const cursor = document.querySelector<HTMLElement>(".tabs-cursor");
if (cursor) {
  const enabled = matchMedia(
    "(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)",
  );
  const toy = cursor.querySelector<HTMLElement>(".cursor-toy")!;
  const sheets = [...cursor.querySelectorAll<HTMLElement>(".cursor-tab")];
  const symbol = cursor.querySelector<HTMLElement>("[data-cursor-symbol]")!;
  let frame = 0,
    lastTime = 0,
    px = 0,
    py = 0,
    fx = 0,
    fy = 0,
    angle = 0,
    spin = 0,
    targetSpin = 0,
    spread = 0,
    flick = 0;
  let overAction = false,
    pressed = false;
  let scrollFrame = 0,
    scrollTimer = 0;
  const hide = () => {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(scrollFrame);
    clearTimeout(scrollTimer);
    scrollFrame = 0;
    cursor.dataset.scrolling = "false";
    frame = 0;
    lastTime = 0;
    pressed = false;
    cursor.dataset.pressed = "false";
    document.documentElement.classList.remove("tabs-cursor-active");
  };
  const draw = (now: number) => {
    const dt = Math.min((now - (lastTime || now - 16)) / 1000, 0.032);
    lastTime = now;
    const follow = 1 - Math.exp(-18 * dt),
      settle = 1 - Math.exp(-12 * dt);
    const dx = px - fx,
      dy = py - fy;
    fx += dx * follow;
    fy += dy * follow;
    // The toy trails, but the dot always remains on the real hit point.
    const lean = Math.max(-32, Math.min(32, dx * 0.8));
    angle += (lean - angle) * settle;
    spin += (targetSpin - spin) * (1 - Math.exp(-10 * dt));
    flick *= Math.exp(-6 * dt);
    const targetSpread =
      (overAction ? 0 : 9) + Math.min(13, Math.hypot(dx, dy) * 0.15) + flick * 20;
    spread += (targetSpread - spread) * settle;
    const side = px > innerWidth - 65 ? -34 : 19;
    const above = py > innerHeight - 65 ? -36 : 20;
    const scale = (pressed ? 0.78 : overAction ? 0.9 : 1) + flick * 0.08;
    toy.style.transform = `translate(${fx - px + side}px,${fy - py + above}px) rotate(${angle}deg) scale(${scale})`;
    sheets[0]!.style.transform = `translate(${-spread * 0.45}px,${spread * 0.12}px) rotate(${-spread * 2.3}deg)`;
    sheets[1]!.style.transform = `translate(${spread * 0.4}px,${-spread * 0.18}px) rotate(${spread * 1.9}deg)`;
    sheets[2]!.style.transform = `translateY(${-flick * 4}px) rotate(${-angle * 0.25}deg)`;
    symbol.style.transform = `rotate(${overAction ? 0 : spin}deg)`;
    const unsettled =
      Math.abs(px - fx) +
      Math.abs(py - fy) +
      Math.abs(angle) +
      Math.abs(targetSpread - spread) +
      Math.abs(targetSpin - spin) +
      flick;
    frame = unsettled > 0.12 ? requestAnimationFrame(draw) : 0;
    if (!frame) lastTime = 0;
  };
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const updateTarget = (target: Element) => {
    const action = target.closest(
      "a[href],button:not(:disabled):not([aria-disabled=true]),summary",
    );
    overAction = Boolean(action);
    const download =
      action instanceof HTMLAnchorElement &&
      (action.hasAttribute("download") ||
        action.matches(".cta,.platform-download,.hs-nav-download") ||
        /download/i.test(action.textContent ?? ""));
    symbol.textContent = overAction
      ? download
        ? "↓"
        : action?.matches("[role=tab]")
          ? "+"
          : "↗"
      : "✳";
    cursor.dataset.mode = overAction ? (download ? "download" : "action") : "play";
    cursor.dataset.footer = String(Boolean(target.closest("footer")));
    // Match the pointer to the first opaque surface under it; never recolor the toy.
    let surface: Element | null = target;
    let light = false;
    while (surface) {
      const rgb = getComputedStyle(surface)
        .backgroundColor.match(/[\d.]+/g)
        ?.map(Number);
      if (rgb && rgb.length >= 3 && (rgb[3] ?? 1) > 0.8) {
        light = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722 < 140;
        break;
      }
      surface = surface.parentElement;
    }
    cursor.dataset.pointerLight = String(light);
  };
  document.addEventListener(
    "pointermove",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        !enabled.matches ||
        event.pointerType !== "mouse" ||
        !target ||
        target.closest(
          "input,textarea,select,[contenteditable],iframe,[inert],button:disabled,[aria-disabled=true]",
        )
      ) {
        hide();
        return;
      }
      px = event.clientX;
      py = event.clientY;
      if (!document.documentElement.classList.contains("tabs-cursor-active")) {
        fx = px;
        fy = py;
        angle = 0;
        spread = 0;
      }
      // Native dialogs occupy the top layer; keep the cursor in that same layer.
      const layer = target.closest("dialog[open]") ?? document.body;
      if (cursor.parentElement !== layer) layer.append(cursor);
      updateTarget(target);
      cursor.style.transform = `translate(${px}px,${py}px)`;
      document.documentElement.classList.add("tabs-cursor-active");
      wake();
    },
    { passive: true },
  );
  document.addEventListener("pointerdown", (event) => {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      !document.documentElement.classList.contains("tabs-cursor-active")
    )
      return;
    pressed = true;
    flick = 1;
    targetSpin += 90;
    cursor.dataset.pressed = "true";
    wake();
  });
  document.addEventListener("pointerup", () => {
    pressed = false;
    cursor.dataset.pressed = "false";
    if (document.documentElement.classList.contains("tabs-cursor-active")) {
      flick = Math.max(flick, 0.6);
      wake();
    }
  });
  document.addEventListener("pointercancel", hide);
  document.documentElement.addEventListener("pointerleave", hide);
  document.addEventListener("keydown", hide);
  document.addEventListener("close", hide, true);
  document.addEventListener("focusin", (event) => {
    if (
      event.target instanceof Element &&
      event.target.matches("input,textarea,select,[contenteditable]")
    )
      hide();
  });
  window.addEventListener("pagehide", hide);
  window.addEventListener(
    "scroll",
    () => {
      if (!enabled.matches || !document.documentElement.classList.contains("tabs-cursor-active"))
        return;
      cursor.dataset.scrolling = "true";
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        cursor.dataset.scrolling = "false";
      }, 160);
      if (!scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0;
          const target = document.elementFromPoint(px, py);
          if (
            !target ||
            target.closest(
              "input,textarea,select,[contenteditable],iframe,[inert],button:disabled,[aria-disabled=true]",
            )
          ) {
            hide();
            return;
          }
          updateTarget(target);
          wake();
        });
    },
    { capture: true, passive: true },
  );
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  enabled.addEventListener("change", hide);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hide();
  });
}

export {};
