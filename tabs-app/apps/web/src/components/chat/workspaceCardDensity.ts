export type WorkspaceCardDensity = "full" | "compact" | "essential";

export interface ResolveWorkspaceCardDensityOptions {
  windowHeight: number;
  windowWidth: number;
  cardHeight?: number | undefined;
  isSplitActive?: boolean | undefined;
}

/**
 * Deterministic density rules for the Tabs workspace card.
 *
 * - "full": default when height >= 720px and width >= 1024px without split constraints.
 * - "compact": applied under split pane layout or medium heights (540px–719px).
 * - "essential": applied when height is short (< 540px) or highly constrained.
 */
export function resolveWorkspaceCardDensity({
  windowHeight,
  windowWidth,
  cardHeight,
  isSplitActive = false,
}: ResolveWorkspaceCardDensityOptions): WorkspaceCardDensity {
  if (windowHeight < 540 || (cardHeight !== undefined && cardHeight > 0 && cardHeight < 400)) {
    return "essential";
  }

  if (
    isSplitActive ||
    windowHeight < 720 ||
    windowWidth < 1024 ||
    (cardHeight !== undefined && cardHeight > 0 && cardHeight < 580)
  ) {
    return "compact";
  }

  return "full";
}
