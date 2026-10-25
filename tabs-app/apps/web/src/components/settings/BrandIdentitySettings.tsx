import { TABS_LOGO_VARIANTS } from "@tabs/shared/tabsBrand";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useResolvedBrandVariant } from "../../hooks/useDesktopIconTheme";
import { TabsBrandMark } from "../TabsBrandMark";
import { SettingsSection } from "./SettingsLayout";

export function BrandIdentitySettings() {
  const { desktopIconTheme } = useSettings();
  const { updateSettings } = useUpdateSettings();
  const selected = useResolvedBrandVariant();
  return (
    <SettingsSection title="Tabs identity">
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          One mascot, five finishes. Choose a custom treatment for the app icon, or use System,
          Light or Dark in General settings.
        </p>
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
          role="group"
          aria-label="Tabs logo treatment"
        >
          {TABS_LOGO_VARIANTS.map((variant) => (
            <button
              key={variant.id}
              type="button"
              aria-pressed={desktopIconTheme === variant.id}
              aria-label={`Use ${variant.name}`}
              onClick={() => updateSettings({ desktopIconTheme: variant.id })}
              className={`flex min-w-0 flex-col items-center gap-3 rounded-2xl border p-4 text-center text-xs transition-colors ${selected === variant.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
            >
              <TabsBrandMark variant={variant.id} className="size-16" />
              <span>{variant.name}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Packaged installers use Blueprint. Your choice changes the running app’s icon and browser
          branding.
        </p>
      </div>
    </SettingsSection>
  );
}
