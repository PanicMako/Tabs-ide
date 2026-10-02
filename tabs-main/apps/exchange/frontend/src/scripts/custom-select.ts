import { enhanceSelect } from "../lib/customSelect";
const controls = new Map<HTMLSelectElement, () => void>();
const reconcile = () => {
  for (const [source, cleanup] of controls) {
    if (!source.isConnected) {
      cleanup();
      controls.delete(source);
    }
  }
  for (const source of document.querySelectorAll<HTMLSelectElement>("select[id]")) {
    if (!controls.has(source)) controls.set(source, enhanceSelect(source));
  }
};
const observer = new MutationObserver(reconcile);
const setup = () => {
  reconcile();
  observer.observe(document.body, { childList: true, subtree: true });
};
setup();
window.addEventListener("pagehide", () => {
  observer.disconnect();
  controls.forEach((cleanup) => cleanup());
  controls.clear();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) setup();
});
