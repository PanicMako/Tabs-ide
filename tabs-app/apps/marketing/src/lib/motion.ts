// Decorative scenes are procedural, capped at 30fps and stopped offscreen.
// Text and every essential action remain regular, accessible HTML.
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let paused = reduced.matches;
const toggle = document.querySelector<HTMLButtonElement>("[data-motion-toggle]");
function setPaused(value: boolean) {
  paused = value;
  document.documentElement.classList.toggle("motion-paused", paused);
  toggle?.setAttribute("aria-pressed", String(paused));
  toggle?.setAttribute("aria-label", paused ? "Play animations" : "Pause animations");
  if (toggle) toggle.textContent = paused ? "▶" : "Ⅱ";
}
setPaused(paused);
toggle?.addEventListener("click", () => setPaused(!paused));
reduced.addEventListener("change", () => setPaused(reduced.matches));
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) e.target.classList.add("revealed");
  },
  { threshold: 0.13 },
);
document.querySelectorAll("[data-reveal]").forEach((el) => revealObserver.observe(el));
document.documentElement.classList.add("motion-ready");
for (const toy of document.querySelectorAll<HTMLButtonElement>("[data-toy]")) {
  toy.addEventListener("click", () => {
    document
      .querySelectorAll("[data-toy]")
      .forEach((el) => el.setAttribute("aria-pressed", String(el === toy)));
    const response = document.querySelector("[data-toy-response]");
    if (response)
      response.textContent = `${toy.dataset.toy} selected. Mix and match any agent without leaving your code, terminal, or browser.`;
  });
}
for (const card of document.querySelectorAll<HTMLElement>("[data-tilt]")) {
  card.addEventListener("pointermove", (e) => {
    if (paused || e.pointerType === "touch") return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.rotate = `${-y} ${x} 0 5deg`;
    card.style.translate = `${x * 5}px ${y * 5}px`;
  });
  card.addEventListener("pointerleave", () => {
    card.style.rotate = "";
    card.style.translate = "";
  });
}
interface Scene {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  mode: string;
  visible: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  px: number;
  py: number;
  time: number;
  dirty: boolean;
}
const scenes: Scene[] = [];
const visibility = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const scene = scenes.find((s) => s.host === entry.target);
    if (scene) {
      scene.visible = entry.isIntersecting;
      scene.dirty = true;
    }
  }
});
for (const host of document.querySelectorAll<HTMLElement>("[data-art]")) {
  const canvas = host.querySelector("canvas");
  const ctx = canvas?.getContext("2d", { alpha: true });
  if (!canvas || !ctx) continue;
  const scene: Scene = {
    host,
    canvas,
    ctx,
    mode: host.dataset.art!,
    visible: false,
    width: 1,
    height: 1,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    time: 0,
    dirty: true,
  };
  scenes.push(scene);
  new ResizeObserver(() => {
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    scene.width = box.width;
    scene.height = box.height;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene.dirty = true;
  }).observe(host);
  host.addEventListener("pointermove", (e) => {
    const box = host.getBoundingClientRect();
    scene.x = (e.clientX - box.left) / box.width - 0.5;
    scene.y = (e.clientY - box.top) / box.height - 0.5;
  });
  host.addEventListener("pointerleave", () => {
    scene.x = 0;
    scene.y = 0;
  });
  visibility.observe(host);
}
function portal(s: Scene) {
  const { ctx: c, width: w, height: h, time: t } = s;
  c.save();
  c.translate(w * 0.52 + s.px * 30, h * 0.49 + s.py * 20);
  c.rotate(-0.23 + s.px * 0.09);
  const scale = Math.min(w / 950, 1.3);
  for (let i = 70; i >= 0; i--) {
    const f = i / 70;
    const rx = (105 + f * 320) * scale;
    const ry = 65 + f * 126;
    c.beginPath();
    for (let j = 0; j <= 150; j++) {
      const a = (j / 150) * Math.PI * 2;
      const ripple = Math.sin(a * 3 + t * 0.35 + f * 5) * 9 * f;
      const x = Math.cos(a) * (rx + ripple) + Math.sin(f * 5 + t * 0.3) * 15 * f;
      const y = Math.sin(a) * (ry + ripple) + Math.sin(a * 2 + f * 3 + t * 0.2) * 22 * f;
      if (j === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    const glow = Math.sin(f * 6 + t * 0.45) * 0.5 + 0.5;
    c.strokeStyle = `rgba(${Math.round(135 + glow * 85)},${Math.round(126 + glow * 108)},${Math.round(158 + glow * 40)},${0.12 + (1 - f) * 0.42})`;
    c.lineWidth = 0.8;
    c.stroke();
  }
  c.restore();
}
function ribbons(s: Scene) {
  const { ctx: c, width: w, height: h, time: t } = s;
  c.save();
  c.translate(w * 0.51 + s.px * 25, h * 0.5 + s.py * 20);
  c.rotate(-0.24);
  for (let band = 0; band < 3; band++) {
    for (let k = 0; k < 36; k++) {
      const offset = (k - 18) * 2.2;
      c.beginPath();
      for (let j = 0; j <= 130; j++) {
        const f = j / 130;
        const a = f * Math.PI * 2.4 + band * 1.3;
        const x = Math.sin(a + t * 0.15) * w * 0.32 + offset * Math.cos(a);
        const y = (f - 0.5) * h * 0.9 + Math.cos(a * 1.7) * 35 + offset;
        if (j === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      const shade = 70 + Math.round(Math.sin((k / 36) * Math.PI) * 90);
      c.strokeStyle =
        band === 1
          ? `rgba(116,155,72,${0.22 + k / 100})`
          : `rgba(32,${shade},100,${0.18 + k / 100})`;
      c.lineWidth = 1.4;
      c.stroke();
    }
  }
  c.restore();
}
function particles(s: Scene) {
  const { ctx: c, width: w, height: h, time: t } = s;
  const rot = t * 0.12 + s.px * 0.7;
  const size = Math.min(w * 0.32, 240);
  c.save();
  c.translate(w * 0.53, h * 0.48);
  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < 1800; i++) {
    const a = i * 2.399963;
    const v = 1 - (i / 1799) * 2;
    const r = Math.sqrt(1 - v * v);
    const warp = 1 + 0.21 * Math.sin(a * 3 + t * 0.35) * Math.cos(v * 5);
    const x = Math.cos(a) * r * warp,
      y = v * warp,
      z = Math.sin(a) * r * warp;
    const xx = x * Math.cos(rot) + z * Math.sin(rot),
      zz = z * Math.cos(rot) - x * Math.sin(rot);
    points.push({
      x: xx * size,
      y: y * size * 0.72 + Math.sin(xx * 3 + t * 0.3) * 12 + s.py * zz * 30,
      z: zz,
    });
  }
  points.sort((a, b) => a.z - b.z);
  for (const p of points) {
    c.beginPath();
    c.arc(p.x, p.y, 0.6 + (p.z + 1) * 0.6, 0, Math.PI * 2);
    c.fillStyle = `rgba(20,20,20,${0.14 + (p.z + 1) * 0.35})`;
    c.fill();
  }
  c.restore();
}
function garden(s: Scene) {
  const { ctx: c, width: w, height: h, time: t } = s;
  const objects = [
    { x: 0.25, y: 0.54, r: 145, col: ["#eac8dd", "#b69fcd", "#826a9d"] },
    { x: 0.68, y: 0.46, r: 160, col: ["#f5e9d2", "#dec9aa", "#c2a99a"] },
    { x: 0.51, y: 0.68, r: 100, col: ["#e6edc1", "#c3d39f", "#94a876"] },
  ];
  for (let k = 0; k < objects.length; k++) {
    const o = objects[k]!;
    const radius = o.r * Math.min(1, w / 700);
    const x = w * o.x + s.px * (k + 1) * 10,
      y = h * o.y + Math.sin(t * 0.5 + k * 2) * 12 + s.py * 20;
    c.save();
    c.translate(x, y);
    c.rotate(k * 0.7 + t * 0.025);
    const gradient = c.createRadialGradient(-radius * 0.4, -radius * 0.5, 5, 0, 0, radius * 1.4);
    o.col.forEach((color, i) => gradient.addColorStop(i / 2, color));
    c.fillStyle = gradient;
    c.beginPath();
    for (let j = 0; j <= 160; j++) {
      const a = (j / 160) * Math.PI * 2;
      const r = radius * (1 + 0.1 * Math.sin(a * 5 + t * 0.2));
      const xx = Math.cos(a) * r,
        yy = Math.sin(a) * r * 0.9;
      if (j === 0) c.moveTo(xx, yy);
      else c.lineTo(xx, yy);
    }
    c.closePath();
    c.fill();
    for (let i = 0; i < 17; i++) {
      c.beginPath();
      c.ellipse(0, 0, radius * (0.15 + i * 0.046), radius * 0.85, 0, 0, Math.PI * 2);
      c.strokeStyle = "#ffffff25";
      c.lineWidth = 0.7;
      c.stroke();
    }
    c.restore();
  }
}
let last = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  if (document.hidden || now - last < 33) return;
  const delta = Math.min((now - last) / 1000, 0.05);
  last = now;
  for (const s of scenes) {
    if (!s.visible || (!s.dirty && paused)) continue;
    if (!paused) {
      s.time += delta;
      s.px += (s.x - s.px) * 0.07;
      s.py += (s.y - s.py) * 0.07;
    }
    s.ctx.clearRect(0, 0, s.width, s.height);
    if (s.mode === "portal") portal(s);
    else if (s.mode === "ribbons") ribbons(s);
    else if (s.mode === "particles") particles(s);
    else garden(s);
    s.dirty = false;
  }
}
requestAnimationFrame(frame);
