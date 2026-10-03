import type { DesktopBrowserSecurityContext } from "@tabs/contracts";
import {
  ShieldCheckIcon,
  ShieldAlertIcon,
  ShieldOffIcon,
  AlertTriangleIcon,
  ExternalLinkIcon,
  UserIcon,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export interface BrowserSecurityBadgeProps {
  readonly compact?: boolean;
  readonly securityContext?: DesktopBrowserSecurityContext | undefined;
  readonly currentUrl: string | null;
  readonly onOpenExternal?: (() => void) | undefined;
}

export function BrowserSecurityBadge({
  securityContext,
  compact = false,
  currentUrl,
  onOpenExternal,
}: BrowserSecurityBadgeProps) {
  if (!securityContext || !currentUrl || currentUrl === "about:blank") {
    return null;
  }

  const {
    securityState,
    registrableDomain,
    origin,
    profileId,
    certificateError,
    hasPunycodeWarning,
    isTabsOwned,
  } = securityContext;

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Profile indicator */}
      {profileId && !compact ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                tabIndex={0}
                variant="outline"
                className="h-6 px-1.5 py-0 text-[10px] font-medium border-border/80 text-muted-foreground flex items-center gap-1 cursor-default"
              >
                <UserIcon className="size-2.5" />
                <span className="max-w-[70px] truncate">{profileId}</span>
              </Badge>
            }
          />
          <TooltipPopup side="bottom">
            Active browser profile partition: {profileId}. Logins and cookies remain isolated to
            this profile.
          </TooltipPopup>
        </Tooltip>
      ) : null}

      {/* Security State Badge */}
      {securityState === "secure" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                tabIndex={0}
                variant="outline"
                className="h-6 px-1.5 py-0 text-[10px] font-medium bg-primary/5 text-foreground border-primary/20 flex items-center gap-1 cursor-default"
              >
                <ShieldCheckIcon className="size-2.5 text-foreground" />
                <span className={compact ? "sr-only" : "font-mono text-[10px]"}>
                  {registrableDomain || "Secure"}
                </span>
              </Badge>
            }
          />
          <TooltipPopup side="bottom" className="max-w-xs text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1 text-foreground">
              <ShieldCheckIcon className="size-3" />
              Verified Secure Connection
            </div>
            <div className="text-[11px] text-muted-foreground">
              <p>
                <strong>Origin:</strong> {origin}
              </p>
              <p>
                <strong>Domain:</strong> {registrableDomain}
              </p>
              <p>
                <strong>Surface:</strong>{" "}
                {isTabsOwned ? "Tabs Isolated Native Browser" : "External"}
              </p>
            </div>
          </TooltipPopup>
        </Tooltip>
      ) : securityState === "broken" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                tabIndex={0}
                variant="destructive"
                className="h-6 px-1.5 py-0 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                onClick={onOpenExternal}
              >
                <ShieldAlertIcon className="size-2.5" />
                <span>Certificate Error</span>
              </Badge>
            }
          />
          <TooltipPopup side="bottom" className="max-w-xs text-xs space-y-1.5">
            <div className="font-semibold flex items-center gap-1 text-destructive">
              <ShieldAlertIcon className="size-3" />
              Security Error: Untrusted Certificate
            </div>
            <p className="text-[11px] text-muted-foreground">
              {certificateError || "The certificate presented by this site is invalid or expired."}
            </p>
            {onOpenExternal ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="w-full mt-1 text-[11px] gap-1"
                onClick={onOpenExternal}
              >
                <ExternalLinkIcon className="size-3" />
                Open In System Browser
              </Button>
            ) : null}
          </TooltipPopup>
        </Tooltip>
      ) : securityState === "insecure" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                tabIndex={0}
                variant="secondary"
                className="h-6 px-1.5 py-0 text-[10px] font-medium text-amber-600 dark:text-amber-400 border-amber-500/20 flex items-center gap-1 cursor-default"
              >
                <ShieldOffIcon className="size-2.5" />
                <span className={compact ? "sr-only" : undefined}>Not Secure (HTTP)</span>
              </Badge>
            }
          />
          <TooltipPopup side="bottom" className="max-w-xs text-xs">
            This connection is not encrypted. Do not enter sensitive credentials.
          </TooltipPopup>
        </Tooltip>
      ) : null}

      {/* Punycode Homoglyph Warning */}
      {hasPunycodeWarning ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                tabIndex={0}
                variant="destructive"
                className="h-6 px-1.5 py-0 text-[10px] font-medium flex items-center gap-1 cursor-default"
              >
                <AlertTriangleIcon className="size-2.5" />
                <span>Punycode / IDN</span>
              </Badge>
            }
          />
          <TooltipPopup side="bottom" className="max-w-xs text-xs">
            Warning: This hostname uses international/punycode characters (<code>xn--</code>).
            Verify that this domain is authentic and not a homoglyph spoofing attack.
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
