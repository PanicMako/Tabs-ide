import { type ReactNode, forwardRef } from "react";
import { Button } from "./button";
import { GripVerticalIcon, ChevronUpIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function MasterDetail({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-1 min-h-0 min-w-0 gap-6", className)}>{children}</div>;
}

export function MasterDetailSidebar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex w-56 shrink-0 flex-col gap-3 border-r border-border/70 pr-6", className)}
    >
      {children}
    </div>
  );
}

export function MasterDetailList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex-1 -mx-2 px-2", className)}>
      <div className="space-y-1 pb-4">{children}</div>
    </div>
  );
}

export function MasterDetailContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex-1 min-w-0 -my-2 py-2 pr-4", className)}>
      <div className="pb-4">{children}</div>
    </div>
  );
}

interface MasterDetailItemProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  icon?: React.ReactNode;
  isActive: boolean;
  isUnsaved?: boolean;
  onSelect: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragHandleProps?: {
    attributes?: any;
    listeners?: any;
  };
}

export const MasterDetailItem = forwardRef<HTMLDivElement, MasterDetailItemProps>(
  (
    {
      label,
      icon,
      isActive,
      isUnsaved,
      onSelect,
      onMoveUp,
      onMoveDown,
      canMoveUp,
      canMoveDown,
      dragHandleProps,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <div ref={ref} className={cn("group flex items-center gap-1", className)} {...props}>
        <Button
          type="button"
          variant={isActive ? "secondary" : "ghost"}
          className="flex-1 justify-start truncate font-normal relative pr-6 text-left"
          onClick={onSelect}
        >
          {icon ? <span className="mr-2 shrink-0 text-muted-foreground">{icon}</span> : null}
          <span className="truncate">{label}</span>
          {isUnsaved ? (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500"
              title="Unsaved changes"
            >
              <span className="sr-only">(unsaved changes)</span>
            </span>
          ) : null}
        </Button>
        {dragHandleProps ? (
          <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-4 hover:bg-muted cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0 flex items-center justify-center"
              {...dragHandleProps.attributes}
              {...dragHandleProps.listeners}
            >
              <GripVerticalIcon className="size-3.5" />
            </Button>
          </div>
        ) : null}
        {(onMoveUp || onMoveDown) && isActive ? (
          <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-4 w-4 hover:bg-muted p-0 flex items-center justify-center"
              disabled={!canMoveUp}
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp?.();
              }}
            >
              <ChevronUpIcon className="size-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-4 w-4 hover:bg-muted p-0 flex items-center justify-center"
              disabled={!canMoveDown}
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown?.();
              }}
            >
              <ChevronDownIcon className="size-3" />
            </Button>
          </div>
        ) : null}
      </div>
    );
  },
);

MasterDetailItem.displayName = "MasterDetailItem";
