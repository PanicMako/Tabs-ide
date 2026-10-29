import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import gsap from "gsap";
import { SegmentedControl } from "../ui/segmented-control";
import { ChevronDownIcon, ChevronUpIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  CURATED_FONT_COMBOS,
  getActiveFontCombo,
  getFontComboPageHeading,
  selectFontCombo,
  resolveFontTypography,
  type FontCombo,
  type FontPreferences,
} from "../../lib/themes";
import { usePanelAnimationSettings } from "../../panelAnimations";
import "./typography-reel.css";

const presets = CURATED_FONT_COMBOS.filter((combo) => !combo.isNeutral);
const displayFont = (combo: FontCombo) =>
  combo.id === "syne-dropped" ? combo.uiFont : combo.headingFont;
const clean = (font: string) => font.split(",")[0]!.replaceAll("'", "");

export function TypographyReel({
  fonts,
  composerFont,
  onSelect,
  onTune,
  onCustom,
  savedMixes,
}: {
  fonts: FontPreferences;
  composerFont: string;
  onSelect: (combo: FontCombo) => void;
  onTune: () => void;
  onCustom: () => void;
  savedMixes: ReactNode;
}) {
  const committedFonts = fonts;
  const selected = getActiveFontCombo(committedFonts);
  const initialIndex = Math.max(
    0,
    presets.findIndex((p) => p.id === selected.id),
  );
  const [cursor, setCursor] = useState(initialIndex);
  const [browsing, setBrowsing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [previewTab, setPreviewTab] = useState<"notes" | "code">("notes");
  const index = cursor;
  const reel = useRef<HTMLDivElement>(null);
  const sample = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const scrollTarget = useRef<number | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSelectRef = useRef(onSelect);
  const { reducedMotion } = usePanelAnimationSettings();
  const animate = !reducedMotion;
  const previewCombo = browsing ? presets[cursor]! : selected;
  const previewFonts =
    browsing && previewCombo.id !== selected.id
      ? selectFontCombo(committedFonts, previewCombo)
      : committedFonts;
  const typography = resolveFontTypography(previewFonts);
  const pageHeading = getFontComboPageHeading(previewCombo, previewFonts);
  const choose = (next: number) => {
    const target = Math.max(0, Math.min(presets.length - 1, next));
    const node = reel.current;
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    scrollTarget.current = target;
    if (node) node.dataset.programmatic = "true";
    setCursor(target);
    setBrowsing(true);
    onSelectRef.current(presets[target]!);
    if (!node) return;
    gsap.killTweensOf(node);
    scrollTarget.current = target;
    if (!animate) {
      node.scrollTop = target * 72;
      scrollTarget.current = null;
      delete node.dataset.programmatic;
    } else
      gsap.to(node, {
        scrollTop: target * 72,
        duration: 0.42,
        ease: "power3.out",
        overwrite: true,
        onComplete: () => {
          scrollTarget.current = null;
          delete node.dataset.programmatic;
        },
      });
  };
  const nativeScroll = () => {
    if (!editing || scrollTarget.current !== null || !reel.current) return;
    const target = Math.max(
      0,
      Math.min(presets.length - 1, Math.round(reel.current.scrollTop / 72)),
    );
    setCursor(target);
    setBrowsing(true);
    if (idle.current) clearTimeout(idle.current);
    // Preview locally while the gesture is moving; persist one choice when it settles.
    idle.current = setTimeout(() => {
      idle.current = null;
      onSelectRef.current(presets[target]!);
    }, 160);
  };
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
  });
  useLayoutEffect(() => {
    const node = reel.current;
    if (!node) return;
    if (scrollTarget.current !== null) {
      setBrowsing(false);
      return;
    }
    const target = presets.findIndex((p) => p.id === selected.id);
    if (target >= 0 && Math.abs(node.scrollTop - target * 72) > 1 && idle.current === null) {
      scrollTarget.current = target;
      node.scrollTop = target * 72;
      requestAnimationFrame(() => {
        scrollTarget.current = null;
      });
      setCursor(target);
    }
    setBrowsing(false);
  }, [selected.id]);
  useEffect(() => {
    const node = reel.current;
    if (!node) return;
    const interrupt = () => {
      gsap.killTweensOf(node);
      delete node.dataset.programmatic;
      scrollTarget.current = null;
    };
    // Native wheel/touch scrolling owns position, momentum and scroll snapping.
    node.addEventListener("wheel", interrupt, { passive: true });
    return () => {
      node.removeEventListener("wheel", interrupt);
      gsap.killTweensOf(node);
      if (idle.current) clearTimeout(idle.current);
    };
  }, []);
  useLayoutEffect(() => {
    const node = reel.current;
    if (!node) return;
    const fit = () => {
      node.querySelectorAll<HTMLElement>(".font-reel-name").forEach((name) => {
        name.style.fontSize = "44px";
        const width = name.getBoundingClientRect().width;
        // offsetWidth is unaffected by the reel's animated scale.
        const natural = name.scrollWidth || width;
        name.style.fontSize = `${Math.min(44, (44 * (node.clientWidth - 24)) / Math.max(1, natural))}px`;
      });
    };
    fit();
    let alive = true;
    const fontRequests = presets.flatMap((combo) => [
      `${combo.typography?.headingWeight ?? 600} 44px ${displayFont(combo).split(",")[0]}`,
      `${combo.typography?.specimenWeight ?? 400} 24px ${combo.typography?.specimenFont.split(",")[0] ?? combo.uiFont.split(",")[0]}`,
      `400 16px ${combo.uiFont.split(",")[0]}`,
    ]);
    void Promise.allSettled(fontRequests.map((font) => document.fonts.load(font))).then(() => {
      if (alive) fit();
    });
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const buttons = reel.current?.querySelectorAll<HTMLElement>(".font-reel-choice");
    if (!buttons) return;
    buttons.forEach((button, i) => {
      const distance = Math.abs(i - index);
      gsap.to(button, {
        scale: 1 - 0.2 * Math.min(distance, 3),
        opacity: distance === 0 ? 1 : Math.max(0, 0.45 - 0.12 * (distance - 1)),
        duration: animate ? 0.14 : 0,
        ease: "power2.out",
        overwrite: "auto",
        force3D: true,
      });
    });
    return () => {
      gsap.killTweensOf(buttons);
    };
  }, [index, animate]);

  useEffect(() => {
    const node = sample.current;
    if (!node) return;
    if (!animate) gsap.set(node, { rotateX: 0, rotateY: 0 });
    return () => {
      gsap.killTweensOf(node);
    };
  }, [animate]);

  const style = {
    "--reel-ui": previewFonts.uiFont,
    "--reel-heading":
      previewCombo.id === "syne-dropped" ? previewFonts.uiFont : previewFonts.headingFont,
    "--reel-section": typography.sectionFont,
    "--reel-supporting": typography.supportingFont,
    "--reel-code": previewFonts.editorFont,
    "--reel-composer":
      !composerFont || composerFont === "inherit"
        ? previewFonts.uiFont
        : composerFont === "monospace"
          ? previewFonts.editorFont
          : composerFont,
    "--reel-ui-size": `${fonts.fontSizeInterface ?? 16}px`,
    "--reel-code-size": `${fonts.fontSizeCode ?? 13}px`,
    "--reel-prompt-size": `${fonts.fontSizePrompt ?? 14}px`,
    "--reel-heading-weight": typography.headingWeight,
    "--reel-section-weight": typography.sectionWeight,
    "--reel-row-weight": typography.rowWeight,
    "--reel-interface-tracking": typography.interfaceTracking,
    "--reel-row-tracking": typography.rowTracking,
    "--reel-supporting-weight": typography.supportingWeight,
    "--reel-heading-size": pageHeading.fontSize ?? "38px",
  } as CSSProperties;
  return (
    <div className="typography-reel" style={style}>
      <div className="font-reel-toolbar">
        <span>Find your type.</span>
        <button type="button" onClick={onTune}>
          <SlidersHorizontalIcon />
          Tune
        </button>
      </div>
      <div className="font-reel-layout">
        <div className="font-reel-navigation">
          <div className="font-reel-edit-header">
            <span>Font pairing</span>
            <button
              type="button"
              aria-pressed={editing}
              onClick={() => {
                if (editing) {
                  if (idle.current) clearTimeout(idle.current);
                  idle.current = null;
                  if (browsing) onSelectRef.current(presets[cursor]!);
                  if (reel.current) {
                    gsap.killTweensOf(reel.current);
                    delete reel.current.dataset.programmatic;
                  }
                  scrollTarget.current = null;
                }
                setEditing(!editing);
              }}
            >
              {editing ? "Done" : "Edit fonts"}
            </button>
          </div>
          <div
            className="font-reel"
            ref={reel}
            role="group"
            aria-label="Typography presets"
            data-editing={editing}
            onScroll={nativeScroll}
            onKeyDown={(e) => {
              if (!editing) return;
              const next =
                e.key === "ArrowDown" || e.key === "ArrowRight"
                  ? index + 1
                  : e.key === "ArrowUp" || e.key === "ArrowLeft"
                    ? index - 1
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? presets.length - 1
                        : null;
              if (next !== null) {
                e.preventDefault();
                choose(next);
                reel.current
                  ?.querySelector<HTMLButtonElement>(
                    `[data-font-index="${Math.max(0, Math.min(presets.length - 1, next))}"]`,
                  )
                  ?.focus({ preventScroll: true });
              }
            }}
            onPointerDown={(e) => {
              if (!editing || e.button !== 0 || e.pointerType !== "mouse") return;
              if (reel.current) gsap.killTweensOf(reel.current);
              scrollTarget.current = null;
              e.currentTarget.dataset.programmatic = "true";
              drag.current = { y: e.clientY, top: e.currentTarget.scrollTop, moved: false };
              suppressClick.current = false;
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const delta = e.clientY - drag.current.y;
              if (Math.abs(delta) > 4) {
                if (!e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.setPointerCapture(e.pointerId);
                drag.current.moved = true;
                suppressClick.current = true;
                e.currentTarget.scrollTop = drag.current.top - delta;
              }
            }}
            onPointerUp={(e) => {
              drag.current = null;
              delete e.currentTarget.dataset.programmatic;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={(e) => {
              delete e.currentTarget.dataset.programmatic;
              drag.current = null;
            }}
            onPointerLeave={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
                drag.current = null;
                delete e.currentTarget.dataset.programmatic;
              }
            }}
          >
            {presets.map((combo, i) => (
              <button
                type="button"
                key={combo.id}
                data-font-index={i}
                className="font-reel-choice"
                aria-pressed={(browsing || !selected.isNeutral) && i === index}
                aria-label={`Select ${combo.name}: ${combo.desc}`}
                tabIndex={editing && i === index ? 0 : -1}
                disabled={!editing}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  choose(i);
                }}
              >
                <span
                  className="font-reel-name"
                  style={{
                    fontFamily: displayFont(combo),
                    fontWeight: combo.typography?.headingWeight ?? 600,
                    letterSpacing: combo.typography?.headingTracking,
                  }}
                >
                  {combo.name}
                </span>
              </button>
            ))}
          </div>
          <div className="font-reel-paging">
            <span>
              {index + 1} / {presets.length}
            </span>
            <div>
              <button
                type="button"
                aria-label="Previous font pairing"
                disabled={!editing || index === 0}
                onClick={() => choose(index - 1)}
              >
                <ChevronUpIcon />
              </button>
              <button
                type="button"
                aria-label="Next font pairing"
                disabled={!editing || index === presets.length - 1}
                onClick={() => choose(index + 1)}
              >
                <ChevronDownIcon />
              </button>
            </div>
          </div>
        </div>
        <div className="font-reel-info">
          <div className="font-reel-description" aria-live="polite">
            <strong>{previewCombo.name}</strong>
            <span>
              {previewCombo.id === "custom"
                ? `${clean(previewFonts.headingFont)} + ${clean(typography.sectionFont)} · ${clean(previewFonts.uiFont)}`
                : previewCombo.desc}
            </span>
          </div>
          <div
            className="font-reel-perspective"
            onPointerMove={(e) => {
              if (!animate || e.pointerType !== "mouse" || !sample.current) return;
              const r = e.currentTarget.getBoundingClientRect();
              gsap.to(sample.current, {
                rotateY: ((e.clientX - r.left) / r.width - 0.5) * 7,
                rotateX: ((e.clientY - r.top) / r.height - 0.5) * -5,
                duration: 0.45,
                ease: "power3.out",
                overwrite: true,
              });
            }}
            onPointerLeave={() => {
              if (sample.current)
                gsap.to(sample.current, {
                  rotateX: 0,
                  rotateY: 0,
                  duration: animate ? 0.5 : 0,
                  overwrite: true,
                });
            }}
          >
            <div
              className="font-reel-sample"
              ref={sample}
              data-interface-font={clean(previewFonts.uiFont)}
              aria-label="Live typography preview"
            >
              <div className="font-reel-windowbar">
                <span className="font-reel-window-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <strong>tabs</strong>
                <span>Personal workspace</span>
                <kbd>⌘ K</kbd>
              </div>
              <div className="font-reel-preview-controls">
                <span>Type in context</span>
                <SegmentedControl
                  value={previewTab}
                  onValueChange={setPreviewTab}
                  options={[
                    { value: "notes", label: "Text" },
                    { value: "code", label: "Code" },
                  ]}
                  size="sm"
                  aria-label="Preview mode"
                  className="font-reel-view-toggle"
                />
              </div>
              <div className="font-reel-app-body">
                <div className="font-reel-app-nav">
                  <span className="font-reel-project-title">Workspace</span>
                  <span className="selected">Typography</span>
                  <span>Palette</span>
                  <span>Shortcuts</span>
                  <span className="font-reel-branch">⑂ main</span>
                </div>
                <div className="font-reel-app-content">
                  {previewTab === "notes" ? (
                    <div className="font-reel-document">
                      <span className="font-reel-doc-path">workspace / typography</span>
                      <h4 style={{ fontWeight: typography.headingWeight }}>
                        Make room
                        <br />
                        for ideas.
                      </h4>
                      <h5 style={{ fontStyle: typography.sectionStyle }}>A detail you can feel.</h5>
                      <p style={{ fontStyle: typography.supportingStyle }}>
                        One pairing, every surface.
                      </p>
                    </div>
                  ) : (
                    <div className="font-reel-code-document">
                      <span className="font-reel-doc-path">workspace / theme.ts</span>
                      <pre>
                        <span>export const</span> typography = {"{"}
                        {"\n"} heading: "{clean(previewFonts.headingFont)}",{"\n"} interface: "
                        {clean(previewFonts.uiFont)}",{"\n"} editor: "
                        {clean(previewFonts.editorFont)}",{"\n"}
                        {"};"}
                      </pre>
                      <p>The same fonts. Every surface.</p>
                    </div>
                  )}
                  <div className="font-reel-composer">
                    <span>Refine this workspace…</span>
                    <i aria-hidden="true">↑</i>
                  </div>
                </div>
              </div>
              <div className="font-reel-windowfooter">
                <span>Interface · {clean(previewFonts.uiFont)}</span>
                <span>Code · {clean(previewFonts.editorFont)}</span>
              </div>
            </div>
          </div>
          <div className="font-reel-defaults">
            {CURATED_FONT_COMBOS.filter((p) => p.isNeutral).map((combo) => (
              <button
                type="button"
                key={combo.id}
                aria-pressed={selected.id === combo.id}
                onClick={() => onSelect(combo)}
              >
                {combo.name}
              </button>
            ))}
            <button type="button" onClick={onCustom}>
              Custom mix
            </button>
          </div>
        </div>
      </div>
      <details className="font-reel-saved">
        <summary>Saved mixes</summary>
        {savedMixes}
      </details>
    </div>
  );
}
