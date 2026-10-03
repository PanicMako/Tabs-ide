import { cn } from "~/lib/utils";

interface SettingsLoadingStateProps {
  label: string;
  className?: string;
}

export function SettingsLoadingState({ label, className }: SettingsLoadingStateProps) {
  return (
    <div
      className={cn(
        "tabs-loading-enter flex min-h-48 w-full items-center justify-center px-6 py-12 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex w-44 flex-col items-center gap-3.5">
        <div
          className="settings-loading-track relative h-px w-full overflow-hidden rounded-full bg-border/70"
          aria-hidden="true"
        >
          <div className="settings-loading-glint absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
        </div>
        <span className="text-xs font-medium tracking-wide text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
