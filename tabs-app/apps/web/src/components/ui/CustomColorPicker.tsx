import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Pipette, X } from "lucide-react";
import { toHexColor } from "@tabs/shared/themeDerivation";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "./popover";
import { SegmentedControl } from "./segmented-control";

interface CustomColorPickerProps {
  label: string;
  description: string;
  value: string;
  onChange: (hex: string) => void;
}

type ColorMode = "hex" | "rgb" | "hsl";

const SWATCH_PALETTE = [
  "#0f172a", // Slate 900
  "#1e293b", // Slate 800
  "#334155", // Slate 700
  "#09090b", // Zinc 950
  "#18181b", // Zinc 900
  "#27272a", // Zinc 800
  "#1d4ed8", // Royal Blue
  "#2563eb", // Blue 600
  "#38bdf8", // Sky Blue
  "#6366f1", // Indigo 500
  "#8b5cf6", // Purple 500
  "#a855f7", // Violet 500
  "#ec4899", // Pink 500
  "#f43f5e", // Rose 500
  "#ef4444", // Red 500
  "#f97316", // Orange 500
  "#eab308", // Yellow 500
  "#10b981", // Emerald 500
  "#06b6d4", // Cyan 500
  "#f8fafc", // White
  "#e2e8f0", // Slate 200
  "#94a3b8", // Slate 400
];

function hexToRgb(hexStr: string): { r: number; g: number; b: number } {
  const norm = toHexColor(hexStr).replace("#", "");
  return {
    r: parseInt(norm.substring(0, 2), 16) || 0,
    g: parseInt(norm.substring(2, 4), 16) || 0,
    b: parseInt(norm.substring(4, 6), 16) || 0,
  };
}

function hexToHsv(hexStr: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hexStr);
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;

  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rN:
        h = (gN - bN) / d + (gN < bN ? 6 : 0);
        break;
      case gN:
        h = (bN - rN) / d + 2;
        break;
      case bN:
        h = (rN - gN) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}

function hsvToHex(h: number, s: number, v: number): string {
  const hNorm = (h % 360) / 360;
  const sNorm = Math.max(0, Math.min(100, s)) / 100;
  const vNorm = Math.max(0, Math.min(100, v)) / 100;

  let r = 0,
    g = 0,
    b = 0;

  const i = Math.floor(hNorm * 6);
  const f = hNorm * 6 - i;
  const p = vNorm * (1 - sNorm);
  const q = vNorm * (1 - f * sNorm);
  const t = vNorm * (1 - (1 - f) * sNorm);

  switch (i % 6) {
    case 0:
      r = vNorm;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = vNorm;
      b = p;
      break;
    case 2:
      r = p;
      g = vNorm;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = vNorm;
      break;
    case 4:
      r = t;
      g = p;
      b = vNorm;
      break;
    case 5:
      r = vNorm;
      g = p;
      b = q;
      break;
  }

  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function formatColorString(hexStr: string, mode: ColorMode): string {
  const cleanHex = toHexColor(hexStr);
  if (mode === "rgb") {
    const { r, g, b } = hexToRgb(cleanHex);
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (mode === "hsl") {
    const { h, s, v } = hexToHsv(cleanHex);
    const l = (v / 100) * (1 - s / 100 / 2);
    const sHsl = l === 0 || l === 1 ? 0 : (v / 100 - l) / Math.min(l, 1 - l);
    return `hsl(${h}, ${Math.round(sHsl * 100)}%, ${Math.round(l * 100)}%)`;
  }
  return cleanHex.toUpperCase();
}

export const CustomColorPicker: React.FC<CustomColorPickerProps> = ({
  label,
  description,
  value,
  onChange,
}) => {
  const [showSwatches, setShowSwatches] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>("hex");
  const [inputVal, setInputVal] = useState(value);
  const [copied, setCopied] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv(value));

  const satCanvasRef = useRef<HTMLDivElement>(null);
  const hueSliderRef = useRef<HTMLDivElement>(null);
  const isDraggingSat = useRef(false);
  const isDraggingHue = useRef(false);

  useEffect(() => {
    setInputVal(formatColorString(value, colorMode));
    setHsv(hexToHsv(value));
  }, [value, colorMode]);

  const updateSatValFromMouse = (e: MouseEvent | React.MouseEvent) => {
    if (!satCanvasRef.current) return;
    const rect = satCanvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const s = Math.round((x / rect.width) * 100);
    const v = Math.round((1 - y / rect.height) * 100);

    const nextHsv = { ...hsv, s, v };
    setHsv(nextHsv);
    const hex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v);
    setInputVal(formatColorString(hex, colorMode));
    onChange(hex);
  };

  const updateHueFromMouse = (e: MouseEvent | React.MouseEvent) => {
    if (!hueSliderRef.current) return;
    const rect = hueSliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const h = Math.round((x / rect.width) * 360);

    const nextHsv = { ...hsv, h };
    setHsv(nextHsv);
    const hex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v);
    setInputVal(formatColorString(hex, colorMode));
    onChange(hex);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSat.current) {
        updateSatValFromMouse(e);
      } else if (isDraggingHue.current) {
        updateHueFromMouse(e);
      }
    };

    const handleMouseUp = () => {
      isDraggingSat.current = false;
      isDraggingHue.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [hsv, colorMode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInputVal(raw);
    if (/^#?[0-9A-Fa-f]{6}$/.test(raw.trim())) {
      const cleanHex = toHexColor(raw);
      onChange(cleanHex);
      setHsv(hexToHsv(cleanHex));
    }
  };

  const handleCopyValue = () => {
    navigator.clipboard.writeText(formatColorString(value, colorMode));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleEyedropper = async () => {
    if ("EyeDropper" in window) {
      try {
        // @ts-expect-error EyeDropper API is native in modern chromium/electron
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) {
          const cleanHex = toHexColor(result.sRGBHex);
          onChange(cleanHex);
          setInputVal(formatColorString(cleanHex, colorMode));
          setHsv(hexToHsv(cleanHex));
        }
      } catch {
        // Ignore eyedropper cancellation
      }
    }
  };

  const pureHueHex = hsvToHex(hsv.h, 100, 100);
  const visibleSwatches = showSwatches ? SWATCH_PALETTE : SWATCH_PALETTE.slice(0, 6);

  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </div>
      <Popover>
        <PopoverTrigger
          aria-label={`Edit ${label.toLowerCase()} color, ${value.toUpperCase()}`}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span
            aria-hidden="true"
            className="size-5 rounded-full border border-foreground/20"
            style={{ backgroundColor: value }}
          />
          <span className="min-w-[8ch] text-left font-mono text-xs">{value.toUpperCase()}</span>
        </PopoverTrigger>

        <PopoverPopup align="end" className="w-76 max-w-(--available-width) select-none">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/60 pb-2.5">
            <PopoverTitle>{label}</PopoverTitle>
            <SegmentedControl
              size="sm"
              value={colorMode}
              onValueChange={setColorMode}
              options={[
                { value: "hex", label: "HEX" },
                { value: "rgb", label: "RGB" },
                { value: "hsl", label: "HSL" },
              ]}
              className="p-0.5"
              itemClassName="px-2 py-0.5 text-[10px] uppercase"
              aria-label="Color mode"
            />

            <PopoverClose
              aria-label="Close color picker"
              className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </PopoverClose>
          </div>

          {/* 1. 2D Saturation / Value Canvas */}
          <div className="pt-3">
            <div
              ref={satCanvasRef}
              onMouseDown={(e) => {
                isDraggingSat.current = true;
                updateSatValFromMouse(e);
              }}
              className="relative h-32 w-full rounded-xl cursor-crosshair overflow-hidden border border-border/70 shadow-inner"
              style={{
                backgroundColor: pureHueHex,
                backgroundImage:
                  "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
              }}
            >
              <div
                className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_10px_rgba(0,0,0,0.5)] pointer-events-none ring-2 ring-black/40 transition-transform"
                style={{
                  left: `${hsv.s}%`,
                  top: `${100 - hsv.v}%`,
                  backgroundColor: value,
                }}
              />
            </div>
          </div>

          {/* 2. Spectrum Hue Slider Rail */}
          <div className="py-2.5">
            <div
              ref={hueSliderRef}
              onMouseDown={(e) => {
                isDraggingHue.current = true;
                updateHueFromMouse(e);
              }}
              className="relative h-3.5 w-full rounded-full cursor-pointer border border-border/70 shadow-inner"
              style={{
                background:
                  "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
              }}
            >
              <div
                className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md pointer-events-none ring-2 ring-black/40"
                style={{
                  left: `${(hsv.h / 360) * 100}%`,
                  backgroundColor: pureHueHex,
                }}
              />
            </div>
          </div>

          {/* 3. Collapsible Swatch Strip */}
          <div className="py-2 border-t border-border/60">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Swatches
              </span>
              <button
                type="button"
                onClick={() => setShowSwatches(!showSwatches)}
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <span>{showSwatches ? "Less" : "More"}</span>
                {showSwatches ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
              </button>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {visibleSwatches.map((swatchHex) => {
                const isSelected = value.toLowerCase() === swatchHex.toLowerCase();
                return (
                  <button
                    key={swatchHex}
                    type="button"
                    title={swatchHex}
                    onClick={() => {
                      onChange(swatchHex);
                      setInputVal(formatColorString(swatchHex, colorMode));
                      setHsv(hexToHsv(swatchHex));
                    }}
                    className={`size-7.5 rounded-lg border transition-all cursor-pointer relative shadow-xs ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/50 scale-105 z-10"
                        : "border-border/60 hover:scale-105 hover:border-foreground/40"
                    }`}
                    style={{ backgroundColor: swatchHex }}
                  >
                    {isSelected && (
                      <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow-md">
                        <Check className="size-3 stroke-[3]" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Format Input Field & Eyedropper */}
          <div className="pt-2 border-t border-border/60">
            <div className="flex items-center gap-1.5">
              <div
                className="size-8.5 rounded-xl border border-border/80 shrink-0 shadow-inner"
                style={{ backgroundColor: value }}
              />
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={inputVal}
                  onChange={handleInputChange}
                  aria-label={`${label} color value`}
                  placeholder="#000000"
                  className="w-full font-mono text-xs font-semibold h-8.5 px-2.5 rounded-xl bg-background border border-border/80 text-foreground uppercase tracking-wider focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {"EyeDropper" in window && (
                <button
                  type="button"
                  onClick={handleEyedropper}
                  title="Pick Color from Screen"
                  className="flex size-8.5 items-center justify-center rounded-xl border border-border/80 bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                >
                  <Pipette className="size-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyValue}
                title="Copy Color String"
                className="flex size-8.5 items-center justify-center rounded-xl border border-border/80 bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
              >
                {copied ? (
                  <Check className="size-3.5 text-emerald-400" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
};
