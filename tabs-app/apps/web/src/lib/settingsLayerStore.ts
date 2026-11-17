import { create } from "zustand";

/**
 * Settings opened from inside the workspace is a layer over it rather than a route change.
 * Switching routes tore down the whole workspace (chat, timeline, editors, terminals) and built
 * Settings from scratch, then did the reverse on Back — half a second to a second of main-thread
 * work before anything could move. As a layer, the workspace stays mounted (hidden with React's
 * `<Activity>`), so Back is just showing it again, and Settings is kept too after its first open.
 *
 * The `/settings` route still exists for deep links and opens the same screen.
 */
export const useSettingsLayerStore = create<{
  open: boolean;
  /** The workspace that hosts the layer is on screen (not a popped-out window). */
  hosted: boolean;
  /** Settings has been opened at least once, so its layer stays mounted (hidden) from then on. */
  mounted: boolean;
  /** The page to show when it opens; null keeps the last page the user viewed. */
  section: string | null;
  openSettings: (section?: string | null) => void;
  setSection: (section: string) => void;
  close: () => void;
}>((set) => ({
  open: false,
  hosted: false,
  mounted: false,
  section: null,
  openSettings: (section = null) =>
    set((state) => ({ open: true, mounted: true, section: section ?? state.section })),
  setSection: (section) => set({ section }),
  close: () => set({ open: false }),
}));

export function openSettingsLayer(section?: string | null): void {
  useSettingsLayerStore.getState().openSettings(section);
}

export function closeSettingsLayer(): void {
  useSettingsLayerStore.getState().close();
}

/**
 * Opens Settings the fast way when the workspace is on screen (the layer), and through the
 * `/settings` route otherwise (a popped-out window has no workspace to layer over).
 */
export function goToSettings(
  navigate: (options: { to: "/settings"; search?: { section: string } }) => unknown,
  section?: string,
): void {
  if (useSettingsLayerStore.getState().hosted) {
    openSettingsLayer(section ?? null);
    return;
  }
  void navigate(section ? { to: "/settings", search: { section } } : { to: "/settings" });
}
