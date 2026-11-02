import { useRef } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useNativeSurfaceOverlaySuspension } from "../nativeSurfaceOverlay";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

it("keeps decoded native pixels behind the overlay before hiding and discards late captures", async () => {
  let resolveCapture!: (value: string | null) => void;
  const capture = vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        resolveCapture = resolve;
      }),
  );
  const host = { current: null as HTMLDivElement | null };
  const suspend = vi.fn(() => {
    expect(host.current?.querySelector("img")?.getAttribute("src")).toBe(pixel);
  });
  let finishResume!: () => void;
  const resume = vi.fn().mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishResume = resolve;
      }),
  );
  function Fixture() {
    const ref = useRef<HTMLDivElement>(null);
    useNativeSurfaceOverlaySuspension({
      enabled: true,
      surfaceReady: true,
      onSuspend: suspend,
      onResume: resume,
      captureBackdrop: capture,
      backdropHost: ref,
      debounceMs: 0,
    });
    return (
      <div
        ref={(element) => {
          ref.current = element;
          host.current = element;
        }}
      />
    );
  }
  const view = await render(<Fixture />);
  const overlay = document.createElement("div");
  overlay.dataset.slot = "quick-actions-overlay";
  document.body.append(overlay);
  await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  expect(suspend).not.toHaveBeenCalled();
  resolveCapture(pixel);
  await vi.waitFor(() => expect(suspend).toHaveBeenCalledOnce());
  expect(host.current?.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
  overlay.remove();
  await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
  expect(host.current?.querySelector("img")).not.toBeNull();
  finishResume();
  await vi.waitFor(() => expect(host.current?.querySelector("img")).toBeNull());

  document.body.append(overlay);
  await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
  overlay.remove();
  await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
  resolveCapture(pixel);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(suspend).toHaveBeenCalledOnce();
  expect(host.current?.querySelector("img")).toBeNull();
  await view.unmount();
});
