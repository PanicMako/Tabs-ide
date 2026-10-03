// Aurora Liquid Button Engine
// High-performance canvas-based wave fill animation for primary action buttons.
// Supports both primary blue buttons (deep royal surge) and inverted white buttons (blue wave fill).

interface WaveConfig {
  color: string;
  speed: number;
  amp: number;
  offset: number;
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

export function setupAuroraLiquidButton(button: HTMLElement) {
  if (reducedMotion.matches) return;
  if (button.dataset.auroraInit === "true") return;
  button.dataset.auroraInit = "true";

  // Find or create canvas
  let canvas = button.querySelector<HTMLCanvasElement>("canvas.cta-liquid-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "cta-liquid-canvas";
    canvas.setAttribute("aria-hidden", "true");
    button.prepend(canvas);
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Determine button color mode:
  // Is it an inverted white button (like in the dark footer .hs-end) or standard primary blue?
  const isInvertedWhite =
    button.closest(".hs-end") !== null || button.classList.contains("cta-white");

  // Waves configuration tailored to surface contrast
  // For inverted white button (on dark blue footer): soft luminous pearlescent ice waves so it NEVER blends into the blue background.
  // For primary blue button (on light page): rich multi-tone ocean surge settling into deep royal navy.
  const waves: WaveConfig[] = isInvertedWhite
    ? [
        { color: "rgba(219, 234, 254, 0.65)", speed: 1.2, amp: 6, offset: 0 },
        { color: "rgba(191, 219, 254, 0.55)", speed: -0.85, amp: 7.5, offset: 2 },
        { color: "rgba(238, 242, 255, 0.85)", speed: 1.4, amp: 5, offset: 4 },
      ]
    : [
        { color: "rgba(186, 215, 255, 0.42)", speed: 1.25, amp: 7.5, offset: 0 },
        { color: "rgba(96, 165, 250, 0.68)", speed: -0.9, amp: 9, offset: 2.2 },
        { color: "rgba(22, 47, 168, 1)", speed: 1.55, amp: 5.5, offset: 4.4 },
      ];

  let isHovered = false;
  let fillAmount = 0;
  let time = 0;
  let animationId: number | null = null;

  const render = () => {
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width === 0 || height === 0) {
      animationId = requestAnimationFrame(render);
      return;
    }

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Smooth interpolation for fluid fill level
    const target = isHovered ? 1 : 0;
    fillAmount += (target - fillAmount) * 0.11;
    time += 0.035;

    ctx.clearRect(0, 0, width, height);

    if (fillAmount > 0.001) {
      ctx.globalCompositeOperation = "source-over";

      for (let i = 0; i < waves.length; i++) {
        const wave = waves[i];
        ctx.beginPath();
        const baseLevel = height - height * fillAmount;
        const currentAmp = wave.amp * fillAmount * (isHovered ? 1 : 0.3);

        ctx.moveTo(0, height);
        ctx.lineTo(0, baseLevel);

        for (let x = 0; x <= width; x += 3) {
          const y =
            baseLevel +
            Math.sin((x / width) * Math.PI * 2 + time * wave.speed + wave.offset) * currentAmp;
          ctx.lineTo(x, y);
        }

        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fillStyle = wave.color;
        ctx.fill();
      }
    }

    ctx.restore();

    // If completely settled back to idle, pause the animation loop to save battery
    if (!isHovered && fillAmount <= 0.001) {
      fillAmount = 0;
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      animationId = null;
      return;
    }

    animationId = requestAnimationFrame(render);
  };

  const startAnimation = () => {
    isHovered = true;
    if (animationId === null) {
      animationId = requestAnimationFrame(render);
    }
  };

  const stopAnimation = () => {
    isHovered = false;
    if (animationId === null && fillAmount > 0.001) {
      animationId = requestAnimationFrame(render);
    }
  };

  button.addEventListener("mouseenter", startAnimation);
  button.addEventListener("mouseleave", stopAnimation);
  button.addEventListener("focus", startAnimation);
  button.addEventListener("blur", stopAnimation);
}

export function initAllAuroraButtons() {
  if (typeof document === "undefined") return;
  const buttons = document.querySelectorAll<HTMLElement>(".headspace .cta, [data-aurora-liquid]");
  buttons.forEach(setupAuroraLiquidButton);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAllAuroraButtons);
  } else {
    initAllAuroraButtons();
  }
}
