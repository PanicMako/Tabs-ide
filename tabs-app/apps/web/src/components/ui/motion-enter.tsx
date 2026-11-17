import type { ComponentProps } from "react";
import { useGsapEnter } from "~/hooks/useGsapSurface";
import type { SurfacePreset } from "~/lib/motion";

/**
 * A `div` that plays the active motion style's entrance whenever React mounts it. For panels,
 * banners and menus that appear conditionally without a Base UI primitive. Give it a `key` when
 * it swaps between different contents, so each one enters on its own.
 */
export function MotionEnter({
  preset = "panel",
  ref,
  ...props
}: ComponentProps<"div"> & { preset?: SurfacePreset }) {
  const motionRef = useGsapEnter<HTMLDivElement>(preset, ref);
  return <div {...props} ref={motionRef} />;
}
