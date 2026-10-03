import { MercuryChromeLoader } from "./MercuryChromeLoader";
import { cn } from "~/lib/utils";

interface PageLoadingStateProps {
  label: string;
  detail?: string;
  className?: string;
  compact?: boolean;
}

export function PageLoadingState({
  label,
  detail,
  className,
  compact = false,
}: PageLoadingStateProps) {
  return (
    <div
      className={cn(
        "tabs-loading-enter flex min-h-0 w-full flex-1 items-center justify-center bg-background px-6 text-center",
        compact ? "py-10" : "h-full py-16",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex max-w-sm flex-col items-center">
        <div className="relative grid size-24 place-items-center">
          <div className="absolute inset-3 rounded-full bg-primary/8 blur-2xl" aria-hidden="true" />
          <MercuryChromeLoader
            size={compact ? 52 : 68}
            color="var(--primary)"
            className="relative"
          />
        </div>
        <div className="mt-4 text-sm font-medium text-foreground/85">{label}</div>
        {detail ? (
          <div className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}
