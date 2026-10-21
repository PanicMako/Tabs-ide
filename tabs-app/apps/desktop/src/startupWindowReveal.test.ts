import { expect, it, vi } from "vitest";
import { createStartupWindowReveal } from "./startupWindowReveal";

it.each([true, false])("reveals one populated frame with content-first=%s", (contentFirst) => {
  const show = vi.fn();
  const reveal = createStartupWindowReveal(show);
  (contentFirst ? reveal.contentReady : reveal.frameReady)();
  expect(show).not.toHaveBeenCalled();
  (contentFirst ? reveal.frameReady : reveal.contentReady)();
  expect(show).toHaveBeenCalledOnce();
  reveal.contentReady();
  reveal.frameReady();
  expect(show).toHaveBeenCalledOnce();
});
