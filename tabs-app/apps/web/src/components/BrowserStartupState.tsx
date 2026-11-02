import { GlobeIcon } from "lucide-react";
import { Spinner } from "./ui/spinner";

/** Startup is pending, not an unavailable host. Only show an error after resolution. */
export function BrowserStartupState({ title }: { title: string }) {
  return (
    <div
      className="flex h-full min-h-0 items-center justify-center bg-background p-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-xs flex-col items-center gap-4 text-center">
        <div className="relative flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
          <GlobeIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          <Spinner className="absolute -bottom-1 -right-1 size-5 rounded-full bg-background text-primary motion-reduce:animate-none" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Opening {title}…</p>
          <p className="text-xs text-muted-foreground">Preparing your browser session</p>
        </div>
      </div>
    </div>
  );
}
