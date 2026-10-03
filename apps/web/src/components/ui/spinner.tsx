import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";
import { MercuryChromeLoader } from "../MercuryChromeLoader";

function Spinner({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-label="Loading"
      className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}
      role="status"
      {...props}
    >
      <MercuryChromeLoader size={14} className="shrink-0" />
    </span>
  );
}

export { Spinner };
