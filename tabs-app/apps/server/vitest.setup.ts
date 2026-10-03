// Polyfill navigator for modules like @pierre/diffs that access
// navigator.userAgent at import time (e.g. for browser detection).
if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "node" },
  });
}
