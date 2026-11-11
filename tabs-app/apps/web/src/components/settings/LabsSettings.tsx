import { lazy, Suspense, useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { TabsExtensionIcon } from "../Icons";
import { useSettingsLabsStore } from "../../stores/settingsLabsStore";
import { useTheme } from "../../hooks/useTheme";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SegmentedControl } from "../ui/segmented-control";
import { SettingsSection, SettingsRow, SettingsSectionHeader } from "./SettingsLayout";
import { SettingsLoadingState } from "./SettingsLoadingState";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";

const REST_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "30", label: "30 min" },
  { value: "120", label: "2 hr" },
  { value: "480", label: "8 hr" },
  { value: "1440", label: "1 day" },
  { value: "10080", label: "1 week" },
] as const;
import {
  getInitialAgentWallpaper,
  getIsAgentWallpaperEnabled,
  AGENT_WALLPAPER_CHANGE_EVENT,
} from "../onboarding/wallpapers";
const ExtensionsSettings = lazy(() => import("./ExtensionsSettings"));
const WallpaperSettings = lazy(() => import("./WallpaperSettings"));

export default function LabsSettings() {
  const editorial = useSettingsLabsStore((state) => state.editorialSettings);
  const settingsOnly = useSettingsLabsStore((state) => state.editorialSettingsOnly);
  const setSettingsOnly = useSettingsLabsStore((state) => state.setEditorialSettingsOnly);
  const setEditorial = useSettingsLabsStore((state) => state.setEditorialSettings);
  const appearance = useSettingsLabsStore((state) => state.editorialAppearance);
  const setAppearance = useSettingsLabsStore((state) => state.setEditorialAppearance);
  const { resolvedTheme } = useTheme();
  const restAfterMinutes = useSettings((settings) => settings.browserRestAfterMinutes);
  // Show the closest choice if a value was saved by an earlier build.
  const restValue =
    restAfterMinutes > 0
      ? REST_OPTIONS.filter((option) => option.value !== "0").reduce((best, option) =>
          Math.abs(Number(option.value) - restAfterMinutes) <
          Math.abs(Number(best.value) - restAfterMinutes)
            ? option
            : best,
        ).value
      : "0";
  const { updateSettings } = useUpdateSettings();
  const [experiment, setExperiment] = useState<"wallpapers" | "extensions" | null>(null);

  useEffect(() => {
    if (editorial && settingsOnly && appearance !== resolvedTheme) {
      setAppearance(resolvedTheme);
    }
  }, [editorial, settingsOnly, appearance, resolvedTheme, setAppearance]);

  const [isWallpaperEnabled, setIsWallpaperEnabled] = useState(() => getIsAgentWallpaperEnabled());
  const [activeWallpaper, setActiveWallpaper] = useState(() => getInitialAgentWallpaper());

  useEffect(() => {
    const handleUpdate = () => {
      setIsWallpaperEnabled(getIsAgentWallpaperEnabled());
      setActiveWallpaper(getInitialAgentWallpaper());
    };
    window.addEventListener(AGENT_WALLPAPER_CHANGE_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(AGENT_WALLPAPER_CHANGE_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  if (experiment)
    return (
      <Suspense fallback={<SettingsLoadingState label={`Loading ${experiment}`} />}>
        {experiment === "wallpapers" ? (
          <WallpaperSettings onBack={() => setExperiment(null)} />
        ) : (
          <ExtensionsSettings onBack={() => setExperiment(null)} />
        )}
      </Suspense>
    );
  return (
    <div className="space-y-8">
      <SettingsSectionHeader title="Labs" description="Try what comes next." />
      <SettingsSection title="Experiments">
        <SettingsRow
          title="Interface study"
          description={
            settingsOnly
              ? "A separate appearance for Settings. Matches your workspace theme automatically."
              : "Try a new look across Tabs. Switch off to return to your theme."
          }
          control={
            <div className="flex items-center gap-3">
              {editorial &&
                (settingsOnly ? (
                  <span
                    data-slot="settings-study-theme-locked"
                    className="inline-flex items-center text-xs font-medium text-muted-foreground bg-muted/60 border border-border/60 rounded-full px-3 py-1 capitalize"
                  >
                    Matches theme ({resolvedTheme})
                  </span>
                ) : (
                  <SegmentedControl
                    size="sm"
                    itemRole="button"
                    value={appearance}
                    onValueChange={(val) => setAppearance(val as "dark" | "light")}
                    options={[
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" },
                    ]}
                    aria-label="Study appearance"
                  />
                ))}
              <Switch
                aria-label="Interface study"
                checked={editorial}
                onCheckedChange={setEditorial}
              />
            </div>
          }
        />
        {editorial && (
          <div
            data-slot="settings-study-scope"
            className="mx-3 mb-3 overflow-hidden rounded-xl border border-border/60 bg-muted/25"
          >
            <SettingsRow
              title="Settings page only"
              description="Keep this look in Settings. Your workspace keeps its saved theme and layout."
              control={
                <Switch
                  aria-label="Settings page only"
                  checked={settingsOnly}
                  onCheckedChange={(checked) => {
                    setSettingsOnly(checked);
                    if (checked && appearance !== resolvedTheme) {
                      setAppearance(resolvedTheme);
                    }
                  }}
                />
              }
            />
          </div>
        )}
      </SettingsSection>
      <SettingsSection title="Workspace experiments">
        <SettingsRow
          title="Agent wallpapers"
          description="Anime backgrounds with animated wave-halftone particles, dual light/dark mode blending, and per-thread overrides."
          status={
            isWallpaperEnabled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500 border border-emerald-500/30">
                Enabled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground border border-border/50">
                Disabled
              </span>
            )
          }
          control={
            <div className="flex items-center gap-3">
              {isWallpaperEnabled && activeWallpaper && (
                <div
                  className="relative h-7 w-12 overflow-hidden rounded-md border border-border shadow-xs shrink-0 hidden sm:block"
                  title={`Active: ${activeWallpaper.label}`}
                >
                  <img
                    src={activeWallpaper.url}
                    alt={activeWallpaper.label}
                    className="size-full object-cover"
                  />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExperiment("wallpapers")}
                className="gap-2 cursor-pointer"
              >
                <ImageIcon className="size-3.5" />
                <span>Explore wallpapers</span>
              </Button>
            </div>
          }
        />
        <SettingsRow
          title="Rest idle project browsers"
          description="Projects you have not looked at for a while give back their browser's memory, from half an hour up to a week. The page returns to where it was when you switch back. Popped-out, recording and agent-controlled pages are never rested."
          control={
            <Select
              value={restValue}
              onValueChange={(value) => {
                if (value !== null) void updateSettings({ browserRestAfterMinutes: Number(value) });
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Rest idle project browsers after"
                className="min-w-28"
              >
                {REST_OPTIONS.find((option) => option.value === restValue)?.label ?? "Off"}
              </SelectTrigger>
              <SelectPopup align="end">
                {REST_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.value === "0" ? "Off" : `After ${option.label}`}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Extensions & Exchange"
          description="Explore extensions, tool views, and profiles."
          control={
            <Button variant="outline" size="sm" onClick={() => setExperiment("extensions")}>
              <TabsExtensionIcon className="size-3.5 mr-2" />
              Explore extensions
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
