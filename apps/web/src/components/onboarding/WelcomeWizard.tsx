import { useAtomValue } from "@effect/atom-react";
import type { DesktopCodeHostState } from "@tabs/contracts";
import {
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  FlaskConicalIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GlobeIcon,
  LaptopIcon,
  MoonIcon,
  MonitorIcon,
  SunIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  PaletteIcon,
  TerminalIcon,
  TerminalSquareIcon,
  Volume2Icon,
  VolumeXIcon,
  WorkflowIcon,
  XIcon,
  LayersIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCompleteOnboarding } from "../../onboarding/firstRun";
import { readNativeApi } from "../../nativeApi";
import { newCommandId, newProjectId, cn } from "../../lib/utils";
import { readModelStateAtom } from "../../state/readModel";
import { updateClientSettings } from "../../state/settings";
import { APP_VERSION } from "../../branding";
import { ClaudeAI, GoogleGemini, OpenAI, OpenCodeIcon } from "../Icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  BRIGHT_WALLPAPERS,
  WALLPAPERS,
  getInitialWallpaper,
  saveWallpaperPreference,
} from "./wallpapers";
import { WallpaperTopBar } from "./WallpaperTopBar";
import { WallpaperGalleryModal } from "./WallpaperGalleryModal";

export interface WelcomeWizardProps {
  readonly onDone?: () => void;
}

interface PrototypeTool {
  readonly id: string;
  readonly label: string;
  readonly iconKind:
    | "code"
    | "agents"
    | "launchpad"
    | "claude"
    | "git"
    | "browser"
    | "figma"
    | "chatgpt"
    | "testing"
    | "terminal";
}

interface PrototypeProject {
  readonly id: string;
  readonly name: string;
  readonly branch: string;
  readonly description: string;
  readonly tools: readonly PrototypeTool[];
}

const INITIAL_PROJECTS: readonly PrototypeProject[] = [
  {
    id: "project-1",
    name: "Project 1",
    branch: "main",
    description: "Production Web Service • 5 dedicated tools",
    tools: [
      { id: "code", label: "Code", iconKind: "code" },
      { id: "agents", label: "Agents", iconKind: "agents" },
      { id: "git", label: "Git", iconKind: "git" },
      { id: "browser", label: "Browser", iconKind: "browser" },
      { id: "testing", label: "Testing (optional)", iconKind: "testing" },
    ],
  },
  {
    id: "project-2",
    name: "Project 2",
    branch: "feat/ai-onboarding",
    description: "Full-Stack AI Application • 9 dedicated tools",
    tools: [
      { id: "code", label: "Code", iconKind: "code" },
      { id: "agents", label: "Agents", iconKind: "agents" },
      { id: "launchpad", label: "Launchpad", iconKind: "launchpad" },
      { id: "claude", label: "claude", iconKind: "claude" },
      { id: "git", label: "Git", iconKind: "git" },
      { id: "browser", label: "Browser", iconKind: "browser" },
      { id: "figma", label: "figma", iconKind: "figma" },
      { id: "chatgpt", label: "chatgpt", iconKind: "chatgpt" },
      { id: "testing", label: "Testing (optional)", iconKind: "testing" },
    ],
  },
  {
    id: "project-3",
    name: "Project 3",
    branch: "main",
    description: "Native Desktop Runtime • 6 dedicated tools",
    tools: [
      { id: "code", label: "Code", iconKind: "code" },
      { id: "agents", label: "Agents", iconKind: "agents" },
      { id: "launchpad", label: "Launchpad", iconKind: "launchpad" },
      { id: "git", label: "Git", iconKind: "git" },
      { id: "terminal", label: "Terminal", iconKind: "terminal" },
      { id: "testing", label: "Testing (optional)", iconKind: "testing" },
    ],
  },
];

const PROTOTYPE_PROJECTS = INITIAL_PROJECTS;
const SAMPLE_PROJECTS = INITIAL_PROJECTS;

function renderToolIcon(iconKind: PrototypeTool["iconKind"]) {
  switch (iconKind) {
    case "code":
      return <WorkflowIcon className="size-3.5" />;
    case "agents":
      return <BotIcon className="size-3.5" />;
    case "launchpad":
      return <RocketIcon className="size-3.5" />;
    case "claude":
      return <ClaudeAI className="size-3.5" />;
    case "git":
      return <GitBranchIcon className="size-3.5" />;
    case "browser":
    case "figma":
      return <GlobeIcon className="size-3.5" />;
    case "chatgpt":
      return <OpenAI className="size-3.5" />;
    case "testing":
      return <FlaskConicalIcon className="size-3.5" />;
    case "terminal":
      return <TerminalSquareIcon className="size-3.5" />;
  }
}

const PROVIDERS = [
  {
    id: "codex",
    name: "Codex",
    icon: OpenAI,
    badge: "Official Daemon",
    tagline: "Autonomous multi-turn tool execution & structured diffs",
  },
  {
    id: "claude",
    name: "Claude",
    icon: ClaudeAI,
    badge: "Architectural Synthesis",
    tagline: "Deep thinking, MCP tools, and whole-codebase reasoning",
  },
  {
    id: "gemini",
    name: "Gemini",
    icon: GoogleGemini,
    badge: "Multimodal Speed",
    tagline: "Massive context window & low-latency repository indexing",
  },
  {
    id: "local",
    name: "Local Models",
    icon: OpenCodeIcon,
    badge: "Zero Egress",
    tagline: "100% private offline weights via Ollama or custom endpoints",
  },
] as const;

// ── Halftone Dissolve Overlay ─────────────────────────────────────────────────
// Transition effect that plays when the user clicks "Launch Tabs".
// Matches the halftone dot-matrix aesthetic of the wizard background:
//
// Phase 1 (0–500ms): The dot grid "activates" — dots brighten in a radial pulse
//   from the center, each dot's radius modulated by the background wave formula
//   plus an expanding radial envelope that races outward.
// Phase 2 (400–900ms): Concentric halftone rings ripple outward. Three
//   successive rings of enlarged dots expand like shock-waves through the field.
// Phase 3 (700–1350ms): Dots bloom to fill — dot radii grow until circles touch,
//   bleeding the screen to solid black one dot-cell at a time. The fill frontier
//   propagates from center to edges following an eased radial curve.
// Phase 4 (1100–1400ms): A brief full-black hold, then the overlay fades to
//   transparent (handled by CSS on the WelcomeWizard parent).
//
// Total duration: ~1.4 s  (same as the removed hyperspace warp)
// ─────────────────────────────────────────────────────────────────────────────
function HalftoneDissolveOverlay({ active }: { readonly active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    const GRID = 6; // must match AnimatedHalftoneCanvas GRID
    const cx = W / 2;
    const cy = H / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy); // corner distance

    const startTime = performance.now();

    const render = (now: number) => {
      const elapsed = now - startTime;
      const TOTAL = 1400; // ms

      W = canvas.width; // re-read in case of resize
      H = canvas.height;

      ctx.clearRect(0, 0, W, H);

      // ── Shared easing helpers ──────────────────────────────────────────
      const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
      const easeInCubic = (x: number) => x * x * x;
      const easeInOutQuart = (x: number) =>
        x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;

      // ── Phase parameters ───────────────────────────────────────────────
      // P1: activation wave  0–600ms
      const p1t = Math.min(Math.max(elapsed, 0) / 600, 1);
      const p1 = easeOutCubic(p1t); // 0→1

      // P2: ring shockwaves  350–1050ms   (3 staggered rings)
      const ringTimings = [350, 520, 690] as const; // ms offsets
      const ringDuration = 580;

      // P3: bloom fill       650–1380ms
      const p3t = Math.min(Math.max(elapsed - 650, 0) / 730, 1);
      const p3 = easeInOutQuart(p3t); // 0→1

      // P4: blackout overlay 1100–1400ms
      const p4t = Math.min(Math.max(elapsed - 1100, 0) / 300, 1);
      const p4 = easeInCubic(p4t);

      // ── Calculate cols/rows ────────────────────────────────────────────
      const cols = Math.ceil(W / GRID) + 2;
      const rows = Math.ceil(H / GRID) + 2;

      // ── Phase 1 + 3: draw every dot ───────────────────────────────────
      // The dot radius at each cell is the SUM of:
      //   base_r  = small static radius (0.7)
      //   wave_r  = same 3-wave modulation as background (continuous feel)
      //   act_r   = P1 radial-activation glow (center-out brightness pulse)
      //   bloom_r = P3 fill bloom (dots expand to fill cells from center)
      //
      // Color transitions: dark dots → bright cyan dots → full black fill
      const t = now / 1000; // continuous time for wave sync

      // We batch all "dark" dots in one path and all "bright" dots in another.
      ctx.beginPath(); // dark halftone dots
      const darkDots: [number, number, number][] = []; // x, y, r

      for (let row = 0; row < rows; row++) {
        const y = (row - 1) * GRID + GRID / 2;
        for (let col = 0; col < cols; col++) {
          const x = (col - 1) * GRID + GRID / 2;

          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const normDist = dist / maxDist; // 0 (center) → 1 (corner)

          // Background wave (same formula as AnimatedHalftoneCanvas)
          const w1 = Math.sin(col * 0.22 + t * 1.3) * Math.sin(row * 0.16 + t * 0.88);
          const w2 = Math.sin(col * 0.09 - row * 0.08 + t * 0.72);
          const w3 = Math.cos((col + row) * 0.07 + t * 1.08) * 0.5;
          const wave = w1 * 0.55 + w2 * 0.3 + w3 * 0.15;

          // P1: activation envelope — a bright radial halo expands outward.
          //   activationFront: how far the wave has traveled (0→1 of maxDist).
          const activationFront = p1 * 1.3; // overshoots to ensure edges are reached
          const activationDist = Math.abs(normDist - activationFront * 0.9);
          const activation = Math.max(0, 1 - activationDist * 7) * p1;

          // P3: bloom — dots behind the fill-frontier grow to cover their cell.
          //   The bloom frontier propagates from center outward.
          const bloomFront = p3 * 1.15;
          const isBloomFilled = normDist < bloomFront; // inside frontier = full black
          const bloomEdgeDist = Math.abs(normDist - bloomFront);
          const isBloomEdge = bloomEdgeDist < 0.08 && !isBloomFilled; // crisp edge ring

          // Full bloom radius = GRID/2 * √2 ensures circles overlap (full coverage)
          const fullR = (GRID / 2) * 1.45;

          // base dot radius (wave-modulated, same as background)
          const baseR = Math.max(0.35, Math.min(2.05, 0.88 + wave * 0.72));

          if (isBloomFilled) {
            // Fully bloomed cell: draw a large black disc that covers the cell
            const bloomR = fullR * Math.min(p3 * 1.4, 1);
            darkDots.push([x, y, Math.max(baseR, bloomR)]);
          } else if (isBloomEdge) {
            // Edge ring: dots partially bloomed
            const edgeFrac = 1 - bloomEdgeDist / 0.08;
            const edgeR = baseR + (fullR - baseR) * edgeFrac * easeInCubic(p3);
            darkDots.push([x, y, edgeR]);
          } else if (activation > 0.05) {
            // Activated by P1 pulse: dot glows brighter (larger) temporarily
            const actR = baseR + activation * 1.4;
            darkDots.push([x, y, Math.min(actR, fullR * 0.7)]);
          } else {
            // Normal halftone dot
            darkDots.push([x, y, baseR]);
          }
        }
      }

      // ── Ring shockwaves (Phase 2) ──────────────────────────────────────
      // Three expanding rings of enlarged dots ripple outward. Each ring is a
      // narrow band: dots whose dist is near the ring radius get a size boost.
      const ringBoosts = new Float32Array(cols * rows);
      for (const ringStart of ringTimings) {
        const rt = Math.min(Math.max(elapsed - ringStart, 0) / ringDuration, 1);
        if (rt <= 0 || rt >= 1) continue;
        const ringRadius = easeOutCubic(rt) * maxDist * 1.1;
        const ringStrength = Math.sin(rt * Math.PI) * 2.2; // rises and falls

        for (let row = 0; row < rows; row++) {
          const y = (row - 1) * GRID + GRID / 2;
          for (let col = 0; col < cols; col++) {
            const x = (col - 1) * GRID + GRID / 2;
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            const d = Math.abs(dist - ringRadius);
            const influence = Math.max(0, 1 - d / (GRID * 4));
            const idx = row * cols + col;
            ringBoosts[idx] = Math.max(ringBoosts[idx]!, influence * ringStrength);
          }
        }
      }

      // Apply ring boost to dot radii and batch-draw
      ctx.beginPath();
      for (let i = 0; i < darkDots.length; i++) {
        const dot = darkDots[i]!;
        const boost = ringBoosts[i] ?? 0;
        const r = Math.max(0.3, Math.min(dot[2] + boost, (GRID / 2) * 1.48));
        const x = dot[0]!;
        const y = dot[1]!;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = "rgba(0, 0, 0, 0.92)";
      ctx.fill();

      // ── P1 Activation glow pass (screen-like bright cyan dots) ─────────
      // Draw a second "bright" layer on top of normal dots for activated cells.
      if (p1 > 0.02 && p3 < 0.85) {
        ctx.beginPath();
        const glowAlpha = p1 * (1 - p3 * 1.2);
        for (let row = 0; row < rows; row++) {
          const y = (row - 1) * GRID + GRID / 2;
          for (let col = 0; col < cols; col++) {
            const x = (col - 1) * GRID + GRID / 2;
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const normDist = dist / maxDist;

            const activationFront = p1 * 1.3;
            const activationDist = Math.abs(normDist - activationFront * 0.9);
            const activation = Math.max(0, 1 - activationDist * 7) * p1;

            if (activation < 0.05) continue;
            const r = 0.7 + activation * 1.3;
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
        }
        // Cyan-tinted glow dots rendered with additive-style high alpha
        ctx.fillStyle = `rgba(100, 220, 255, ${Math.min(glowAlpha * 0.7, 0.65)})`;
        ctx.fill();
      }

      // ── P4: Full blackout ──────────────────────────────────────────────
      if (p4 > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${p4})`;
        ctx.fillRect(0, 0, W, H);
      }

      if (elapsed < TOTAL) {
        animId = requestAnimationFrame(render);
      }
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
    };
  }, [active]);

  if (!active) return null;

  return <canvas ref={canvasRef} className="fixed inset-0 z-50 pointer-events-none" />;
}

// ── Animated Halftone Canvas ────────────────────────────────────────────────
// A dual-canvas overlay that recreates the screen-printed halftone dot matrix
// from the reference image, then brings it to life with:
//   • Traveling 2D sine-wave interference → dots breathe / ripple as a field
//   • Diagonal scan sweeps (cyan/white) that illuminate the dot grid periodically
//   • Data-column streams: bright dots rain down random columns (Matrix-style)
//   • Neural spark clusters: cyan/violet/amber glows that appear and fade
// Two canvases are stacked: dark dots on "multiply", glows on "screen",
// so the halftone darkens proportionally while sparks add pure luminance.
// ────────────────────────────────────────────────────────────────────────────
interface AnimatedHalftoneProps {
  readonly isLaunching: boolean;
  readonly isSkipping: boolean;
}

function AnimatedHalftoneCanvas({ isLaunching, isSkipping }: AnimatedHalftoneProps) {
  const dotRef = useRef<HTMLCanvasElement | null>(null);
  const glowRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const dotCanvas = dotRef.current;
    const glowCanvas = glowRef.current;
    if (!dotCanvas || !glowCanvas) return;
    const dc = dotCanvas.getContext("2d");
    const gc = glowCanvas.getContext("2d");
    if (!dc || !gc) return;

    const GRID = 6; // px between dot centers
    let W = window.innerWidth;
    let H = window.innerHeight;
    const resize = () => {
      W = dotCanvas.width = glowCanvas.width = window.innerWidth;
      H = dotCanvas.height = glowCanvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // ── State types ──────────────────────────────────────────────────────────
    interface Spark {
      cx: number;
      cy: number;
      life: number;
      maxLife: number;
      r: number; // radius in dot-grid units
      hue: number;
    }
    interface DataStream {
      col: number;
      head: number; // fractional row of stream head
      speed: number; // rows/second
      length: number; // trail dot count
      hue: number;
    }

    const sparks: Spark[] = [];
    const streams: DataStream[] = [];
    let nextSpark = performance.now() + 500;
    let nextStream = performance.now() + 1400;
    let scanPos = -0.2;
    let scanActive = false;
    let nextScan = performance.now() + 4500;

    let last = performance.now();
    let animId: number;

    const SPARK_HUES = [195, 258, 145, 38] as const; // cyan, violet, green, amber
    const STREAM_HUES = [195, 258, 145] as const;

    const render = (now: number) => {
      animId = requestAnimationFrame(render);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = now / 1000;

      dc.clearRect(0, 0, W, H);
      gc.clearRect(0, 0, W, H);

      // Fade out by not drawing — CSS opacity handles the visual transition.
      if (isLaunching || isSkipping) return;

      const cols = Math.ceil(W / GRID);
      const rows = Math.ceil(H / GRID);

      // ── Spawn / age sparks ───────────────────────────────────────────────
      if (now > nextSpark && sparks.length < 55) {
        sparks.push({
          cx: Math.floor(Math.random() * cols),
          cy: Math.floor(Math.random() * rows),
          life: 0,
          maxLife: 0.8 + Math.random() * 1.4,
          r: 2 + Math.random() * 6,
          hue: SPARK_HUES[Math.floor(Math.random() * SPARK_HUES.length)]!,
        });
        nextSpark = now + 160 + Math.random() * 500;
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        sparks[i]!.life += dt;
        if (sparks[i]!.life >= sparks[i]!.maxLife) sparks.splice(i, 1);
      }

      // ── Spawn / age data streams ─────────────────────────────────────────
      if (now > nextStream && streams.length < 10) {
        streams.push({
          col: Math.floor(Math.random() * cols),
          head: 0,
          speed: 20 + Math.random() * 38,
          length: 10 + Math.floor(Math.random() * 18),
          hue: STREAM_HUES[Math.floor(Math.random() * STREAM_HUES.length)]!,
        });
        nextStream = now + 500 + Math.random() * 1000;
      }
      for (let i = streams.length - 1; i >= 0; i--) {
        streams[i]!.head += streams[i]!.speed * dt;
        if (streams[i]!.head - streams[i]!.length > rows) streams.splice(i, 1);
      }

      // ── Spawn / advance diagonal scan ───────────────────────────────────
      if (!scanActive && now > nextScan) {
        scanActive = true;
        scanPos = -0.15;
        nextScan = now + 6000 + Math.random() * 7000;
      }
      if (scanActive) {
        scanPos += dt * 0.44;
        if (scanPos > 1.25) scanActive = false;
      }

      // ── DOT CANVAS (mix-blend: multiply) — dark halftone grid ────────────
      // All dots drawn in a SINGLE beginPath call for GPU-batch efficiency.
      dc.beginPath();
      for (let row = 0; row < rows; row++) {
        const y = row * GRID + GRID / 2;
        for (let col = 0; col < cols; col++) {
          const x = col * GRID + GRID / 2;

          // 3-wave interference → flowing liquid-matrix ripple.
          // Two waves travel in perpendicular directions; a third moves diagonally.
          const w1 = Math.sin(col * 0.22 + t * 1.3) * Math.sin(row * 0.16 + t * 0.88);
          const w2 = Math.sin(col * 0.09 - row * 0.08 + t * 0.72);
          const w3 = Math.cos((col + row) * 0.07 + t * 1.08) * 0.5;
          const wave = w1 * 0.55 + w2 * 0.3 + w3 * 0.15; // ≈ –1..1

          const r = Math.max(0.35, Math.min(2.05, 0.88 + wave * 0.72));
          dc.moveTo(x + r, y);
          dc.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      dc.fillStyle = "rgba(0, 0, 0, 0.60)";
      dc.fill();

      // ── GLOW CANVAS (mix-blend: screen) — luminance effects ─────────────

      // Diagonal scan sweep: a narrow bright band that crosses the grid.
      if (scanActive) {
        const diagLen = W + H;
        const bandCenter = scanPos * diagLen;
        const band = 160; // px half-width of the lit band
        // The "diagonal" direction is top-left → bottom-right (45°).
        // We approximate this as a gradient from (bandCenter-band, 0) to (bandCenter, H).
        const gx0 = bandCenter - H - band;
        const gx1 = bandCenter - H + band;
        const scanGrd = gc.createLinearGradient(gx0, H, gx1, 0);
        scanGrd.addColorStop(0, "rgba(160, 230, 255, 0)");
        scanGrd.addColorStop(0.3, "rgba(160, 230, 255, 0)");
        scanGrd.addColorStop(0.5, "rgba(210, 248, 255, 0.20)");
        scanGrd.addColorStop(0.7, "rgba(160, 230, 255, 0)");
        scanGrd.addColorStop(1, "rgba(160, 230, 255, 0)");
        gc.fillStyle = scanGrd;
        gc.fillRect(0, 0, W, H);
      }

      // Data streams — bright dots rain down random columns.
      for (const st of streams) {
        const headRow = Math.floor(st.head);

        // Trail dots (batched)
        gc.beginPath();
        for (let di = 1; di < st.length; di++) {
          const row = headRow - di;
          if (row < 0 || row >= rows) continue;
          const trailFrac = Math.pow(1 - di / st.length, 1.6);
          const dotR = Math.max(0.4, 1.3 * trailFrac);
          const x = st.col * GRID + GRID / 2;
          const y = row * GRID + GRID / 2;
          gc.moveTo(x + dotR, y);
          gc.arc(x, y, dotR, 0, Math.PI * 2);
        }
        gc.fillStyle = `hsla(${st.hue}, 90%, 75%, 0.72)`;
        gc.fill();

        // Head dot — extra bright (separate draw)
        if (headRow >= 0 && headRow < rows) {
          const x = st.col * GRID + GRID / 2;
          const y = headRow * GRID + GRID / 2;
          gc.fillStyle = `hsla(${st.hue}, 100%, 96%, 0.98)`;
          gc.beginPath();
          gc.arc(x, y, 2.1, 0, Math.PI * 2);
          gc.fill();
        }
      }

      // Neural sparks — clustered glowing dot explosions.
      for (const sp of sparks) {
        const prog = sp.life / sp.maxLife;
        const alpha = Math.sin(prog * Math.PI); // rises and falls
        const cx = sp.cx * GRID + GRID / 2;
        const cy = sp.cy * GRID + GRID / 2;
        const glowR = sp.r * GRID + GRID * 1.5;

        // Soft ambient halo
        const grd = gc.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        grd.addColorStop(0, `hsla(${sp.hue}, 95%, 78%, ${alpha * 0.55})`);
        grd.addColorStop(0.5, `hsla(${sp.hue}, 90%, 60%, ${alpha * 0.18})`);
        grd.addColorStop(1, `hsla(${sp.hue}, 90%, 50%, 0)`);
        gc.fillStyle = grd;
        gc.beginPath();
        gc.arc(cx, cy, glowR, 0, Math.PI * 2);
        gc.fill();

        // Core bright dots within the spark cluster
        const coreR = sp.r * 0.65;
        const intR = Math.ceil(coreR);
        gc.beginPath();
        for (let dy = -intR; dy <= intR; dy++) {
          for (let dx = -intR; dx <= intR; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > coreR) continue;
            const col = sp.cx + dx;
            const row = sp.cy + dy;
            if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
            const x = col * GRID + GRID / 2;
            const y = row * GRID + GRID / 2;
            const dotR = Math.max(0.5, 1.7 * (1 - dist / (coreR + 0.01)));
            gc.moveTo(x + dotR, y);
            gc.arc(x, y, dotR, 0, Math.PI * 2);
          }
        }
        gc.fillStyle = `hsla(${sp.hue}, 100%, 92%, ${alpha * 0.92})`;
        gc.fill();
      }
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [isLaunching, isSkipping]);

  const fadeClass = cn(
    "pointer-events-none fixed inset-0 z-2 transition-opacity duration-1000",
    (isLaunching || isSkipping) && "opacity-0",
  );

  return (
    <>
      {/* Dark halftone dot grid — multiply blend darkens the wallpaper proportionally */}
      <canvas ref={dotRef} className={fadeClass} style={{ mixBlendMode: "multiply" }} />
      {/* Neural glow effects — screen blend adds pure luminance (sparks/scan) */}
      <canvas ref={glowRef} className={fadeClass} style={{ mixBlendMode: "screen" }} />
    </>
  );
}

export function WelcomeWizard({ onDone }: WelcomeWizardProps) {
  const completeOnboarding = useCompleteOnboarding();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("codex");
  const [selectedWallpaper, setSelectedWallpaper] = useState<string>(() => {
    return getInitialWallpaper().url;
  });
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(true);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [codeHostState, setCodeHostState] = useState<DesktopCodeHostState | null>(null);
  const [isCheckingCodeHost, setIsCheckingCodeHost] = useState(false);
  const [showBuildGuide, setShowBuildGuide] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  // Setup flow: 0 = showcase prototype, 1 = choose app icon, 2 = choose appearance
  const [setupStep, setSetupStep] = useState<0 | 1 | 2>(0);
  const [selectedAppIcon, setSelectedAppIcon] = useState<"dark" | "light" | "system">(() => {
    try {
      const stored = localStorage.getItem("tabs:settings");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.desktopIconTheme === "light" || parsed.desktopIconTheme === "system") {
          return parsed.desktopIconTheme;
        }
      }
    } catch {}
    return "dark";
  });
  const [selectedAppearance, setSelectedAppearance] = useState<"system" | "dark" | "light">(() => {
    try {
      const storedTheme = localStorage.getItem("tabs:theme");
      if (storedTheme === "tabs-light" || storedTheme === "light") return "light";
      if (storedTheme === "tabs-dark" || storedTheme === "dark") return "dark";
      if (storedTheme === "system") return "system";
    } catch {}
    return "system";
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true,
  );

  // Prototype interactive state: dynamic project list and per-project tool state
  const [projectsList, setProjectsList] = useState<PrototypeProject[]>([...INITIAL_PROJECTS]);
  const [activeProjectId, setActiveProjectId] = useState<string>("project-2");
  const [activeToolsByProject, setActiveToolsByProject] = useState<Record<string, string>>({
    "project-1": "agents",
    "project-2": "agents",
    "project-3": "code",
  });

  const readModel = useAtomValue(readModelStateAtom);
  const projects = readModel.projects;

  // Web Audio Lo-Fi Ambient Synthesizer (Zero dependencies, runs natively)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const chordTimerRef = useRef<number | null>(null);

  const stopMusic = useCallback(() => {
    if (chordTimerRef.current) {
      window.clearTimeout(chordTimerRef.current);
      chordTimerRef.current = null;
    }
    if (masterGainRef.current && audioCtxRef.current) {
      try {
        masterGainRef.current.gain.cancelScheduledValues(audioCtxRef.current.currentTime);
        masterGainRef.current.gain.linearRampToValueAtTime(
          0.0001,
          audioCtxRef.current.currentTime + 0.2,
        );
      } catch {}
    }
  }, []);

  const ensureAudioContext = useCallback(async () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const startMusic = useCallback(async () => {
    try {
      const ctx = await ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }

      if (!masterGainRef.current) {
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.35, ctx.currentTime);
        master.connect(ctx.destination);
        masterGainRef.current = master;
      } else {
        masterGainRef.current.gain.cancelScheduledValues(ctx.currentTime);
        masterGainRef.current.gain.setValueAtTime(0.35, ctx.currentTime);
      }

      // Authentic Lo-Fi Jazz 9th & 11th Spread Voicings with Deep Roots
      const chords: readonly (readonly number[])[] = [
        // Cmaj9: C2 (65Hz), G2 (98Hz), D3 (146Hz), E3 (164Hz), B3 (246Hz), D4 (293Hz)
        [65.41, 98.0, 146.83, 164.81, 246.94, 293.66],
        // Am9: A1 (55Hz), E2 (82Hz), C3 (130Hz), G3 (196Hz), B3 (246Hz), E4 (329Hz)
        [55.0, 82.41, 130.81, 196.0, 246.94, 329.63],
        // Fmaj9: F1 (43Hz), C2 (65Hz), A2 (110Hz), E3 (164Hz), G3 (196Hz), C4 (261Hz)
        [43.65, 65.41, 110.0, 164.81, 196.0, 261.63],
        // Em9: E1 (41Hz), B1 (61Hz), G2 (98Hz), D3 (146Hz), F#3 (185Hz), B3 (246Hz)
        [41.2, 61.74, 98.0, 146.83, 185.0, 246.94],
      ];

      if (chordTimerRef.current) {
        window.clearTimeout(chordTimerRef.current);
        chordTimerRef.current = null;
      }

      let chordIdx = 0;
      const scheduleNextChord = () => {
        if (!masterGainRef.current || !audioCtxRef.current) return;
        if (audioCtxRef.current.state === "suspended") {
          return;
        }
        const now = ctx.currentTime;
        const freqs = chords[chordIdx % chords.length] ?? chords[0]!;
        chordIdx++;

        // Warm tape low-pass filter with silky resonance
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1400, now);
        filter.frequency.exponentialRampToValueAtTime(2200, now + 1.2);
        filter.frequency.exponentialRampToValueAtTime(1200, now + 4.5);
        filter.Q.setValueAtTime(1.1, now);
        filter.connect(masterGainRef.current);

        // Analog Tape Wow & Flutter LFO (subtle warm pitch drift)
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.setValueAtTime(3.6, now);
        lfoGain.gain.setValueAtTime(1.6, now);
        lfo.connect(lfoGain);

        freqs.forEach((freq, idx) => {
          // Humanized keyboard strum stagger (30ms per note)
          const noteTime = now + idx * 0.03;

          // Main body oscillator (warm mellow sine for chord, triangle for sub-bass)
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = idx === 0 ? "triangle" : "sine";
          osc.frequency.setValueAtTime(freq, noteTime);
          lfoGain.connect(osc.frequency);

          // Rhodes Tine Harmonic (first octave bell chime with fast decay)
          const tine = ctx.createOscillator();
          const tineGain = ctx.createGain();
          tine.type = "triangle";
          tine.frequency.setValueAtTime(freq * 2, noteTime);

          const voiceGain = 0.24 / Math.sqrt(freqs.length);
          gain.gain.setValueAtTime(0.0001, noteTime);
          gain.gain.linearRampToValueAtTime(voiceGain, noteTime + 0.04);
          gain.gain.exponentialRampToValueAtTime(voiceGain * 0.45, noteTime + 2.0);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 5.2);

          tineGain.gain.setValueAtTime(0.0001, noteTime);
          tineGain.gain.linearRampToValueAtTime(voiceGain * 0.22, noteTime + 0.02);
          tineGain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.45);

          // Stereo soundstage spread if supported
          let targetNode: AudioNode = filter;
          if (typeof ctx.createStereoPanner === "function") {
            const panner = ctx.createStereoPanner();
            const panVal = (idx / (freqs.length - 1) - 0.5) * 0.6;
            panner.pan.setValueAtTime(panVal, noteTime);
            panner.connect(filter);
            targetNode = panner;
          }

          osc.connect(gain);
          gain.connect(targetNode);
          tine.connect(tineGain);
          tineGain.connect(targetNode);

          osc.start(noteTime);
          osc.stop(noteTime + 5.3);
          tine.start(noteTime);
          tine.stop(noteTime + 0.5);
        });

        lfo.start(now);
        lfo.stop(now + 5.5);

        chordTimerRef.current = window.setTimeout(scheduleNextChord, 4800);
      };

      scheduleNextChord();
    } catch {
      // Audio autoplay policy
    }
  }, [ensureAudioContext]);

  useEffect(() => {
    if (isMusicPlaying) {
      void startMusic();
    } else {
      stopMusic();
    }
    return () => {
      stopMusic();
    };
  }, [isMusicPlaying, startMusic, stopMusic]);

  // Tactile click sound
  const playClick = useCallback(async () => {
    try {
      const ctx = await ensureAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(540, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(270, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }, [ensureAudioContext]);

  const toggleMusic = useCallback(async () => {
    void playClick();
    if (isMusicPlaying) {
      setIsMusicPlaying(false);
      stopMusic();
    } else {
      const ctx = await ensureAudioContext();
      if (ctx && ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }
      setIsMusicPlaying(true);
      void startMusic();
    }
  }, [isMusicPlaying, playClick, ensureAudioContext, startMusic, stopMusic]);

  // Unlock Audio on User Gesture (Solves Chromium/Electron autoplay lock)
  useEffect(() => {
    const handleGesture = async () => {
      const ctx = await ensureAudioContext();
      if (ctx && ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }
      if (isMusicPlaying) {
        void startMusic();
      }
    };
    window.addEventListener("pointerdown", handleGesture);
    window.addEventListener("click", handleGesture);
    window.addEventListener("keydown", handleGesture);
    return () => {
      window.removeEventListener("pointerdown", handleGesture);
      window.removeEventListener("click", handleGesture);
      window.removeEventListener("keydown", handleGesture);
    };
  }, [isMusicPlaying, ensureAudioContext, startMusic]);

  const handleAppIconSelect = useCallback(
    (iconId: "dark" | "system" | "light") => {
      setSelectedAppIcon(iconId);
      updateClientSettings((current) => ({
        ...current,
        desktopIconTheme: iconId,
      }));

      const isCurrentThemeDark =
        selectedAppearance === "dark" || (selectedAppearance === "system" && systemPrefersDark);

      const effectiveTheme: "dark" | "light" =
        iconId === "system" ? (isCurrentThemeDark ? "dark" : "light") : iconId;

      void window.desktopBridge?.setIconTheme?.(effectiveTheme).catch(() => undefined);
      void playClick();
    },
    [playClick, selectedAppearance, systemPrefersDark],
  );

  const handleAppearanceSelect = useCallback(
    (mode: "system" | "dark" | "light") => {
      setSelectedAppearance(mode);
      const themePref = mode === "light" ? "tabs-light" : mode === "dark" ? "tabs-dark" : "system";
      try {
        localStorage.setItem("tabs:theme", themePref);
        if (typeof document !== "undefined") {
          const isDark = mode === "dark" || (mode === "system" && systemPrefersDark);
          document.documentElement.classList.toggle("dark", isDark);
          document.documentElement.dataset.theme = themePref;
        }
      } catch {}

      // If app icon is set to "system", dynamically sync dock icon to match newly chosen theme
      if (selectedAppIcon === "system") {
        const isDark = mode === "dark" || (mode === "system" && systemPrefersDark);
        const effective = isDark ? "dark" : "light";
        void window.desktopBridge?.setIconTheme?.(effective).catch(() => undefined);
      }

      void playClick();
    },
    [playClick, selectedAppIcon, systemPrefersDark],
  );

  // Listen to OS appearance changes when using system appearance or system icon
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
      if (selectedAppearance === "system") {
        document.documentElement.classList.toggle("dark", e.matches);
      }
      if (selectedAppIcon === "system") {
        const isDark =
          selectedAppearance === "dark" ? true : selectedAppearance === "light" ? false : e.matches;
        void window.desktopBridge?.setIconTheme?.(isDark ? "dark" : "light").catch(() => undefined);
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [selectedAppearance, selectedAppIcon]);

  // Poll embedded Code-OSS readiness
  const checkCodeHost = useCallback(async () => {
    setIsCheckingCodeHost(true);
    try {
      if (window.desktopBridge?.getCodeHostState) {
        const state = await window.desktopBridge.getCodeHostState();
        setCodeHostState(state);
      } else {
        setCodeHostState({
          available: false,
          mode: "external",
          entry: null,
          reason: "Running in external host mode",
        });
      }
    } catch (e) {
      setCodeHostState({
        available: false,
        mode: "external",
        entry: null,
        reason: String(e),
      });
    } finally {
      setIsCheckingCodeHost(false);
    }
  }, []);

  useEffect(() => {
    void checkCodeHost();
  }, [checkCodeHost]);

  const handleCopyBuild = useCallback(() => {
    navigator.clipboard?.writeText("cd ../tabs-code-oss && npm install && npm run compile");
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  }, []);

  const handleAddProject = useCallback(() => {
    void playClick();
    const nextNum = projectsList.length + 1;
    const newId = `project-${nextNum}`;
    const newName = `Project ${nextNum}`;
    const newProj: PrototypeProject = {
      id: newId,
      name: newName,
      branch: "main",
      description: `Workspace ${nextNum} • Custom tool set`,
      tools: [
        { id: "code", label: "Code", iconKind: "code" },
        { id: "agents", label: "Agents", iconKind: "agents" },
        { id: "launchpad", label: "Launchpad", iconKind: "launchpad" },
        { id: "git", label: "Git", iconKind: "git" },
        { id: "browser", label: "Browser", iconKind: "browser" },
        { id: "testing", label: "Testing (optional)", iconKind: "testing" },
      ],
    };
    setProjectsList((prev) => [...prev, newProj]);
    setActiveProjectId(newId);
    setActiveToolsByProject((prev) => ({ ...prev, [newId]: "code" }));
  }, [projectsList.length, playClick]);

  const handleCloseProject = useCallback(
    (projId: string) => {
      void playClick();
      if (projectsList.length <= 1) return;
      setProjectsList((prev) => {
        const next = prev.filter((p) => p.id !== projId);
        if (activeProjectId === projId) {
          const idx = prev.findIndex((p) => p.id === projId);
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          if (fallback) setActiveProjectId(fallback.id);
        }
        return next;
      });
    },
    [projectsList.length, activeProjectId, playClick],
  );

  const handlePickFolder = useCallback(async () => {
    void playClick();
    const api = readNativeApi();
    let folder: string | null = null;
    if (api?.dialogs?.pickFolder) {
      folder = await api.dialogs.pickFolder();
    } else if (window.desktopBridge?.pickFolder) {
      folder = await window.desktopBridge.pickFolder();
    }
    if (folder) {
      setSelectedFolder(folder);
      const folderName = folder.split(/[/\\]/).findLast((s) => s.trim().length > 0) ?? folder;
      setProjectsList((prev) => {
        const existing = prev.find((p) => p.name === folderName);
        if (existing) {
          setActiveProjectId(existing.id);
          return prev;
        }
        const newProj: PrototypeProject = {
          id: `project-${prev.length + 1}`,
          name: folderName,
          branch: "main",
          description: `Imported local workspace: ${folder}`,
          tools: [
            { id: "code", label: "Code", iconKind: "code" },
            { id: "agents", label: "Agents", iconKind: "agents" },
            { id: "launchpad", label: "Launchpad", iconKind: "launchpad" },
            { id: "git", label: "Git", iconKind: "git" },
            { id: "testing", label: "Testing (optional)", iconKind: "testing" },
          ],
        };
        setActiveProjectId(newProj.id);
        return [...prev, newProj];
      });
    }
  }, [playClick]);

  // Cinematic Sci-Fi Hyperspace Jump & Celestial Launch Chime
  const playLaunchChime = useCallback(() => {
    if (!audioCtxRef.current) return;
    try {
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;

      // 1. Dual cinematic sub-bass dive / warp implosion (160Hz -> 36Hz and 80Hz -> 24Hz)
      const subOsc1 = ctx.createOscillator();
      const subOsc2 = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc1.type = "sine";
      subOsc2.type = "triangle";
      subOsc1.frequency.setValueAtTime(160, now);
      subOsc1.frequency.exponentialRampToValueAtTime(36, now + 1.15);
      subOsc2.frequency.setValueAtTime(80, now);
      subOsc2.frequency.exponentialRampToValueAtTime(24, now + 1.15);
      subGain.gain.setValueAtTime(0.0001, now);
      subGain.gain.linearRampToValueAtTime(0.2, now + 0.08);
      subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
      subOsc1.connect(subGain);
      subOsc2.connect(subGain);
      subGain.connect(ctx.destination);
      subOsc1.start(now);
      subOsc2.start(now);
      subOsc1.stop(now + 1.3);
      subOsc2.stop(now + 1.3);

      // 2. Hyperspace resonant energy riser (240Hz -> 3600Hz sweep)
      const riserOsc = ctx.createOscillator();
      const riserFilter = ctx.createBiquadFilter();
      const riserGain = ctx.createGain();
      riserOsc.type = "sawtooth";
      riserFilter.type = "bandpass";
      riserFilter.Q.setValueAtTime(6.2, now);
      riserFilter.frequency.setValueAtTime(240, now);
      riserFilter.frequency.exponentialRampToValueAtTime(3600, now + 1.0);
      riserGain.gain.setValueAtTime(0.0001, now);
      riserGain.gain.linearRampToValueAtTime(0.05, now + 0.32);
      riserGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.18);
      riserOsc.connect(riserFilter);
      riserFilter.connect(riserGain);
      riserGain.connect(ctx.destination);
      riserOsc.start(now);
      riserOsc.stop(now + 1.22);

      // 3. Atmospheric lightspeed whoosh (filtered noise burst)
      const bufferSize = Math.floor(ctx.sampleRate * 1.25);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "lowpass";
      noiseFilter.frequency.setValueAtTime(350, now);
      noiseFilter.frequency.exponentialRampToValueAtTime(4800, now + 0.72);
      noiseFilter.frequency.exponentialRampToValueAtTime(800, now + 1.15);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.linearRampToValueAtTime(0.055, now + 0.25);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      whiteNoise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      whiteNoise.start(now);
      whiteNoise.stop(now + 1.25);

      // 4. Sparkling pentatonic celestial bell arpeggio with stereo spatial sweep
      const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
      const panPositions = [-0.55, -0.25, 0.0, 0.25, 0.55];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + 0.15 + idx * 0.09);
        gain.gain.setValueAtTime(0.0001, now + 0.15 + idx * 0.09);
        gain.gain.linearRampToValueAtTime(0.065, now + 0.15 + idx * 0.09 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15 + idx * 0.09 + 0.95);

        const destination = ctx.destination;
        const ctxWithPanner = ctx as unknown as { createStereoPanner?: () => StereoPannerNode };
        if (typeof ctxWithPanner.createStereoPanner === "function") {
          const panner = ctxWithPanner.createStereoPanner();
          panner.pan.setValueAtTime(panPositions[idx] ?? 0, now + 0.15 + idx * 0.09);
          osc.connect(gain);
          gain.connect(panner);
          panner.connect(destination);
        } else {
          osc.connect(gain);
          gain.connect(destination);
        }
        osc.start(now + 0.15 + idx * 0.09);
        osc.stop(now + 0.15 + idx * 0.09 + 1.05);
      });
    } catch {}
  }, []);

  // Soft & Elegant Acoustic Glide Exit Chime for "Skip setup"
  const playSkipChime = useCallback(() => {
    if (!audioCtxRef.current) return;
    try {
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      // Gentle pentatonic glide (E5 -> G#5 -> B5 -> E6) with warm analog envelope
      const freqs = [659.25, 830.61, 987.77, 1318.51];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);
        gain.gain.setValueAtTime(0.0001, now + idx * 0.06);
        gain.gain.linearRampToValueAtTime(0.055 / (idx + 1), now + idx * 0.06 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.48);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.52);
      });
    } catch {}
  }, []);

  const handleFinish = useCallback(async () => {
    stopMusic();
    if (selectedFolder) {
      const api = readNativeApi();
      if (api) {
        const projectId = newProjectId();
        const title =
          selectedFolder.split(/[/\\]/).findLast((s) => s.trim().length > 0) ?? selectedFolder;
        await api.orchestration
          .dispatchCommand({
            type: "project.create",
            commandId: newCommandId(),
            projectId,
            title,
            workspaceRoot: selectedFolder,
            defaultModelSelection: null,
            createdAt: new Date().toISOString(),
          })
          .catch((err) => {
            console.warn("[Onboarding] Failed to auto-create project", err);
          });
      }
    }

    const themePref =
      selectedAppearance === "light"
        ? "tabs-light"
        : selectedAppearance === "dark"
          ? "tabs-dark"
          : "system";
    try {
      localStorage.setItem("tabs:theme", themePref);
    } catch {}

    updateClientSettings((current) => ({
      ...current,
      desktopIconTheme: selectedAppIcon,
      aiProvider: selectedProvider
        ? (selectedProvider as typeof current.aiProvider)
        : current.aiProvider,
    }));

    await completeOnboarding();
    onDone?.();
  }, [
    completeOnboarding,
    onDone,
    selectedAppearance,
    selectedAppIcon,
    selectedFolder,
    selectedProvider,
    stopMusic,
  ]);

  const triggerLaunch = useCallback(() => {
    if (isLaunching) return;
    setIsGalleryOpen(false);
    setIsLaunching(true);
    playLaunchChime();
    stopMusic();
    setTimeout(() => {
      void handleFinish();
    }, 1350);
  }, [isLaunching, playLaunchChime, stopMusic, handleFinish]);

  const handleSkip = useCallback(() => {
    if (isLaunching || isSkipping) return;
    setIsGalleryOpen(false);
    setIsSkipping(true);
    playSkipChime();
    stopMusic();
    setTimeout(() => {
      void completeOnboarding().then(() => onDone?.());
    }, 550);
  }, [isLaunching, isSkipping, playSkipChime, stopMusic, completeOnboarding, onDone]);

  const currentProviderMeta = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];
  const CurrentProviderIcon = currentProviderMeta.icon;

  const currentProject =
    projectsList.find((p) => p.id === activeProjectId) ?? projectsList[0] ?? INITIAL_PROJECTS[0]!;
  const activeToolId =
    activeToolsByProject[activeProjectId] ?? currentProject.tools[0]?.id ?? "code";
  const activeToolMeta =
    currentProject.tools.find((t) => t.id === activeToolId) ?? currentProject.tools[0]!;

  const isSystemDark = systemPrefersDark;

  const resolvedThemeVariant: "dark" | "light" =
    selectedAppearance === "light"
      ? "light"
      : selectedAppearance === "dark"
        ? "dark"
        : isSystemDark
          ? "dark"
          : "light";

  const effectiveAppIconVariant: "dark" | "light" =
    selectedAppIcon === "system" ? resolvedThemeVariant : selectedAppIcon;

  const currentLogoSrc =
    effectiveAppIconVariant === "light"
      ? "/onboarding/app-icon-light.png"
      : "/onboarding/app-icon-dark.png";

  return (
    <div className="relative flex min-h-screen w-full flex-col justify-between overflow-x-hidden overflow-y-auto bg-black text-white select-none antialiased">
      {/* Fullscreen Hyperspace Warp Speed Canvas Transition */}
      <HalftoneDissolveOverlay active={isLaunching} />

      {/* Full Visual Wallpaper Gallery Modal — bright/light scenes only for wizard */}
      <WallpaperGalleryModal
        isOpen={isGalleryOpen}
        activeWallpaperUrl={selectedWallpaper}
        wallpapers={BRIGHT_WALLPAPERS}
        onSelectWallpaper={(wp) => {
          setSelectedWallpaper(wp.url);
          saveWallpaperPreference(wp.url);
        }}
        onClose={() => setIsGalleryOpen(false)}
        onPlaySound={() => {
          void playClick();
        }}
      />

      {/* Hand-Painted Anime Background Wallpaper */}
      <div
        className={cn(
          "pointer-events-none fixed inset-0 z-0 bg-cover bg-center transition-all duration-700 ease-out will-change-transform",
          isLaunching &&
            "scale-110 blur-md brightness-125 duration-[1350ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]",
          isSkipping && "scale-[0.98] opacity-0 blur-sm duration-500 ease-out",
          !isLaunching && !isSkipping && "opacity-100",
        )}
        style={{
          backgroundImage: `url(${selectedWallpaper})`,
        }}
      />

      {/* Cinematic Neutral Vignette & Depth Mask (Pure neutral black shadows, zero artificial color tints) */}
      <div
        className={cn(
          "pointer-events-none fixed inset-0 z-1 transition-opacity duration-1000",
          (isLaunching || isSkipping) && "opacity-0",
        )}
        style={{
          background: `
            radial-gradient(circle at 50% 40%, transparent 35%, rgba(0, 0, 0, 0.65) 100%),
            linear-gradient(to bottom, rgba(0, 0, 0, 0.45) 0%, transparent 35%, rgba(0, 0, 0, 0.78) 100%)
          `,
        }}
      />

      {/* ── Animated Halftone Canvas ─────────────────────────────────────────
          Dual-canvas animated halftone: dark wave-modulated dot grid
          (multiply) + neural sparks, data streams, and scan sweeps (screen).
      ────────────────────────────────────────────────────────────────────── */}
      <AnimatedHalftoneCanvas isLaunching={isLaunching} isSkipping={isSkipping} />

      {/* Top Header with Authentic App Icon & Ambient Music Controls */}
      <header
        className={cn(
          "relative z-40 mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 sm:px-8 transition-all duration-700 ease-in-out",
          isLaunching && "-translate-y-16 opacity-0 pointer-events-none",
          isSkipping && "-translate-y-10 opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-3.5">
          {/* Authentic Tabs Desktop App Icon: Clean, prominent, natural squircle without any enclosing border ring */}
          <img
            src={currentLogoSrc}
            alt="Tabs IDE"
            className="size-11 select-none pointer-events-none object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.6)] transition-all duration-300 hover:scale-105"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">Tabs IDE</h1>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 border border-white/10">
                Setup
              </span>
            </div>
            <p className="text-xs text-white/60">Unified AI Pair-Programming Workbench</p>
          </div>
        </div>

        {/* Ambient Lo-Fi & Wallpaper Controls */}
        <div className="flex items-center gap-2.5">
          {/* Ambient Music Control */}
          <button
            type="button"
            onClick={toggleMusic}
            className={cn(
              "group flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur-2xl transition-all duration-200 cursor-pointer select-none",
              isMusicPlaying
                ? "border-white/25 bg-white/10 text-white shadow-lg shadow-black/40 hover:bg-white/15 hover:border-white/35"
                : "border-white/10 bg-black/40 text-white/50 hover:text-white/80 hover:bg-white/5",
            )}
            title={isMusicPlaying ? "Pause ambient lo-fi music" : "Play ambient lo-fi music"}
          >
            {isMusicPlaying ? (
              <>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                </span>
                <span className="text-[11px] font-medium tracking-tight text-white/90">
                  Lo-Fi Ambient
                </span>
                <span className="rounded-full bg-white/10 px-1.5 py-0.2 text-[9px] font-mono font-semibold text-white/70">
                  PLAYING
                </span>
              </>
            ) : (
              <>
                <VolumeXIcon className="size-3.5 text-white/40" />
                <span className="text-[11px] font-medium tracking-tight text-white/50">
                  Lo-Fi Ambient
                </span>
                <span className="rounded-full bg-white/5 px-1.5 py-0.2 text-[9px] font-mono text-white/40">
                  PAUSED
                </span>
              </>
            )}
          </button>

          {/* Top Wallpaper Controller — bright scenes only */}
          <WallpaperTopBar
            activeWallpaperUrl={selectedWallpaper}
            wallpapers={BRIGHT_WALLPAPERS}
            onSelectWallpaper={(wp) => {
              setSelectedWallpaper(wp.url);
              saveWallpaperPreference(wp.url);
            }}
            onOpenGallery={() => setIsGalleryOpen(true)}
            onPlaySound={() => {
              void playClick();
            }}
            showFilmstrip={true}
            disabled={isLaunching || isSkipping}
          />

          {/* Skip Button */}
          <Button
            variant="ghost"
            size="sm"
            disabled={isLaunching || isSkipping}
            onClick={handleSkip}
            className="text-xs text-white/60 hover:text-white hover:bg-white/10 rounded-full px-3.5 border border-white/5 cursor-pointer disabled:opacity-50"
          >
            Skip setup
          </Button>
        </div>
      </header>

      {/* Main: Card carousel — card 0 = prototype, card 1 = icon, card 2 = theme */}
      <main
        className={cn(
          "relative z-10 flex w-full flex-1 flex-col justify-center py-2 transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]",
          isLaunching && "scale-[1.12] -translate-y-12 blur-[6px] opacity-0 pointer-events-none",
          isSkipping &&
            "scale-[0.96] translate-y-8 opacity-0 blur-[4px] pointer-events-none duration-500 ease-out",
        )}
      >
        {/* Horizontal Sliding Carousel Track: Spans full width so clipping boundaries are at the screen edges, never near the cards */}
        <div className="relative w-full overflow-hidden py-10 -my-8">
          <div
            className="flex w-full items-center transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform"
            style={{ transform: `translateX(-${setupStep * 100}%)` }}
          >
            {/* ── SLIDE 0: Interactive Workbench Prototype ── */}
            <div
              inert={setupStep !== 0 ? true : undefined}
              className={cn(
                "w-full shrink-0 flex items-center justify-center px-4 sm:px-6",
                setupStep === 0 ? "pointer-events-auto" : "pointer-events-none",
              )}
            >
              <div className="w-full max-w-5xl mx-auto">
                <div className="relative rounded-3xl border border-white/15 bg-black/50 p-6 sm:p-8 backdrop-blur-3xl shadow-2xl shadow-black/80 space-y-6">
                  {/* Hero Banner: Clean, Punchy & Clear */}
                  <div className="border-b border-white/10 pb-5">
                    <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                      All Your Projects &amp; Tools in One Window
                    </h2>
                    <p className="mt-1.5 text-xs text-white/60 max-w-2xl leading-relaxed">
                      Tabs lets you manage multiple projects simultaneously without window clutter.
                      Each project has its own dedicated tool shelf, embedded Code-OSS editor,
                      autonomous agents, and background dev processes.
                    </p>
                  </div>

                  {/* 1-to-1 Interactive Tabs Workbench Prototype (Matching Real App Screenshot) */}
                  <div className="rounded-2xl border border-white/20 bg-black/70 shadow-2xl overflow-hidden backdrop-blur-xl transition-all">
                    {/* Top Window Bar: Real Tabs Project Chrome (1-to-1 with screenshot) */}
                    <div className="flex items-end justify-between border-b border-white/10 bg-white/[0.04] px-3 pt-2.5 select-none overflow-x-auto [scrollbar-width:none]">
                      <div className="flex items-end gap-1 min-w-0">
                        {/* Traffic Lights (macOS Native Aesthetic) */}
                        <div className="flex items-center gap-1.5 px-2 py-2 mr-2">
                          <span className="size-2.5 rounded-full bg-[#ff5f57] border border-[#e0443e]/60 shadow-xs" />
                          <span className="size-2.5 rounded-full bg-[#febc2e] border border-[#d89e24]/60 shadow-xs" />
                          <span className="size-2.5 rounded-full bg-[#28c840] border border-[#1aab29]/60 shadow-xs" />
                        </div>

                        {/* Project Tabs */}
                        {projectsList.map((proj) => {
                          const isActive = proj.id === activeProjectId;
                          return (
                            <button
                              key={proj.id}
                              type="button"
                              onClick={() => {
                                setActiveProjectId(proj.id);
                                void playClick();
                              }}
                              className={cn(
                                "group relative inline-flex items-center gap-2 rounded-t-xl px-4 py-2 text-xs transition-all duration-150 cursor-pointer select-none",
                                isActive
                                  ? "-mb-[1px] bg-white text-black font-bold shadow-lg shadow-black/30 border-t border-x border-white z-10"
                                  : "text-white/60 hover:text-white hover:bg-white/10 border-t border-x border-transparent font-medium",
                              )}
                            >
                              <span className="truncate max-w-[130px]">{proj.name}</span>
                              <span
                                className={cn(
                                  "size-3.5 rounded-full flex items-center justify-center transition-colors",
                                  isActive
                                    ? "text-black/50 hover:bg-black/10 hover:text-black"
                                    : "text-white/30 hover:bg-white/15 hover:text-white",
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCloseProject(proj.id);
                                }}
                                title={`Close ${proj.name}`}
                              >
                                <XIcon className="size-2.5" />
                              </span>
                            </button>
                          );
                        })}

                        {/* New Project Tab Button */}
                        <button
                          type="button"
                          onClick={handleAddProject}
                          title="Add New Project Workspace (e.g. Project 4)"
                          className="p-1.5 mb-1 rounded-lg text-white/50 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
                        >
                          <PlusIcon className="size-3.5" />
                        </button>
                      </div>

                      {/* Active Workspace Info on Right */}
                      <div className="hidden sm:flex items-center gap-2 pb-2 text-[11px] text-white/50">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <GitBranchIcon className="size-3 text-emerald-400" />
                        <span className="font-mono text-white/70">{currentProject.branch}</span>
                        <span className="text-white/30">•</span>
                        <span className="text-[10px] text-white/50">
                          {currentProject.tools.length} tools
                        </span>
                      </div>
                    </div>

                    {/* Docked Tool Shelf: Frosted Lens with Dotted Grid Pattern */}
                    <div className="flex items-center justify-center py-2.5 px-4 border-b border-white/10 bg-black/40">
                      <div
                        role="tablist"
                        aria-label="Project tool shelf"
                        className="relative inline-flex max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-full border border-white/20 p-1 shadow-2xl backdrop-blur-2xl"
                        style={{
                          backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.22) 1.2px, transparent 1.2px)`,
                          backgroundSize: "6px 6px",
                          backgroundColor: "rgba(16, 16, 20, 0.8)",
                        }}
                      >
                        {currentProject.tools.map((tool) => {
                          const isActive = tool.id === activeToolId;
                          return (
                            <button
                              key={tool.id}
                              type="button"
                              role="tab"
                              aria-selected={isActive}
                              onClick={() => {
                                setActiveToolsByProject((prev) => ({
                                  ...prev,
                                  [activeProjectId]: tool.id,
                                }));
                                void playClick();
                              }}
                              className={cn(
                                "relative z-10 flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium transition-all duration-200 cursor-pointer select-none whitespace-nowrap",
                                isActive
                                  ? "bg-white text-black font-bold shadow-md shadow-white/15 scale-[1.02]"
                                  : "text-white/70 hover:text-white hover:bg-white/10",
                              )}
                            >
                              {renderToolIcon(tool.iconKind)}
                              <span>{tool.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Dedicated Project Tool Header (Explains multi-project architecture clearly) */}
                    <div className="flex flex-wrap items-center justify-between border-b border-white/10 bg-white/[0.02] px-4 py-2 gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="flex size-5 items-center justify-center rounded-md bg-white/10 text-white">
                          {renderToolIcon(activeToolMeta.iconKind)}
                        </div>
                        <span className="font-semibold text-white capitalize">
                          {activeToolMeta.label}
                        </span>
                        <span className="text-white/30">•</span>
                        <span className="text-[11px] text-white/60">
                          {activeToolId === "code" &&
                            "Full Code-OSS editor with Monaco buffers & language servers"}
                          {activeToolId === "agents" &&
                            "Autonomous AI coding agents with multi-turn diff execution"}
                          {activeToolId === "launchpad" &&
                            "Background dev servers & process supervisor"}
                          {activeToolId === "git" && "Visual branch history, staging, and sync"}
                          {activeToolId === "browser" &&
                            "Integrated Chromium tab with live DOM inspection"}
                          {activeToolId === "testing" && "Automated test watcher & runner"}
                          {activeToolId === "terminal" && "Dedicated interactive zsh/bash shell"}
                          {(activeToolId === "claude" ||
                            activeToolId === "chatgpt" ||
                            activeToolId === "figma") &&
                            `Integrated ${activeToolMeta.label} tool tab`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-white/40 font-mono">
                        <span className="rounded bg-white/5 px-1.5 py-0.5 border border-white/5 text-emerald-400/90 font-medium">
                          {currentProject.name}
                        </span>
                        <span>Isolated Workspace</span>
                      </div>
                    </div>

                    {/* Sandbox Canvas Body: Real Visual Representations of Each Tool */}
                    <div className="p-4 sm:p-5 min-h-[190px] flex flex-col justify-center bg-black/50">
                      {activeToolId === "agents" && (
                        <div className="space-y-3 font-mono text-xs">
                          <div className="flex items-start gap-2.5">
                            <span className="text-white/40 font-bold shrink-0">
                              user@{currentProject.name.toLowerCase().replace(/\s+/g, "-")}:
                            </span>
                            <span className="text-white/90">
                              Refactor session tokens to support zero-trust credentials and refresh
                              silently.
                            </span>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-white/60">
                              <div className="flex items-center gap-1.5">
                                <CurrentProviderIcon className="size-3.5 text-white" />
                                <span className="font-bold text-white capitalize">
                                  {currentProviderMeta.name} Agent
                                </span>
                                <span className="text-white/40">•</span>
                                <span className="text-emerald-400 font-medium">
                                  3 tools executed
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-white/40">
                                auth/session.ts
                              </span>
                            </div>
                            <div className="rounded-lg bg-black/60 p-2.5 text-[11px] leading-relaxed select-text font-mono border border-white/5">
                              <div className="text-red-400/80">- return verifyToken(rawToken);</div>
                              <div className="text-emerald-400/90">
                                + return await zeroTrustAuth.verifyAndRefreshAsync(rawToken, &#123;
                                autoRotate: true &#125;);
                              </div>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <span className="rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
                                ✓ Accept Diff
                              </span>
                              <span className="rounded-md bg-white/10 text-white/70 px-2 py-0.5 text-[10px]">
                                ⚡ Run Tests
                              </span>
                              <span className="rounded-md bg-white/10 text-white/70 px-2 py-0.5 text-[10px]">
                                💬 Ask Follow-up
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeToolId === "code" && (
                        <div className="rounded-xl border border-white/10 bg-black/80 p-3.5 space-y-2 font-mono text-xs">
                          <div className="flex items-center justify-between text-[11px] border-b border-white/10 pb-2">
                            <div className="flex items-center gap-2 text-white/70">
                              <CodeIcon className="size-3.5 text-cyan-400" />
                              <span className="text-white font-semibold">
                                src/core/sessionManager.ts
                              </span>
                              <span className="text-white/40">&gt; verifyAndRefreshAsync()</span>
                            </div>
                            <span className="text-[10px] text-emerald-400 font-mono">
                              Embedded Code-OSS
                            </span>
                          </div>
                          <div className="grid grid-cols-12 gap-3 text-[11px] pt-1">
                            <div className="col-span-3 border-r border-white/10 pr-2 space-y-1 text-white/50 text-[10px]">
                              <div className="text-white/70 font-bold">▾ src/core/</div>
                              <div className="pl-2 text-cyan-300 bg-white/5 rounded px-1">
                                sessionManager.ts
                              </div>
                              <div className="pl-2">tokenDaemon.ts</div>
                              <div className="pl-2">cryptoEngine.ts</div>
                              <div className="text-white/40">package.json</div>
                            </div>
                            <div className="col-span-9 leading-relaxed text-white/80">
                              <div>
                                <span className="text-purple-400">export async function</span>{" "}
                                <span className="text-blue-300">verifyAndRefreshAsync</span>(token:
                                string) &#123;
                              </div>
                              <div className="pl-4 text-white/60">
                                const session = <span className="text-purple-400">await</span>{" "}
                                cryptoEngine.decrypt(token);
                              </div>
                              <div className="pl-4 text-emerald-400 font-bold">
                                + if (session.ttl &lt; 300) return tokenDaemon.refresh(session);
                              </div>
                              <div className="pl-4 text-white/60">
                                <span className="text-purple-400">return</span> session;
                              </div>
                              <div>&#125;</div>
                            </div>
                          </div>
                          <div className="pt-1 flex items-center justify-between text-[10px] text-white/40 border-t border-white/5">
                            <span>⌘K to prompt AI directly in line</span>
                            <span>Language Server: TypeScript 5.8 • Ready</span>
                          </div>
                        </div>
                      )}

                      {activeToolId === "launchpad" && (
                        <div className="rounded-xl border border-white/10 bg-black/80 p-3.5 space-y-2.5 font-mono text-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <RocketIcon className="size-3.5 text-amber-400" />
                              <span className="font-bold text-white">
                                Preset: bun run dev:desktop
                              </span>
                              <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.2 text-[10px] font-bold">
                                ● RUNNING
                              </span>
                            </div>
                            <span className="text-[10px] text-cyan-300">
                              port: 3000 (HTTP) • ws: 49152
                            </span>
                          </div>
                          <div className="rounded-lg bg-black/90 p-2.5 text-[11px] text-white/70 space-y-0.5 border border-white/5">
                            <div className="text-emerald-400">
                              [vite] ready in 184ms • Vite v6.2.0 • HMR active
                            </div>
                            <div className="text-white/60">
                              [server] WebSocket daemon listening on ws://localhost:49152
                            </div>
                            <div className="text-cyan-400/90">
                              [electron] main window ready (renderer client id: 4)
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-white/40">
                            <span>
                              Background process managed independently for {currentProject.name}
                            </span>
                            <button
                              type="button"
                              onClick={playClick}
                              className="text-cyan-400 hover:underline"
                            >
                              Open in Internal Browser Tab &rarr;
                            </button>
                          </div>
                        </div>
                      )}

                      {activeToolId === "git" && (
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between text-white/60 text-[11px]">
                            <div className="flex items-center gap-2">
                              <GitBranchIcon className="size-3.5 text-cyan-400" />
                              <span className="font-semibold text-white">
                                Branch: {currentProject.branch}
                              </span>
                            </div>
                            <span className="font-mono text-emerald-400">
                              2 staged files ready to commit
                            </span>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2 font-mono text-[11px]">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="size-2 rounded-full bg-emerald-400" />
                                <span className="text-white font-bold">auth/session.ts</span>
                                <span className="text-emerald-400">(+14, -2)</span>
                              </div>
                              <span className="text-[10px] text-white/40">Staged</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="size-2 rounded-full bg-emerald-400" />
                                <span className="text-white font-bold">contracts/tokens.ts</span>
                                <span className="text-emerald-400">(+8, -0)</span>
                              </div>
                              <span className="text-[10px] text-white/40">Staged</span>
                            </div>
                            <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                              <span className="text-white/60 text-[11px]">
                                Commit: feat(auth): add zero-trust token rotation
                              </span>
                              <button
                                type="button"
                                onClick={playClick}
                                className="rounded-md bg-white text-black font-bold px-2.5 py-1 text-[10px] hover:bg-white/90"
                              >
                                Commit &amp; Sync
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeToolId === "browser" && (
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs space-y-2.5">
                          <div className="flex items-center justify-between text-[11px] text-white/60">
                            <div className="flex items-center gap-2">
                              <GlobeIcon className="size-3.5 text-cyan-400" />
                              <span className="font-medium text-white">
                                Built-in Chromium Browser Tab
                              </span>
                            </div>
                            <span className="font-mono text-emerald-400 text-[10px]">
                              Zero Window Switching
                            </span>
                          </div>
                          <div className="rounded-lg bg-black/60 p-2 font-mono text-[11px] text-cyan-300 flex items-center justify-between border border-white/5">
                            <span>http://localhost:3000/dashboard</span>
                            <span className="text-[10px] text-white/40">
                              DevTools Attached • DOM Sync
                            </span>
                          </div>
                          <div className="p-3 rounded-lg border border-white/5 bg-black/40 text-center text-white/60 text-[11px]">
                            Interactive web application preview running inside {currentProject.name}
                            . AI agents can inspect DOM elements and diagnose frontend errors live.
                          </div>
                        </div>
                      )}

                      {activeToolId === "testing" && (
                        <div className="rounded-xl border border-white/10 bg-black/80 p-3.5 space-y-2 font-mono text-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <FlaskConicalIcon className="size-3.5 text-emerald-400" />
                              <span className="font-bold text-white">Automated Test Watcher</span>
                            </div>
                            <span className="text-emerald-400 font-bold text-[11px]">
                              25 passed • 0 failed (461ms)
                            </span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-emerald-400 h-full w-full" />
                          </div>
                          <div className="space-y-1 text-[11px] text-white/70 pt-1">
                            <div className="flex items-center justify-between">
                              <span className="text-emerald-300">
                                ✓ src/auth/session.test.ts (12 tests)
                              </span>
                              <span className="text-white/40 text-[10px]">14ms</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-emerald-300">
                                ✓ src/contracts/tokens.test.ts (13 tests)
                              </span>
                              <span className="text-white/40 text-[10px]">8ms</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeToolId === "terminal" && (
                        <div className="rounded-xl border border-white/10 bg-black/80 p-3 font-mono text-xs space-y-1">
                          <div className="text-emerald-400">
                            tabs/{currentProject.name} ({currentProject.branch}) $ bun run build
                          </div>
                          <div className="text-white/70 text-[11px]">
                            $ turbo run build --filter={currentProject.id}
                          </div>
                          <div className="text-white/50 text-[11px]">
                            ✓ Compiled in 1.42s • zero errors • artifact ready
                          </div>
                        </div>
                      )}

                      {(activeToolId === "claude" ||
                        activeToolId === "chatgpt" ||
                        activeToolId === "figma") && (
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs space-y-2 font-mono">
                          <div className="flex items-center justify-between text-[11px] text-white/70">
                            <span className="font-bold text-white capitalize">
                              {activeToolMeta.label} Embedded Tool Tab
                            </span>
                            <span className="text-cyan-400 text-[10px]">Project Webview</span>
                          </div>
                          <div className="rounded-lg bg-black/70 p-2 text-cyan-300 text-[11px] border border-white/5">
                            https://app.{activeToolId}.com/project/{currentProject.id}
                          </div>
                          <p className="text-[11px] text-white/60 font-sans">
                            Pin live Figma canvases, external provider consoles, or team
                            documentation directly inside this project tab for friction-free
                            reference.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Next → footer inside prototype card */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/10">
                    <span className="text-[11px] text-white/40">1 of 3 · Workspace overview</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSetupStep(1);
                        playClick();
                      }}
                      className="flex items-center gap-2 rounded-xl bg-white text-black font-bold text-xs px-5 py-2.5 hover:bg-neutral-100 transition-all duration-150 shadow-lg hover:shadow-white/20 cursor-pointer"
                    >
                      Next <ArrowRightIcon className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── SLIDE 1: App Icon Picker ── */}
            <div
              inert={setupStep !== 1 ? true : undefined}
              className={cn(
                "w-full shrink-0 flex items-center justify-center px-4 sm:px-6",
                setupStep === 1 ? "pointer-events-auto" : "pointer-events-none",
              )}
            >
              <div className="w-full max-w-xl mx-auto">
                <div className="relative rounded-3xl border border-white/15 bg-black/50 p-8 sm:p-10 backdrop-blur-3xl shadow-2xl shadow-black/80 space-y-8">
                  {/* Header */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-white/40 font-mono uppercase tracking-widest">
                      Step 2 of 3
                    </p>
                    <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                      Choose your app icon
                    </h2>
                    <p className="text-sm text-white/55 leading-relaxed">
                      This is the icon that appears in your Dock and application switcher when Tabs
                      is running.
                    </p>
                  </div>

                  {/* 3 real icon options: System (left), Dark (middle), Light (right) */}
                  <div className="grid grid-cols-3 gap-4 sm:gap-5">
                    {(
                      [
                        {
                          id: "system" as const,
                          label: "System",
                          desc: "Follows your theme",
                          src: "/onboarding/app-icon-system.png",
                        },
                        {
                          id: "dark" as const,
                          label: "Dark",
                          desc: "Default dark shell",
                          src: "/onboarding/app-icon-dark.png",
                        },
                        {
                          id: "light" as const,
                          label: "Light",
                          desc: "Classic light shell",
                          src: "/onboarding/app-icon-light.png",
                        },
                      ] as const
                    ).map((icon) => (
                      <button
                        key={icon.id}
                        type="button"
                        onClick={() => handleAppIconSelect(icon.id)}
                        className={cn(
                          "group flex flex-col items-center gap-3.5 p-5 sm:p-6 rounded-2xl border transition-all duration-200 cursor-pointer",
                          selectedAppIcon === icon.id
                            ? "border-white/40 bg-white/12 shadow-xl ring-1 ring-white/30 scale-[1.03]"
                            : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/25 hover:scale-[1.01]",
                        )}
                      >
                        <div
                          className={cn(
                            "w-20 h-20 rounded-3xl overflow-hidden shadow-2xl transition-transform duration-200",
                            selectedAppIcon === icon.id
                              ? "shadow-white/20 ring-2 ring-white/40"
                              : "group-hover:scale-[1.04]",
                          )}
                        >
                          <img
                            src={icon.src}
                            alt={icon.label}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="text-center space-y-0.5">
                          <p
                            className={cn(
                              "text-sm font-bold transition-colors",
                              selectedAppIcon === icon.id
                                ? "text-white"
                                : "text-white/70 group-hover:text-white/90",
                            )}
                          >
                            {icon.label}
                          </p>
                          <p
                            className={cn(
                              "text-[11px] leading-tight transition-colors",
                              selectedAppIcon === icon.id
                                ? "text-white/60"
                                : "text-white/35 group-hover:text-white/50",
                            )}
                          >
                            {icon.desc}
                          </p>
                          {selectedAppIcon === icon.id && (
                            <div className="flex justify-center pt-1">
                              <div className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Footer nav */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => {
                        setSetupStep(0);
                        void playClick();
                      }}
                      className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors cursor-pointer"
                    >
                      <ArrowRightIcon className="size-3 rotate-180" /> Back
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSetupStep(2);
                        void playClick();
                      }}
                      className="flex items-center gap-2 rounded-xl bg-white text-black font-bold text-xs px-5 py-2.5 hover:bg-neutral-100 transition-all duration-150 shadow-lg hover:shadow-white/20 cursor-pointer"
                    >
                      Choose appearance <ArrowRightIcon className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── SLIDE 2: Appearance Picker ── */}
            <div
              inert={setupStep !== 2 ? true : undefined}
              className={cn(
                "w-full shrink-0 flex items-center justify-center px-4 sm:px-6",
                setupStep === 2 ? "pointer-events-auto" : "pointer-events-none",
              )}
            >
              <div className="w-full max-w-xl mx-auto">
                <div className="relative rounded-3xl border border-white/15 bg-black/50 p-8 sm:p-10 backdrop-blur-3xl shadow-2xl shadow-black/80 space-y-7">
                  {/* Header */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-white/40 font-mono uppercase tracking-widest">
                      Step 3 of 3
                    </p>
                    <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                      Choose your appearance
                    </h2>
                    <p className="text-sm text-white/55 leading-relaxed">
                      Pick your preferred color theme for Tabs. You can customize fonts and syntax
                      themes later in Settings.
                    </p>
                  </div>

                  {/* Color mode: System / Dark / Light */}
                  <div className="space-y-3">
                    <p className="text-[11px] text-white/40 uppercase tracking-widest font-semibold">
                      Interface color mode
                    </p>
                    <div className="grid grid-cols-3 gap-3.5">
                      {(
                        [
                          {
                            id: "system" as const,
                            label: "System",
                            icon: MonitorIcon,
                            desc: "Follows OS appearance",
                          },
                          {
                            id: "dark" as const,
                            label: "Dark",
                            icon: MoonIcon,
                            desc: "Default dark theme",
                          },
                          {
                            id: "light" as const,
                            label: "Light",
                            icon: SunIcon,
                            desc: "Crisp light theme",
                          },
                        ] as const
                      ).map(({ id, label, icon: Icon, desc }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => handleAppearanceSelect(id)}
                          className={cn(
                            "group flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all duration-200 cursor-pointer",
                            selectedAppearance === id
                              ? "border-white/40 bg-white/12 shadow-xl ring-1 ring-white/30 scale-[1.02]"
                              : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 hover:scale-[1.01]",
                          )}
                        >
                          <div
                            className={cn(
                              "size-12 rounded-xl flex items-center justify-center transition-colors",
                              selectedAppearance === id
                                ? "bg-white/15 text-white"
                                : "bg-white/5 text-white/50 group-hover:text-white/80",
                            )}
                          >
                            <Icon className="size-6" />
                          </div>
                          <div className="text-center space-y-0.5">
                            <p
                              className={cn(
                                "text-sm font-bold transition-colors",
                                selectedAppearance === id
                                  ? "text-white"
                                  : "text-white/70 group-hover:text-white/90",
                              )}
                            >
                              {label}
                            </p>
                            <p
                              className={cn(
                                "text-[11px] leading-tight transition-colors",
                                selectedAppearance === id ? "text-white/60" : "text-white/35",
                              )}
                            >
                              {desc}
                            </p>
                          </div>
                          {selectedAppearance === id && (
                            <div className="flex justify-center pt-0.5">
                              <div className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Reassurance / More themes note (replacing workbench theme palette as requested) */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-start gap-3.5 backdrop-blur-md">
                    <div className="size-8 rounded-xl bg-white/10 flex items-center justify-center shrink-0 text-white/70 mt-0.5">
                      <PaletteIcon className="size-4" />
                    </div>
                    <div className="space-y-0.5 text-left">
                      <p className="text-xs font-semibold text-white/90">More themes in Settings</p>
                      <p className="text-[11px] text-white/50 leading-relaxed">
                        Additional themes (Dracula, Abyss, True Black), custom editor fonts, and
                        syntax palettes can be configured anytime in Settings.
                      </p>
                    </div>
                  </div>

                  {/* CTA + back */}
                  <div className="flex items-center gap-3 pt-2 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => {
                        setSetupStep(1);
                        void playClick();
                      }}
                      className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors cursor-pointer shrink-0"
                    >
                      <ArrowRightIcon className="size-3 rotate-180" /> Back
                    </button>
                    <button
                      type="button"
                      disabled={isLaunching}
                      onClick={triggerLaunch}
                      className={cn(
                        "flex-1 text-sm gap-2.5 rounded-xl px-6 py-3.5 font-bold transition-all duration-300 cursor-pointer flex items-center justify-center select-none shadow-lg",
                        isLaunching
                          ? "bg-white text-black shadow-[0_0_40px_rgba(255,255,255,0.9)] scale-105 border border-white"
                          : "bg-white text-black hover:bg-neutral-100 hover:shadow-xl hover:shadow-white/25 active:scale-[0.98] border border-white/90",
                      )}
                    >
                      {isLaunching ? (
                        <>
                          <RocketIcon className="size-4 fill-current animate-bounce text-cyan-500" />
                          <span className="tracking-wide">Entering Workbench...</span>
                        </>
                      ) : (
                        <>
                          <PlayIcon className="size-4 fill-current" />
                          <span>Enter Tabs Workbench</span>
                          <ArrowRightIcon className="size-4 text-black/60" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Subtle Footer with Diagnostics */}
      <footer
        className={cn(
          "relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4 sm:px-8 text-xs text-white/40 transition-all duration-500 ease-in-out",
          isLaunching && "translate-y-8 opacity-0 pointer-events-none",
          isSkipping && "translate-y-6 opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-2">
          <span>You can re-open this setup anytime in Settings.</span>
          {!codeHostState?.available && (
            <button
              type="button"
              onClick={() => setShowBuildGuide((b) => !b)}
              className="text-white/60 hover:text-white underline text-[11px]"
            >
              Code-OSS build guide
            </button>
          )}
        </div>

        {showBuildGuide && (
          <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 rounded-2xl border border-white/20 bg-black/90 p-4 backdrop-blur-2xl shadow-2xl text-xs max-w-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">Local Code-OSS Compilation</span>
              <button
                type="button"
                onClick={() => setShowBuildGuide(false)}
                className="text-white/60 hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="rounded-lg bg-white/10 p-2 font-mono text-[11px] text-white flex items-center justify-between">
              <span>cd ../tabs-code-oss && npm install && npm run compile</span>
              <button
                type="button"
                onClick={handleCopyBuild}
                className="text-cyan-400 hover:text-cyan-300 ml-2"
              >
                {copiedCommand ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <span className="text-[11px] font-mono text-white/50">
          Tabs IDE Public Beta • v{APP_VERSION}
        </span>
      </footer>
    </div>
  );
}
