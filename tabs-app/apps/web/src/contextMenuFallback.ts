import type { ContextMenuItem } from "@tabs/contracts";

/**
 * Imperative entry point for context menus. The themed menu is rendered by
 * `ContextMenuHost` (components/ui), which registers itself here; the promise resolves with
 * the chosen item id, or null when dismissed. This replaces the operating system's native
 * menu everywhere, including in the desktop app.
 */
export interface ContextMenuRequest {
  readonly items: readonly ContextMenuItem<string>[];
  readonly position: { x: number; y: number };
  readonly resolve: (id: string | null) => void;
}

type ContextMenuPresenter = (request: ContextMenuRequest) => void;

let presenter: ContextMenuPresenter | null = null;

export function registerContextMenuPresenter(next: ContextMenuPresenter): () => void {
  presenter = next;
  return () => {
    if (presenter === next) presenter = null;
  };
}

export function showContextMenuFallback<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    if (!presenter) {
      resolve(null);
      return;
    }
    presenter({
      items,
      position: position ?? { x: 0, y: 0 },
      resolve: (id) => resolve(id as T | null),
    });
  });
}
