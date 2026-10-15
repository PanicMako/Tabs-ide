import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeftIcon, ImageIcon, PuzzleIcon } from "lucide-react";
import { useSettingsLabsStore } from "../../stores/settingsLabsStore";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SegmentedControl } from "../ui/segmented-control";
import { SettingsSection, SettingsRow, SettingsSectionHeader } from "./SettingsLayout";
import { SettingsLoadingState } from "./SettingsLoadingState";
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
  const [experiment, setExperiment] = useState<"wallpapers" | "extensions" | null>(null);

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
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => setExperiment(null)}>
          <ArrowLeftIcon className="size-3.5 mr-2" />
          Back to Labs
        </Button>
        <Suspense fallback={<SettingsLoadingState label={`Loading ${experiment}`} />}>
          {experiment === "wallpapers" ? <WallpaperSettings /> : <ExtensionsSettings />}
        </Suspense>
      </div>
    );
  return (
    <div className="space-y-8">
      <SettingsSectionHeader title="Labs" description="Try what comes next." />
      <SettingsSection title="Experiments">
        <SettingsRow
          title="Interface study"
          description="Try a new look across Tabs. Switch off to return to your theme."
          control={
            <div className="flex items-center gap-3">
              {editorial && (
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
              )}
              <Switch
                aria-label="Interface study"
                checked={editorial}
                onCheckedChange={setEditorial}
              />
            </div>
          }
        />
        {editorial && (
          <div className="ml-4 border-l border-border pl-4">
            <SettingsRow
              title="Settings page only"
              description="Keep this look in Settings. Your workspace keeps its saved theme and layout."
              control={
                <Switch
                  aria-label="Settings page only"
                  checked={settingsOnly}
                  onCheckedChange={setSettingsOnly}
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
          title="Extensions & Exchange"
          description="Explore extensions, tool views, and profiles."
          control={
            <Button variant="outline" size="sm" onClick={() => setExperiment("extensions")}>
              <PuzzleIcon className="size-3.5 mr-2" />
              Explore extensions
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
