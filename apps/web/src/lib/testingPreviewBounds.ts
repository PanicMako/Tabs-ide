export interface TestingPreviewRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface TestingPreviewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}

export function clipTestingPreviewBounds(input: {
  readonly host: TestingPreviewRect;
  readonly viewport: TestingPreviewRect;
  readonly zoom: number;
}): TestingPreviewBounds {
  const visibleLeft = Math.max(input.host.left, input.viewport.left);
  const visibleTop = Math.max(input.host.top, input.viewport.top);
  const visibleRight = Math.min(input.host.right, input.viewport.right);
  const visibleBottom = Math.min(input.host.bottom, input.viewport.bottom);
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  return {
    x: Math.round(visibleLeft * input.zoom),
    y: Math.round(visibleTop * input.zoom),
    width: Math.round(visibleWidth * input.zoom),
    height: Math.round(visibleHeight * input.zoom),
    visible: visibleWidth > 1 && visibleHeight > 1,
  };
}
