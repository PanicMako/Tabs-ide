// Aurora Liquid Button Engine
// Adapted from Concept One (apps/marketing)
// High-performance canvas-based wave fill animation for primary action buttons.

interface WaveConfig {
  color: string;
  speed: number;
  amp: number;
  offset: number;
}

const reducedMotion =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

export function setupAuroraLiquidButton(button: HTMLElement) {
  if (reducedMotion.matches) return;
  if (button.dataset.auroraInit === "true") return;
  button.dataset.auroraInit = "true";

  let canvas = button.querySelector<HTMLCanvasElement>("canvas.cta-liquid-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "cta-liquid-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "-1";
    button.prepend(canvas);
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const waves: WaveConfig[] =
    button.dataset.auroraLiquid === "white"
      ? [
          { color: "rgba(255, 255, 255, 0.42)", speed: 1.25, amp: 7.5, offset: 0 },
          { color: "rgba(255, 255, 255, 0.68)", speed: -0.9, amp: 9, offset: 2.2 },
          { color: "rgba(255, 255, 255, 1)", speed: 1.55, amp: 5.5, offset: 4.4 },
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
    if (!button.isConnected || document.hidden || reducedMotion.matches) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      isHovered = false;
      fillAmount = 0;
      animationId = null;
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width === 0 || height === 0) {
      isHovered = false;
      fillAmount = 0;
      animationId = null;
      return;
    }

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

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

    if (!isHovered && fillAmount <= 0.001) {
      fillAmount = 0;
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      animationId = null;
      return;
    }

    animationId = requestAnimationFrame(render);
  };

  const startAnimation = () => {
    if (reducedMotion.matches || button.matches(":disabled")) return;
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
  const buttons = document.querySelectorAll<HTMLElement>(
    ".button:not(.secondary), .cta-primary, [data-aurora-liquid]",
  );
  buttons.forEach(setupAuroraLiquidButton);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAllAuroraButtons);
  } else {
    initAllAuroraButtons();
  }

  // Observe dynamically inserted buttons
  if (typeof MutationObserver !== "undefined" && document.body) {
    const observer = new MutationObserver(() => {
      initAllAuroraButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
