import { memo, useRef } from "react";
import { CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "../ui/anchoredCopyToast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface MessageCopyButtonProps {
  text: string;
  size?: "xs" | "icon-xs";
  variant?: "outline" | "ghost";
  className?: string;
  label?: string;
}

export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  size = "icon-xs",
  variant = "ghost",
  className,
  label = "Copy message",
}: MessageCopyButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error: Error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });

  const accessibleLabel = isCopied ? "Message copied to clipboard" : `${label} to clipboard`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={accessibleLabel}
            disabled={isCopied}
            onClick={() => copyToClipboard(text)}
            ref={ref}
            type="button"
            size={size}
            variant={variant}
            className={cn(
              "text-muted-foreground/50 hover:text-foreground motion-reduce:transition-none",
              isCopied && "text-emerald-500",
              className,
            )}
          />
        }
      >
        {isCopied ? (
          <CheckIcon className="size-3 text-emerald-500" />
        ) : (
          <CopyIcon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{isCopied ? "Copied!" : "Copy to clipboard"}</p>
      </TooltipPopup>
    </Tooltip>
  );
});
