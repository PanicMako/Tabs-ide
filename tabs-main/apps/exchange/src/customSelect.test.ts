import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { enhanceSelect } from "../frontend/src/lib/customSelect";
let cleanup: (() => void) | undefined;
let dom: Window;
beforeEach(() => {
  dom = new Window();
  for (const name of [
    "document",
    "HTMLElement",
    "HTMLOptGroupElement",
    "MutationObserver",
    "Event",
    "KeyboardEvent",
    "FormData",
    "AbortController",
  ] as const)
    vi.stubGlobal(name, dom[name]);
});
afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await dom.happyDOM.close();
  vi.unstubAllGlobals();
});
function fixture() {
  document.body.innerHTML =
    '<form><fieldset><label for="test-select">Sort</label><select id="test-select" name="sort"><option value="a">Alpha</option><option value="b" disabled>Beta</option><option value="c">Charlie</option></select></fieldset></form>';
  const source = document.querySelector("select")!;
  cleanup = enhanceSelect(source);
  const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  return {
    source,
    trigger,
    key: (key: string) =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
  };
}
it("commits keyboard selection to the form and emits one change", () => {
  const { source, trigger, key } = fixture();
  const change = vi.fn();
  source.addEventListener("change", change);
  trigger.focus();
  key("ArrowDown");
  expect(trigger.getAttribute("aria-activedescendant")).toBe("test-select-options-2");
  key("Enter");
  expect(source.value).toBe("c");
  expect(new FormData(source.form!).get("sort")).toBe("c");
  expect(change).toHaveBeenCalledTimes(1);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});
it("cancels navigation with Escape without changing the selected value", () => {
  const { source, trigger, key } = fixture();
  key("ArrowDown");
  key("Escape");
  expect(source.value).toBe("a");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
it("synchronizes programmatic values and asynchronously loaded options", async () => {
  const { source, trigger } = fixture();
  source.value = "c";
  source.dispatchEvent(new Event("tabs-select-sync"));
  expect(trigger.textContent).toBe("Charlie");
  const option = document.createElement("option");
  option.textContent = "Delta";
  option.value = "d";
  source.add(option);
  await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(4));
  document.querySelector<HTMLElement>('[data-index="3"]')!.click();
  expect(source.value).toBe("d");
});
it("announces validation errors and focuses the visible control", () => {
  const { source, trigger } = fixture();
  source.required = true;
  source.value = "";
  source.dispatchEvent(new Event("invalid", { cancelable: true }));
  expect(trigger.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(trigger);
  expect(document.querySelector<HTMLElement>('[role="alert"]')!.hidden).toBe(false);
});
it("honors disabled controls and disconnects observers when disposed", async () => {
  const { source, trigger } = fixture();
  source.disabled = true;
  await vi.waitFor(() => expect(trigger.disabled).toBe(true));
  cleanup!();
  cleanup = undefined;
  expect(source.hidden).toBe(false);
  source.add(document.createElement("option"));
  await Promise.resolve();
  expect(document.querySelector('[role="combobox"]')).toBeNull();
});
