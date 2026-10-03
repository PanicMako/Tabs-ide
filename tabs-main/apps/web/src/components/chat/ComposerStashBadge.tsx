import { BookmarkIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

export interface ComposerStashBadgeProps {
  count: number;
  menuOpen: boolean;
  pulsing?: boolean;
  onToggleMenu: () => void;
  className?: string;
}

export const ComposerStashBadge = memo(function ComposerStashBadge({
  count,
  menuOpen,
  pulsing = false,
  onToggleMenu,
  className,
}: ComposerStashBadgeProps) {
  if (count === 0) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-prompt-stash-badge="true"
      aria-label={`Stashed prompts: ${count}. Open stash.`}
      aria-expanded={menuOpen}
      onClick={onToggleMenu}
      className={cn(
        "shrink-0 gap-1 px-1.5 h-7 text-xs font-medium transition-colors duration-200",
        pulsing
          ? "text-foreground bg-primary/10 shadow-xs ring-1 ring-primary/30"
          : menuOpen
            ? "text-foreground bg-accent"
            : "text-muted-foreground/80 hover:text-foreground",
        className,
      )}
      title={`View stashed prompts (${count})`}
    >
      <BookmarkIcon
        className={cn("size-3.5", pulsing && "animate-pulse motion-reduce:animate-none")}
      />
      <span className="sr-only">Stash</span>
      <span
        className={cn(
          "inline-flex min-w-[1.125rem] items-center justify-center rounded-full px-1 py-0.5 text-[10px] tabular-nums font-semibold leading-none",
          pulsing ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </Button>
  );
});
