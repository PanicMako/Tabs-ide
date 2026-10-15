import { Button } from "../ui/button";
import type { FontPreferences } from "../../lib/themes";
import {
  EDITOR_FONT_OPTIONS,
  MIXER_FONT_OPTIONS,
  prepareCustomFontPreferences,
} from "../../lib/themes";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function TypographyMixer({
  fonts,
  onChange,
  onSave,
}: {
  fonts: FontPreferences;
  onChange: (fonts: FontPreferences) => void;
  onSave?: () => void;
}) {
  const custom = prepareCustomFontPreferences(fonts);
  const roles = [
    {
      key: "uiFont",
      label: "Interface font",
      description: "Text inside cards, navigation and controls",
    },
    {
      key: "headingFont",
      label: "Page heading font",
      description: "Themes, General, About and other page titles",
    },
    {
      key: "sectionFont",
      label: "Section heading font",
      description: "Typography & Fonts, Application Details and section titles",
    },
    {
      key: "supportingFont",
      label: "Supporting text font",
      description: "Descriptions below page and section headings",
    },
    { key: "editorFont", label: "Editor font", description: "Code, terminals and diff views" },
  ] as const;
  return (
    <div className="mx-4 my-2 rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold text-foreground">Your typography mix</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Keep the interface from one pairing, the headline from another, and choose your own
            section voice.
          </p>
        </div>
        {onSave && (
          <Button type="button" variant="outline" size="sm" onClick={onSave}>
            Save this mix
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {roles.map(({ key, label, description }) => (
          <div key={key} className="space-y-2 rounded-lg border border-border/60 bg-card/60 p-3">
            <label htmlFor={`typography-${key}`} className="block text-xs font-semibold">
              {label}
            </label>
            <p className="min-h-7 text-[10px] leading-relaxed text-muted-foreground">
              {description}
            </p>
            <Select
              value={custom[key]}
              onValueChange={(value) => {
                if (value) onChange({ ...custom, [key]: value });
              }}
            >
              <SelectTrigger
                id={`typography-${key}`}
                aria-label={label}
                className="w-full text-xs rounded-lg bg-background"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectPopup align="start">
                {(key === "editorFont" ? EDITOR_FONT_OPTIONS : MIXER_FONT_OPTIONS).map((font) => (
                  <SelectItem key={font.value} value={font.value} className="text-xs">
                    <span style={{ fontFamily: font.value }}>{font.label}</span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
