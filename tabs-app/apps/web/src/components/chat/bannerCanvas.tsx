import { useEffect, useRef } from "react";

/**
 * Shared plumbing for the live strips in composer banners (`/overmind`,
 * ultrathink): the spectrum and a canvas that tracks size, pointer and clicks.
 */

export type Rgb = readonly [number, number, number];

/** The same stops as `--ultrathink-spectrum`, so every banner reads as one family. */
const SPECTRUM: ReadonlyArray<Rgb> = [
  [255, 107, 107],
  [245, 158, 11],
  [34, 197, 94],
  [20, 184, 166],
  [59, 130, 246],
  [236, 72, 153],
  [255, 107, 107],
];

export function spectrum(position: number): Rgb {
  const u = ((position % 1) + 1) % 1;
  const scaled = u * (SPECTRUM.length - 1);
  const index = Math.floor(scaled);
  const f = scaled - index;
  const a = SPECTRUM[index]!;
  const b = SPECTRUM[index + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${Math.max(0, Math.min(1, alpha))})`;
}

/** Stable noise in [0, 1). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** How strongly a click ring sits on `distance` at `age`. */
export function ring(
  distance: number,
  age: number,
  speed: number,
  width: number,
  decay: number,
): number {
  const d = distance - age * speed;
  return Math.exp(-(d * d) / (2 * width * width)) * Math.exp(-age * decay);
}

export interface Pulse {
  readonly x: number;
  readonly y: number;
  readonly born: number;
}

export interface BannerFrame {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  /** Seconds since mount; pulses use the same clock. */
  readonly time: number;
  readonly dt: number;
  readonly pointer: { readonly x: number; readonly y: number; readonly active: boolean };
  readonly pulses: ReadonlyArray<Pulse>;
  readonly dark: boolean;
}

/** Draws one frame. Made fresh per mount, so it may keep its own state. */
export type BannerArt = (frame: BannerFrame) => void;

/**
 * A canvas filling its positioned parent. `makeArt` runs again whenever `artKey`
 * changes; reduced motion gets a single settled frame.
 */
export function BannerCanvas(props: {
  readonly artKey: string;
  readonly makeArt: () => BannerArt;
  readonly className: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const makeArtRef = useRef(props.makeArt);
  makeArtRef.current = props.makeArt;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const art = makeArtRef.current();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let last = start;
    let width = 0;
    let height = 0;
    let raf = 0;
    const pointer = { x: 0, y: 0, active: false };
    let pulses: Pulse[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const toLocal = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    };
    const onMove = (event: PointerEvent) => {
      toLocal(event);
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    const onDown = (event: PointerEvent) => {
      toLocal(event);
      pulses.push({ x: pointer.x, y: pointer.y, born: (performance.now() - start) / 1000 });
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);

    const draw = (now: number) => {
      const time = (now - start) / 1000;
      const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
      last = now;
      pulses = pulses.filter((pulse) => time - pulse.born < 3);
      art({
        ctx,
        width,
        height,
        time,
        dt,
        pointer,
        pulses,
        dark: document.documentElement.classList.contains("dark"),
      });
    };
    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    if (reduced) {
      for (let i = 0; i < 40; i += 1) draw(start + 2000 + i * 16);
    } else {
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, [props.artKey]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-banner-art={props.artKey}
      className={`${props.className} absolute inset-0 h-full w-full`}
    />
  );
}
