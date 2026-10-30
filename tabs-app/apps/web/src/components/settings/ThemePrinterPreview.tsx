import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import type { CSSProperties } from "react";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import type { CustomThemeConfig } from "../../lib/themes";
import "./theme-printer.css";

export function ThemePrinterPreview({
  config,
  name,
  previewOpen,
  onPreviewOpenChange,
}: {
  config: CustomThemeConfig;
  name: string;
  previewOpen: boolean;
  onPreviewOpenChange: (open: boolean) => void;
}) {
  const palette = [
    config.colors.background,
    config.colors.card,
    config.colors.foreground,
    config.colors.primary,
  ];
  const printKey = JSON.stringify([name, ...palette]);
  const style = {
    "--tp-bg": palette[0],
    "--tp-surface": palette[1],
    "--tp-panel": palette[1],
    "--tp-text": palette[2],
    "--tp-accent": palette[3],
  } as CSSProperties;
  return (
    <div className="theme-printer-presentation" style={style}>
      <section className="tp-printer-wrap" aria-label="Printed theme preview">
        <div className="tp-printer-scene">
          <div className="tp-printer" aria-hidden="true">
            <div className="tp-brand">
              Tabs <span>Palette</span>
            </div>
            <div className="tp-led"></div>
            <div className="tp-slot-shell">
              <div className="tp-slot"></div>
            </div>
            <div className="tp-vent"></div>
          </div>
          <div className="tp-print-track">
            <div className="tp-paper-plane">
              <div className="tp-paper-feed tp-eject" key={printKey}>
                <div className="tp-photo">
                  <div className="tp-photo-face">
                    <i className="tp-circle"></i>
                    <i className="tp-sample"></i>
                    <b className="tp-aa">Aa</b>
                    <i className="tp-ridges"></i>
                    <i className="tp-shine"></i>
                  </div>
                  <div className="tp-photo-caption">{name}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="tp-aperture-lip" aria-hidden="true"></div>
        </div>
      </section>
      <Dialog open={previewOpen} onOpenChange={onPreviewOpenChange}>
        <DialogPopup className="tp-preview-dialog" style={style} bottomStickOnMobile={false}>
          <DialogHeader>
            <DialogTitle>{name} — workspace preview</DialogTitle>
            <DialogDescription>
              Your selected theme across Tabs surfaces, text, and controls.
            </DialogDescription>
          </DialogHeader>
          <div className="tp-expanded-window">
            <ThemeSettingsWindow config={config} name={name} palette={palette} />
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

function ThemeSettingsWindow({
  config,
  name,
  palette,
}: {
  config: CustomThemeConfig;
  name: string;
  palette: string[];
}) {
  return (
    <div
      className="tp-app-preview"
      role="img"
      aria-label={`Tabs appearance settings in ${name}`}
      data-ui
    >
      <div className="tp-mini-bar">
        <div className="tp-window-dots">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <span className="tp-mini-tab">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" rx="1" />
            <rect x="14" y="4" width="6" height="6" rx="1" />
            <rect x="4" y="14" width="6" height="6" rx="1" />
            <rect x="14" y="14" width="6" height="6" rx="1" />
          </svg>
          Workspace
        </span>
        <span className="tp-mini-tab tp-active">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="m9 3 1 2h4l1-2 3 2v3l3 2v4l-3 2v3l-3 2-1-2h-4l-1 2-3-2v-3l-3-2v-4l3-2V5z" />
          </svg>
          Settings
        </span>
        <span className="tp-mini-plus">+</span>
      </div>
      <div className="tp-mini-body">
        <div className="tp-mini-sidebar">
          <div className="tp-mini-wordmark">
            <i className="tp-mini-mark"></i>tabs
          </div>
          <span className="tp-mini-nav">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="m9 3 1 2h4l1-2 3 2v3l3 2v4l-3 2v3l-3 2-1-2h-4l-1 2-3-2v-3l-3-2v-4l3-2V5z" />
            </svg>
            General
          </span>
          <span className="tp-mini-nav tp-selected">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
            </svg>
            Appearance
          </span>
          <span className="tp-mini-nav">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M6 10h2m3 0h2m3 0h2M7 14h10" />
            </svg>
            Shortcuts
          </span>
          <span className="tp-mini-account">Your workspace</span>
        </div>
        <div className="tp-mini-settings">
          <div className="tp-mini-title-row">
            <h3>Appearance</h3>
            <span>Make room for you.</span>
          </div>
          <div className="tp-theme-specimen">
            <i className="tp-specimen-disc"></i>
            <span className="tp-specimen-type">Aa</span>
            <div className="tp-specimen-detail">
              <strong>{name}</strong>
              <small>{config.baseVariant} palette</small>
              <div className="tp-mini-palette">
                {palette.map((color, index) => (
                  <i key={index} style={{ background: color }} />
                ))}
              </div>
            </div>
          </div>
          <div className="tp-mini-option">
            <span>
              Accent color<small>A little personality, everywhere.</small>
            </span>
            <i className="tp-mini-toggle"></i>
          </div>
          <div className="tp-mini-option">
            <span>Reduce motion</span>
            <i className="tp-mini-toggle"></i>
          </div>
        </div>
      </div>
    </div>
  );
}
