import { useEffect, useState, type ReactNode } from "react";
import {
  LaptopIcon,
  MaximizeIcon,
  MinusIcon,
  MonitorIcon,
  PictureInPicture2Icon,
  PlusIcon,
  RectangleHorizontalIcon,
  RectangleVerticalIcon,
  RulerIcon,
  SmartphoneIcon,
  TabletIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SegmentedControl } from "../ui/segmented-control";
import {
  BROWSER_DEVICE_PRESETS,
  BROWSER_ZOOM_MAX,
  BROWSER_ZOOM_MIN,
  findBrowserDevicePreset,
  stepBrowserZoom,
  type BrowserDevicePreset,
  type BrowserDevicePresetId,
  type BrowserViewportState,
} from "./browserViewportPresets";

export type BrowserColorScheme = "system" | "light" | "dark";

export interface BrowserViewportChange {
  devicePreset: BrowserDevicePresetId;
  customWidth?: number | null;
  customHeight?: number | null;
  landscape?: boolean;
}

export interface BrowserViewPanelProps {
  viewport: BrowserViewportState;
  onViewportChange: (change: BrowserViewportChange) => void;
  zoomFactor: number;
  onZoomChange: (zoomFactor: number) => void;
  colorScheme: BrowserColorScheme;
  onColorSchemeChange: (colorScheme: BrowserColorScheme) => void;
  audioMuted: boolean;
  onAudioMutedChange: (muted: boolean) => void;
  pictureInPicture: boolean;
  onTogglePictureInPicture: () => void;
  profileLabel: string;
  /** Rendered in the footer, e.g. the history and site-data menu. */
  footer?: ReactNode;
  /**
   * Called after a choice whose result the user needs to see. The native page
   * sits under this panel, so the panel gets out of the way.
   */
  onRequestClose?: () => void;
}

const DEVICE_ICONS: Record<BrowserDevicePreset["kind"], typeof SmartphoneIcon> = {
  fit: MaximizeIcon,
  phone: SmartphoneIcon,
  tablet: TabletIcon,
  laptop: LaptopIcon,
  desktop: MonitorIcon,
  custom: RulerIcon,
};

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-0.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground/80 uppercase">
      {children}
    </div>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="text-xs text-foreground/90">{label}</span>
      {children}
    </div>
  );
}

function parseDimension(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (value.trim().length === 0 || Number.isNaN(parsed) || parsed <= 0) return null;
  return Math.min(parsed, 8192);
}

export function BrowserViewPanel(props: BrowserViewPanelProps) {
  const selected = findBrowserDevicePreset(props.viewport.devicePreset);
  const isCustom = selected.id === "custom";
  const canRotate = selected.id !== "project-default";
  const landscape = props.viewport.landscape ?? false;
  const [widthDraft, setWidthDraft] = useState(String(props.viewport.customWidth ?? ""));
  const [heightDraft, setHeightDraft] = useState(String(props.viewport.customHeight ?? ""));

  useEffect(() => {
    setWidthDraft(String(props.viewport.customWidth ?? ""));
    setHeightDraft(String(props.viewport.customHeight ?? ""));
  }, [props.viewport.customWidth, props.viewport.customHeight]);

  const selectDevice = (preset: BrowserDevicePreset) => {
    if (preset.id === selected.id && !isCustom) {
      props.onRequestClose?.();
      return;
    }
    props.onViewportChange({ devicePreset: preset.id, landscape });
    // Custom keeps the panel open for the size fields; every other device is
    // a finished choice the user wants to look at.
    if (preset.id !== "custom") props.onRequestClose?.();
  };

  const commitCustomSize = () => {
    props.onViewportChange({
      devicePreset: "custom",
      customWidth: parseDimension(widthDraft),
      customHeight: parseDimension(heightDraft),
    });
  };

  const zoomPercent = Math.round(props.zoomFactor * 100);

  return (
    <div className="flex flex-col gap-3" data-testid="browser-view-panel">
      <section className="flex flex-col gap-2" aria-label="Device">
        <div className="flex items-center justify-between">
          <SectionLabel>Device</SectionLabel>
          <div
            className="flex items-center rounded-full border border-border/70 bg-muted/40 p-0.5"
            role="radiogroup"
            aria-label="Orientation"
          >
            {(
              [
                { value: false, label: "Portrait", Icon: RectangleVerticalIcon },
                { value: true, label: "Landscape", Icon: RectangleHorizontalIcon },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={landscape === value}
                aria-label={label}
                title={canRotate ? label : "Pick a device to rotate it"}
                disabled={!canRotate}
                onClick={() => {
                  if (landscape === value) return;
                  props.onViewportChange({ devicePreset: selected.id, landscape: value });
                  if (!isCustom) props.onRequestClose?.();
                }}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors",
                  "hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  landscape === value && canRotate && "bg-background text-foreground shadow-xs",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Device size">
          {BROWSER_DEVICE_PRESETS.map((preset) => {
            const Icon = DEVICE_ICONS[preset.kind];
            const active = preset.id === selected.id;
            const dims =
              preset.width && preset.height
                ? landscape
                  ? `${preset.height} × ${preset.width}`
                  : `${preset.width} × ${preset.height}`
                : preset.id === "project-default"
                  ? "Fill the pane"
                  : "Any size";
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectDevice(preset)}
                className={cn(
                  "group flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-[background-color,border-color,box-shadow]",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  active
                    ? "border-primary/60 bg-primary/8 shadow-[inset_0_0_0_1px_var(--primary)]/20"
                    : "border-border/60 bg-card/40 hover:border-border hover:bg-accent/50",
                  preset.id === "custom" && "col-span-2",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    preset.kind === "phone" && landscape && "rotate-90",
                    preset.kind === "tablet" && landscape && "rotate-90",
                  )}
                />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-xs font-medium text-foreground">
                    {preset.label}
                  </span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground tabular-nums">
                    {dims}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {isCustom ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              commitCustomSize();
              props.onRequestClose?.();
            }}
          >
            <Input
              className="h-7 min-w-0 flex-1 font-mono text-xs tabular-nums"
              inputMode="numeric"
              aria-label="Custom width"
              placeholder="Width"
              value={widthDraft}
              onChange={(event) => setWidthDraft(event.target.value)}
              onBlur={commitCustomSize}
            />
            <span className="text-xs text-muted-foreground">×</span>
            <Input
              className="h-7 min-w-0 flex-1 font-mono text-xs tabular-nums"
              inputMode="numeric"
              aria-label="Custom height"
              placeholder="Height"
              value={heightDraft}
              onChange={(event) => setHeightDraft(event.target.value)}
              onBlur={commitCustomSize}
            />
            <button
              type="submit"
              className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Apply
            </button>
          </form>
        ) : null}
      </section>

      <div className="h-px bg-border/60" />

      <section className="flex flex-col gap-1" aria-label="Display">
        <SectionLabel>Display</SectionLabel>
        <Row label="Zoom">
          <div className="flex items-center rounded-full border border-border/70 bg-muted/40 p-0.5">
            <button
              type="button"
              aria-label="Zoom browser out"
              disabled={props.zoomFactor <= BROWSER_ZOOM_MIN + 0.001}
              onClick={() => props.onZoomChange(stepBrowserZoom(props.zoomFactor, -1))}
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <MinusIcon className="size-3" />
            </button>
            <button
              type="button"
              title="Reset to 100%"
              aria-label={`Zoom ${zoomPercent}%, reset to 100%`}
              onClick={() => props.onZoomChange(1)}
              className={cn(
                "min-w-12 rounded-full px-1 text-center font-mono text-[11px] tabular-nums hover:text-foreground",
                zoomPercent === 100 ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {zoomPercent}%
            </button>
            <button
              type="button"
              aria-label="Zoom browser in"
              disabled={props.zoomFactor >= BROWSER_ZOOM_MAX - 0.001}
              onClick={() => props.onZoomChange(stepBrowserZoom(props.zoomFactor, 1))}
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <PlusIcon className="size-3" />
            </button>
          </div>
        </Row>
        <Row label="Appearance">
          <SegmentedControl
            size="sm"
            aria-label="Page color scheme"
            orbitKind="theme"
            value={props.colorScheme}
            onValueChange={props.onColorSchemeChange}
            options={[
              { value: "system", label: "Auto" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Row>
      </section>

      <div className="h-px bg-border/60" />

      <section className="flex flex-col gap-1" aria-label="Page">
        <SectionLabel>Page</SectionLabel>
        <Row
          label={
            <span className="flex items-center gap-2">
              {props.audioMuted ? (
                <VolumeXIcon className="size-3.5 text-muted-foreground" />
              ) : (
                <Volume2Icon className="size-3.5 text-muted-foreground" />
              )}
              Mute audio
            </span>
          }
        >
          <Switch
            aria-label="Mute audio"
            checked={props.audioMuted}
            onCheckedChange={(checked) => props.onAudioMutedChange(checked)}
          />
        </Row>
        <Row
          label={
            <span className="flex items-center gap-2">
              <PictureInPicture2Icon className="size-3.5 text-muted-foreground" />
              Pop out page
            </span>
          }
        >
          <Switch
            aria-label="Pop out page"
            checked={props.pictureInPicture}
            onCheckedChange={() => {
              props.onTogglePictureInPicture();
              props.onRequestClose?.();
            }}
          />
        </Row>
      </section>

      <div className="-mx-3 -mb-3 flex items-center justify-between gap-2 rounded-b-[inherit] border-t border-border/60 bg-muted/30 px-3 py-2">
        <span
          className="min-w-0 truncate text-[11px] text-muted-foreground"
          title={props.profileLabel}
        >
          Profile · <span className="text-foreground/80">{props.profileLabel}</span>
        </span>
        {props.footer}
      </div>
    </div>
  );
}
