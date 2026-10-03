"use client";

import { useGsapSurface } from "~/hooks/useGsapSurface";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "~/lib/utils";

const PopoverCreateHandle = PopoverPrimitive.createHandle;

const Popover = PopoverPrimitive.Root;

function PopoverTrigger({ className, children, ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger className={className} data-slot="popover-trigger" {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  );
}

function PopoverBackdrop({ className, ...props }: PopoverPrimitive.Backdrop.Props) {
  return (
    <PopoverPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-40 bg-black/50 backdrop-blur-[8px] transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="popover-backdrop"
      {...props}
    />
  );
}

function PopoverPopup({
  children,
  className,
  viewportClassName,
  side = "bottom",
  align = "center",
  sideOffset = 4,
  alignOffset = 0,
  tooltipStyle = false,
  anchor,
  hasBackdrop = false,
  backdropClassName,
  ...props
}: PopoverPrimitive.Popup.Props & {
  viewportClassName?: string;
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  tooltipStyle?: boolean;
  anchor?: PopoverPrimitive.Positioner.Props["anchor"];
  hasBackdrop?: boolean;
  backdropClassName?: string;
}) {
  const motionRef = useGsapSurface(props.ref);

  return (
    <PopoverPrimitive.Portal>
      {hasBackdrop && <PopoverBackdrop className={backdropClassName} />}
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
        data-slot="popover-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none transition-[width,height,scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] has-data-[slot=calendar]:rounded-xl has-data-[slot=calendar]:before:rounded-[calc(var(--radius-xl)-1px)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            tooltipStyle &&
              "w-fit text-balance rounded-md text-xs shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]",
            className,
          )}
          data-slot="popover-popup"
          {...props}
          ref={motionRef}
        >
          <PopoverPrimitive.Viewport
            className={cn(
              "relative size-full max-h-(--available-height) overflow-clip px-(--viewport-inline-padding) py-4 [--viewport-inline-padding:--spacing(4)] has-data-[slot=calendar]:p-2 data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:**:data-previous:data-ending-style:opacity-0 **:data-previous:**:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity",
              tooltipStyle
                ? "py-1 [--viewport-inline-padding:--spacing(2)]"
                : "not-data-transitioning:overflow-y-auto",
              viewportClassName,
            )}
            data-slot="popover-viewport"
          >
            {children}
          </PopoverPrimitive.Viewport>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      className={cn("font-semibold text-lg leading-none", className)}
      data-slot="popover-title"
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="popover-description"
      {...props}
    />
  );
}

export {
  PopoverCreateHandle,
  Popover,
  PopoverTrigger,
  PopoverBackdrop,
  PopoverPopup,
  PopoverPopup as PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
};
