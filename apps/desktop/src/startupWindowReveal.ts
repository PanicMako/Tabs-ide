/** A paintable empty document is not yet the application's first visible frame. */
export function createStartupWindowReveal(show: () => void) {
  let frameReady = false;
  let contentReady = false;
  let shown = false;
  const reveal = () => {
    if (!frameReady || !contentReady || shown) return;
    shown = true;
    show();
  };
  return {
    frameReady() {
      frameReady = true;
      reveal();
    },
    contentReady() {
      contentReady = true;
      reveal();
    },
  };
}
