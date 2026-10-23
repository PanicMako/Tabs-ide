import { useScopedPortalContainer } from "~/lib/scopedPortal";
("use client");

import { useGsapSurface } from "~/hooks/useGsapSurface";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";

const DialogCreateHandle = DialogPrimitive.createHandle;

const Dialog = DialogPrimitive.Root;

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  const container = useScopedPortalContainer();
  return <DialogPrimitive.Portal container={container} {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      forceRender
      className={cn(
        "fixed inset-0 z-50 bg-black/45 backdrop-blur-[8px] transition-opacity duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

function DialogViewport({ className, ...props }: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 grid grid-rows-[1fr_auto_1fr] justify-items-center p-4",
        className,
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  bottomStickOnMobile = true,
  backdropClassName,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  bottomStickOnMobile?: boolean;
  backdropClassName?: string;
}) {
  const motionRef = useGsapSurface(props.ref);

  return (
    <DialogPortal>
      <DialogBackdrop className={backdropClassName} />
      <DialogViewport
        className={cn(bottomStickOnMobile && "max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12")}
      >
        <DialogPrimitive.Popup
          className={cn(
            "-translate-y-[calc(1.25rem*var(--nested-dialogs))] relative row-start-2 flex max-h-[calc(100dvh-2rem)] min-h-0 w-full min-w-0 max-w-md scale-[calc(1-0.1*var(--nested-dialogs))] flex-col rounded-3xl border bg-popover backdrop-blur-3xl not-dark:bg-clip-padding text-popover-foreground opacity-[calc(1-0.1*var(--nested-dialogs))] shadow-lg/5 transition-[scale,opacity,translate] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0 will-change-transform before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-3xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-nested:data-ending-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-98 data-ending-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            bottomStickOnMobile &&
              "max-sm:max-w-none max-sm:rounded-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:before:hidden max-sm:before:rounded-none",
            className,
          )}
          data-slot="dialog-popup"
          {...props}
          ref={motionRef}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute end-3 top-3 rounded-full size-8"
              render={<Button size="icon" variant="ghost" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 p-5 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pb-3 max-sm:pb-4 in-[[data-slot=dialog-panel]]:p-0 in-[[data-slot=dialog-panel]]:mb-4",
        className,
      )}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-5 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-3xl)-1px)] in-[[data-slot=dialog-panel]]:px-0 in-[[data-slot=dialog-panel]]:pb-0 in-[[data-slot=dialog-panel]]:mt-4 in-[[data-slot=dialog-panel]]:bg-transparent",
        variant === "default" && "border-t bg-muted/30 py-3",
        variant === "bare" &&
          "in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pt-3 pt-3 pb-5",
        className,
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("font-heading font-semibold text-lg leading-tight tracking-tight", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-muted-foreground text-xs leading-relaxed", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogPanel({
  className,
  scrollFade = true,
  ...props
}: React.ComponentProps<"div"> & { scrollFade?: boolean }) {
  return (
    <ScrollArea scrollFade={scrollFade}>
      <div
        className={cn(
          "p-5 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-1 in-[[data-slot=dialog-popup]:has([data-slot=dialog-footer]:not(.border-t))]:pb-1",
          className,
        )}
        data-slot="dialog-panel"
        {...props}
      />
    </ScrollArea>
  );
}

/** Secondary options stay available without crowding the main form. */
function DialogDetails({
  title,
  children,
  className,
  ...props
}: React.ComponentProps<"details"> & { title: string }) {
  return (
    <details
      {...props}
      className={cn("group rounded-xl border border-border/60 bg-muted/15 px-3 py-2.5", className)}
      data-slot="dialog-details"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="space-y-3 pt-3">{children}</div>
    </details>
  );
}

export {
  DialogCreateHandle,
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogBackdrop,
  DialogBackdrop as DialogOverlay,
  DialogPopup,
  DialogPopup as DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogDetails,
  DialogViewport,
};
