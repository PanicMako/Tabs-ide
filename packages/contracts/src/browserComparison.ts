export interface BrowserComparisonPane {
  url: string;
  profileId: string;
  viewport: { width: number; height: number };
  bounds: { x: number; y: number; width: number; height: number };
}
export interface BrowserComparisonInput {
  projectId: string;
  comparisonId: string;
  sourceSessionId?: string | undefined;
  panes: [BrowserComparisonPane, BrowserComparisonPane];
  syncNavigation: boolean;
  syncScroll: boolean;
}
