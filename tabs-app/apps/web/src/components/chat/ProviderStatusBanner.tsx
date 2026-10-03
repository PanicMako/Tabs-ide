import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@tabs/contracts";
import { memo } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";

export function getProviderStatusBannerKey(status: ServerProvider | null): string | null {
  if (!status || status.status === "ready" || status.status === "disabled") return null;
  if (
    status.driver === "antigravity" &&
    status.installed &&
    status.status === "warning" &&
    status.auth.status === "unknown"
  )
    return null;
  return [status.instanceId, status.status, status.auth.status, status.message ?? ""].join("\0");
}

export function shouldShowProviderStatusBanner(
  status: ServerProvider | null,
  dismissedKey: string | null,
): boolean {
  const key = getProviderStatusBannerKey(status);
  return key !== null && key !== dismissedKey;
}

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  onDismiss,
  status,
}: {
  onDismiss: () => void;
  status: ServerProvider | null;
}) {
  if (!status || getProviderStatusBannerKey(status) === null) {
    return null;
  }

  const providerLabel =
    PROVIDER_DISPLAY_NAMES[status.instanceId as string as keyof typeof PROVIDER_DISPLAY_NAMES] ??
    status.instanceId;
  const defaultMessage =
    status.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const title = `${providerLabel} provider status`;

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert className="relative pr-10" variant={status.status === "error" ? "error" : "warning"}>
        <CircleAlertIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={status.message ?? defaultMessage}>
          {status.message ?? defaultMessage}
        </AlertDescription>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-2 top-2"
          onClick={onDismiss}
          aria-label={`Dismiss ${providerLabel} provider ${status.status}`}
        >
          <XIcon className="size-3.5" />
        </Button>
      </Alert>
    </div>
  );
});
