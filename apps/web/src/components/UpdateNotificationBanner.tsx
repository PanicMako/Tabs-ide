import React, { useState, useEffect } from "react";
import { AlertCircle, ArrowUpCircle, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  buildVersionMismatchDismissalKey,
  dismissVersionMismatch,
  isVersionMismatchDismissed,
  resolveVersionMismatch,
  manualServerUpdateCommand,
} from "../versionSkew";

export interface UpdateNotificationBannerProps {
  readonly serverVersion?: string | null;
  readonly clientVersion?: string;
  readonly environmentId?: string;
  readonly onUpdateClick?: () => void;
}

export function UpdateNotificationBanner({
  serverVersion,
  clientVersion,
  environmentId = "default",
  onUpdateClick,
}: UpdateNotificationBannerProps) {
  const mismatch = resolveVersionMismatch(serverVersion, clientVersion);
  const dismissalKey = mismatch ? buildVersionMismatchDismissalKey(environmentId, mismatch) : null;
  const [dismissed, setDismissed] = useState(() => isVersionMismatchDismissed(dismissalKey));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDismissed(isVersionMismatchDismissed(dismissalKey));
  }, [dismissalKey]);

  if (!mismatch || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    dismissVersionMismatch(dismissalKey);
    setDismissed(true);
  };

  const handleCopy = () => {
    const cmd = manualServerUpdateCommand(mismatch.clientVersion);
    void navigator.clipboard?.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="status"
      data-testid="update-notification-banner"
      className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-800 dark:text-amber-200 text-xs"
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="truncate">
          <strong>Update available:</strong> Server is running v{mismatch.serverVersion}, but client
          is v{mismatch.clientVersion}.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onUpdateClick ? (
          <Button size="xs" variant="outline" onClick={onUpdateClick} className="h-6 text-xs gap-1">
            <ArrowUpCircle className="w-3.5 h-3.5" />
            Update
          </Button>
        ) : (
          <Button size="xs" variant="outline" onClick={handleCopy} className="h-6 text-xs">
            {copied ? "Copied!" : "Copy Update Command"}
          </Button>
        )}
        <button
          onClick={handleDismiss}
          className="text-amber-700/60 hover:text-amber-900 dark:text-amber-400/60 dark:hover:text-amber-300 p-0.5 rounded transition-colors"
          aria-label="Dismiss update notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
