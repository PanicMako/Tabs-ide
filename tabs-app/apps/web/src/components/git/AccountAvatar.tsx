import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { GitHubIcon } from "../Icons";

export function AccountAvatar({
  login,
  src,
  size = "md",
  className,
}: {
  login: string | null;
  /** An inline picture from the server; the public GitHub URL is only the fallback. */
  src?: string | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    setHasError(false);
  }, [login, src]);

  const sizeClass = {
    sm: "size-4.5 text-[9px]",
    md: "size-5 text-[10px]",
    lg: "size-9 text-xs",
  }[size];

  if (login && !hasError) {
    return (
      <img
        src={src ?? `https://github.com/${login}.png?size=${size === "lg" ? 80 : 48}`}
        alt={login}
        onError={() => setHasError(true)}
        className={cn(
          "rounded-full object-cover shrink-0 ring-1 ring-border/70",
          sizeClass,
          className,
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full bg-muted border border-border/80 flex items-center justify-center font-mono font-bold text-foreground shrink-0 select-none",
        sizeClass,
        className,
      )}
    >
      {login ? login[0]?.toUpperCase() : <GitHubIcon className="size-3 text-muted-foreground" />}
    </div>
  );
}
