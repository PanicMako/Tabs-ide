import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "~/lib/utils";
import { useGsapSurface } from "~/hooks/useGsapSurface";

const PreviewCard = PreviewCardPrimitive.Root;

function PreviewCardTrigger(props: PreviewCardPrimitive.Trigger.Props) {
  return <PreviewCardPrimitive.Trigger data-slot="preview-card-trigger" {...props} />;
}

function PreviewCardPopup({
  className,
  align = "start",
  side = "top",
  sideOffset = 6,
  ...props
}: PreviewCardPrimitive.Popup.Props & {
  align?: PreviewCardPrimitive.Positioner.Props["align"];
  side?: PreviewCardPrimitive.Positioner.Props["side"];
  sideOffset?: PreviewCardPrimitive.Positioner.Props["sideOffset"];
}) {
  const motionRef = useGsapSurface(props.ref, "popover");
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        className="z-[140] max-w-(--available-width)"
        data-slot="preview-card-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          className={cn(
            "origin-(--transform-origin) rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none",
            className,
          )}
          data-slot="preview-card-popup"
          {...props}
          ref={motionRef}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { PreviewCard, PreviewCardPopup, PreviewCardTrigger };
