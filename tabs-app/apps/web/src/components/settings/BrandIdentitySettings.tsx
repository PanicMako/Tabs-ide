import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { TABS_LOGO_VARIANTS, type TabsLogoVariant } from "@tabs/shared/tabsBrand";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useResolvedBrandVariant } from "../../hooks/useDesktopIconTheme";
import { TabsBrandMark } from "../TabsBrandMark";
import { SettingsSection } from "./SettingsLayout";
import "./brand-identity.css";

const FINISHES: Record<TabsLogoVariant, string> = {
  signature: "Original",
  "blue-white": "Light",
  mono: "Mono",
  "ivory-ink": "Dark",
  "blue-ink": "Neon",
};

/** Keep artwork mounted at one size; changing finish crossfades without replaying position. */
function IdentityMark({ variant, label }: { variant: TabsLogoVariant; label: string }) {
  return (
    <span className="brand-identity-mark" role="img" aria-label={label} data-variant={variant}>
      {TABS_LOGO_VARIANTS.map((finish) => (
        <span
          key={finish.id}
          className="brand-identity-mark-layer"
          data-active={finish.id === variant || undefined}
          aria-hidden="true"
        >
          <TabsBrandMark variant={finish.id} />
        </span>
      ))}
    </span>
  );
}

export function BrandIdentitySettings() {
  const { desktopIconTheme } = useSettings();
  const { updateSettings } = useUpdateSettings();
  const selected = useResolvedBrandVariant();
  const [hovered, setHovered] = useState<TabsLogoVariant | null>(null);
  const [feedback, setFeedback] = useState<{
    variant: TabsLogoVariant;
    status: "saving" | "applied" | "failed";
  } | null>(null);
  const applySequence = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyAnimations = useRef<Animation[]>([]);
  const previewRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const followerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const previousX = useRef(0);
  const visible = hovered ?? selected;
  const finish = TABS_LOGO_VARIANTS.find((item) => item.id === visible)!;

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      applySequence.current++;
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
      for (const animation of applyAnimations.current) animation.cancel();
    },
    [],
  );

  const applyFinish = async (variant: TabsLogoVariant) => {
    const sequence = ++applySequence.current;
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    for (const animation of applyAnimations.current) animation.cancel();
    applyAnimations.current = [];
    setFeedback({ variant, status: "saving" });
    let saved = false;
    try {
      saved = await updateSettings({ desktopIconTheme: variant });
    } catch {
      /* Show failure without announcing a successful application. */
    }
    if (sequence !== applySequence.current) return;
    setFeedback({ variant, status: saved ? "applied" : "failed" });
    if (saved && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const preview = previewRef.current;
      // Animate the previewed finish only. Hovering another option must remain responsive.
      const targets = preview?.querySelectorAll<HTMLElement>(
        ".brand-identity-artwork > .brand-identity-mark, .brand-identity-dock-tabs > .brand-identity-mark",
      );
      for (const [index, target] of Array.from(targets ?? []).entries()) {
        if (target.dataset.variant !== variant) continue;
        const animation = target.animate(
          [
            { transform: "scale(1)", opacity: 1 },
            { transform: "scale(0.9)", opacity: 0.7, offset: 0.25 },
            { transform: "scale(1.045)", opacity: 1, offset: 0.65 },
            { transform: "scale(1)", opacity: 1 },
          ],
          { duration: 560, delay: index * 80, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
        animation.id = "identity-apply";
        applyAnimations.current.push(animation);
      }
      const ring = preview?.querySelector<HTMLElement>(".brand-identity-apply-ring");
      if (ring) {
        const animation = ring.animate(
          [{ opacity: 0 }, { opacity: 0.75, offset: 0.35 }, { opacity: 0 }],
          { duration: 700, easing: "ease-out" },
        );
        animation.id = "identity-apply-ring";
        applyAnimations.current.push(animation);
      }
    }
    feedbackTimer.current = setTimeout(
      () => {
        feedbackTimer.current = null;
        setFeedback(null);
      },
      saved ? 2000 : 4000,
    );
  };

  const positionLogo = (clientX: number, clientY: number) => {
    const bounds = listRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.max(0, Math.min(bounds.width - 104, clientX - bounds.left - 30));
    const y = Math.max(-16, Math.min(bounds.height - 88, clientY - bounds.top - 52));
    const tilt = Math.max(-12, Math.min(12, (clientX - previousX.current) * 0.3));
    previousX.current = clientX;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (followerRef.current)
        followerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${tilt}deg)`;
    });
  };

  return (
    <SettingsSection title="Tabs identity" contentClassName="brand-identity-panel">
      <div className="brand-identity" data-ui>
        <div className="brand-identity-selection">
          <p className="brand-identity-intro">One mascot. Five finishes.</p>
          <div
            ref={listRef}
            className="brand-identity-index"
            role="group"
            aria-label="Tabs logo treatment"
            data-browsing={hovered !== null || undefined}
            onPointerLeave={() => setHovered(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null);
            }}
          >
            {TABS_LOGO_VARIANTS.map((variant, index) => (
              <button
                key={variant.id}
                type="button"
                className="brand-identity-row"
                aria-pressed={selected === variant.id}
                aria-label={`Use ${variant.name}`}
                data-highlighted={visible === variant.id || undefined}
                onClick={() => void applyFinish(variant.id)}
                onPointerEnter={(event) => {
                  if (event.pointerType === "touch") return;
                  if (feedback?.status === "applied" && feedback.variant !== variant.id) {
                    for (const animation of applyAnimations.current) animation.cancel();
                  }
                  previousX.current = event.clientX;
                  positionLogo(event.clientX, event.clientY);
                  setHovered(variant.id);
                }}
                onPointerMove={(event) => {
                  if (event.pointerType !== "touch") positionLogo(event.clientX, event.clientY);
                }}
                onFocus={(event) => {
                  // Pointer focus must not teleport the follower to the keyboard anchor.
                  if (!event.currentTarget.matches(":focus-visible")) return;
                  if (feedback?.status === "applied" && feedback.variant !== variant.id) {
                    for (const animation of applyAnimations.current) animation.cancel();
                  }
                  setHovered(variant.id);
                  const rect = event.currentTarget.getBoundingClientRect();
                  previousX.current = rect.right - 72;
                  positionLogo(rect.right - 72, rect.top + rect.height / 2);
                }}
                onKeyDown={(event) => {
                  const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                  if (!offset && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  const rows = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
                  const next =
                    event.key === "Home" ? 0 : event.key === "End" ? 4 : (index + offset + 5) % 5;
                  rows?.[next]?.focus();
                }}
              >
                <span className="brand-identity-number">0{index + 1}</span>
                <span className="brand-identity-name">{variant.name}</span>
                <span className="brand-identity-kind">{FINISHES[variant.id]}</span>
                <span className="brand-identity-in-use">
                  {selected === variant.id ? "In use" : ""}
                </span>
              </button>
            ))}
            <div
              ref={followerRef}
              className="brand-identity-follower"
              data-visible={hovered !== null || undefined}
              aria-hidden="true"
            >
              <IdentityMark variant={visible} label="Finish preview" />
            </div>
          </div>
          <p className="brand-identity-help">
            Hover to explore. Select to apply.
            {!TABS_LOGO_VARIANTS.some((variant) => variant.id === desktopIconTheme) &&
              " Your icon currently follows the appearance setting in General."}
          </p>
        </div>

        <figure
          ref={previewRef}
          className="brand-identity-preview"
          aria-label="Tabs identity preview"
        >
          <div className="brand-identity-preview-heading">
            <span>In your workspace</span>
            <span className="brand-identity-preview-status">
              {feedback && (feedback.status !== "applied" || feedback.variant === visible) ? (
                feedback.status === "saving" ? (
                  "Applying…"
                ) : feedback.status === "failed" ? (
                  "Couldn’t apply"
                ) : (
                  <>
                    <CheckIcon aria-hidden="true" />
                    {TABS_LOGO_VARIANTS.find((item) => item.id === feedback.variant)!.name} applied
                  </>
                )
              ) : visible === selected ? (
                <>
                  <CheckIcon aria-hidden="true" /> Applied
                </>
              ) : (
                "Preview"
              )}
            </span>
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {feedback?.status === "applied"
              ? `${TABS_LOGO_VARIANTS.find((item) => item.id === feedback.variant)!.name} icon applied.`
              : feedback?.status === "failed"
                ? "Icon could not be applied. Try again."
                : ""}
          </span>
          <div className="brand-identity-desktop">
            <div className="brand-identity-window">
              <span className="brand-identity-apply-ring" aria-hidden="true" />
              <div className="brand-identity-window-bar">
                <span className="brand-identity-window-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="brand-identity-browser-tab">
                  <TabsBrandMark variant={visible} label="Browser tab icon" />
                  <span>Tabs</span>
                  <span className="brand-identity-tab-close" aria-hidden="true">
                    ×
                  </span>
                </span>
              </div>
              <div className="brand-identity-artwork">
                <IdentityMark variant={visible} label={`${finish.name} app icon`} />
                <span>tabs</span>
              </div>
              <div className="brand-identity-dock" aria-label="Desktop dock preview">
                <span className="brand-identity-neighbor" aria-hidden="true" />
                <span className="brand-identity-neighbor" aria-hidden="true" />
                <span className="brand-identity-dock-tabs">
                  <IdentityMark variant={visible} label="Dock icon" />
                  <i />
                </span>
                <span className="brand-identity-neighbor" aria-hidden="true" />
                <span className="brand-identity-neighbor" aria-hidden="true" />
              </div>
            </div>
          </div>
        </figure>
      </div>
    </SettingsSection>
  );
}
