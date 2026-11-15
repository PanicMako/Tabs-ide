import { create } from "zustand";

/**
 * What the Look pane in workspace actions needs from the wallpaper layer. The
 * layer (AgentBackground) owns the wallpaper state and publishes it here, so the
 * controls can live in the workspace card without prop-drilling through the chat.
 */
export interface WallpaperControls {
  readonly enabled: boolean;
  readonly label: string;
  readonly url: string;
  /** A thread or project has its own wallpaper, so "use shared" is offered. */
  readonly overridden: boolean;
  readonly openGallery: () => void;
  readonly shuffle: () => void;
  readonly step: (direction: 1 | -1) => void;
  readonly resetOverride: () => void;
  readonly setEnabled: (enabled: boolean) => void;
}

export const useWallpaperControlsStore = create<{
  controls: WallpaperControls | null;
  publish: (controls: WallpaperControls | null) => void;
}>((set) => ({
  controls: null,
  publish: (controls) => set({ controls }),
}));
