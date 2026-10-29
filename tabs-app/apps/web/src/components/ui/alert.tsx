import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/lib/utils";

const alertVariants = cva(
  "relative flex items-center gap-3.5 w-full rounded-xl border px-4.5 py-3 text-card-foreground text-sm",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-transparent dark:bg-input/32 [&_[data-slot=alert-icon]]:text-muted-foreground",
        error: "border-destructive/32 bg-destructive/4 [&_[data-slot=alert-icon]]:text-destructive",
        info: "border-info/32 bg-info/4 [&_[data-slot=alert-icon]]:text-info",
        success: "border-success/32 bg-success/4 [&_[data-slot=alert-icon]]:text-success",
        warning: "border-warning/32 bg-warning/4 [&_[data-slot=alert-icon]]:text-warning",
      },
    },
  },
);

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("font-medium leading-tight text-foreground", className)}
      data-slot="alert-title"
      {...props}
    />
  );
}
(AlertTitle as unknown as { alertSlot?: string }).alertSlot = "title";

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2.5 text-muted-foreground leading-normal", className)}
      data-slot="alert-description"
      {...props}
    />
  );
}
(AlertDescription as unknown as { alertSlot?: string }).alertSlot = "description";

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-1 shrink-0", className)}
      data-slot="alert-action"
      {...props}
    />
  );
}
(AlertAction as unknown as { alertSlot?: string }).alertSlot = "action";

function isActionElement(element: React.ReactElement): boolean {
  const slot = (element.type as unknown as { alertSlot?: string })?.alertSlot;
  if (slot === "action") return true;
  return (
    element.type === AlertAction ||
    (element.props as Record<string, unknown>)?.["data-slot"] === "alert-action"
  );
}

function isContentElement(element: React.ReactElement): boolean {
  const slot = (element.type as unknown as { alertSlot?: string })?.alertSlot;
  if (slot === "title" || slot === "description") return true;
  return (
    element.type === AlertTitle ||
    element.type === AlertDescription ||
    (element.props as Record<string, unknown>)?.["data-slot"] === "alert-title" ||
    (element.props as Record<string, unknown>)?.["data-slot"] === "alert-description"
  );
}

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const childArray = React.Children.toArray(children);

  let iconNode: React.ReactNode = null;
  let actionNode: React.ReactNode = null;
  const contentNodes: React.ReactNode[] = [];

  for (const child of childArray) {
    if (React.isValidElement(child)) {
      if (isActionElement(child)) {
        actionNode = child;
        continue;
      }
      if (!iconNode && contentNodes.length === 0 && !isContentElement(child)) {
        iconNode = child;
        continue;
      }
    }
    contentNodes.push(child);
  }

  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    >
      {iconNode && (
        <div
          className="shrink-0 flex items-center justify-center [&>svg]:size-4 [&>svg]:shrink-0"
          data-slot="alert-icon"
        >
          {iconNode}
        </div>
      )}
      <div
        className="flex flex-col flex-1 min-w-0 gap-0.5 justify-center"
        data-slot="alert-content"
      >
        {contentNodes}
      </div>
      {actionNode && (
        <div className="shrink-0 flex items-center justify-center ml-auto">{actionNode}</div>
      )}
    </div>
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
