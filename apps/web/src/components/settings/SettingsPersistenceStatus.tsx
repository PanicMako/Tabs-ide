import { useSettingsPersistence } from "../../hooks/useSettings";
import { useDirtyDraftSources } from "../../state/settingsDraftRegistry";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

export function SettingsPersistenceStatus({ className }: { readonly className?: string }) {
  const persistence = useSettingsPersistence();
  const dirtySources = useDirtyDraftSources();
  const isAnyDraftDirty = dirtySources.length > 0;

  // Failed persistence takes precedence over everything and exposes Retry
  if (persistence.status === "failed") {
    return (
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className={cn("flex items-center gap-2 text-xs", className)}
      >
        <div className="flex items-center gap-1.5 text-destructive font-medium">
          <span>Failed to save</span>
          {persistence.retry && (
            <Button
              size="xs"
              variant="outline"
              className="h-6 px-2 text-xs text-foreground border-destructive/40 hover:bg-destructive/10"
              onClick={() => {
                void persistence.retry?.();
              }}
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Active persistence activity
  if (persistence.status === "saving") {
    return (
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className={cn("flex items-center gap-2 text-xs", className)}
      >
        <span className="text-muted-foreground">Saving...</span>
      </div>
    );
  }

  // Auto-save debounce pending
  if (persistence.status === "pending") {
    return (
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className={cn("flex items-center gap-2 text-xs", className)}
      >
        <span className="text-muted-foreground">Auto-save pending...</span>
      </div>
    );
  }

  // If any registered draft is dirty, display contextual section names and never an unqualified "Saved"
  if (isAnyDraftDirty) {
    const labels = dirtySources.map((s) => s.label || s.sourceId).join(", ");
    return (
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className={cn("flex items-center gap-2 text-xs", className)}
      >
        <span className="text-amber-500 font-medium">
          {labels ? `Unsaved changes (${labels})` : "Unsaved changes"}
        </span>
      </div>
    );
  }

  // Clean auto-save state
  if (persistence.status === "saved") {
    return (
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className={cn("flex items-center gap-2 text-xs", className)}
      >
        <span className="text-muted-foreground">Saved</span>
      </div>
    );
  }

  return null;
}
