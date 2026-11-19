/** The provider tab after (or before) the active one, wrapping around. Stays put with fewer than two. */
export function stepProviderTab<T extends string>(
  tabs: ReadonlyArray<T>,
  active: T | "pinned" | null,
  direction: 1 | -1,
): T | null {
  if (tabs.length < 2) return null;
  const index = active === null || active === "pinned" ? -1 : tabs.indexOf(active as T);
  if (index === -1) return direction === 1 ? tabs[0]! : tabs[tabs.length - 1]!;
  return tabs[(index + direction + tabs.length) % tabs.length]!;
}

/** The context the picker adds while it is open, so its keys never clash with the rest of the app. */
export const MODEL_PICKER_SHORTCUT_CONTEXT = {
  modelPickerOpen: true,
  terminalFocus: false,
  shellChromeFocus: false,
} as const;
