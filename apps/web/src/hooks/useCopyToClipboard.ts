import * as React from "react";

export async function writeClipboardTextWithNativeFallback(
  value: string,
  environment: {
    rendererWriteText?: ((value: string) => Promise<void>) | undefined;
    nativeWriteText?: ((value: string) => Promise<void>) | undefined;
  } = {
    rendererWriteText: navigator.clipboard?.writeText.bind(navigator.clipboard),
    nativeWriteText: window.desktopBridge?.writeClipboardText,
  },
): Promise<void> {
  try {
    if (environment.rendererWriteText) {
      await environment.rendererWriteText(value);
      return;
    }
  } catch {
    // Electron can deny the renderer Clipboard API depending on focus and
    // permission state. The native bridge is the authoritative fallback.
  }
  if (environment.nativeWriteText) {
    await environment.nativeWriteText(value);
    return;
  }
  throw new Error("Clipboard API unavailable.");
}

export function useCopyToClipboard<TContext = void>({
  timeout = 2000,
  onCopy,
  onError,
}: {
  timeout?: number;
  onCopy?: (ctx: TContext) => void;
  onError?: (error: Error, ctx: TContext) => void;
} = {}): { copyToClipboard: (value: string, ctx: TContext) => void; isCopied: boolean } {
  const [isCopied, setIsCopied] = React.useState(false);
  const timeoutIdRef = React.useRef<NodeJS.Timeout | null>(null);
  const onCopyRef = React.useRef(onCopy);
  const onErrorRef = React.useRef(onError);
  const timeoutRef = React.useRef(timeout);

  onCopyRef.current = onCopy;
  onErrorRef.current = onError;
  timeoutRef.current = timeout;

  const copyToClipboard = React.useCallback((value: string, ctx: TContext): void => {
    if (typeof window === "undefined") {
      onErrorRef.current?.(new Error("Clipboard API unavailable."), ctx);
      return;
    }

    if (!value) return;

    writeClipboardTextWithNativeFallback(value).then(
      () => {
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
        }
        setIsCopied(true);

        onCopyRef.current?.(ctx);

        if (timeoutRef.current !== 0) {
          timeoutIdRef.current = setTimeout(() => {
            setIsCopied(false);
            timeoutIdRef.current = null;
          }, timeoutRef.current);
        }
      },
      (error) => {
        if (onErrorRef.current) {
          onErrorRef.current(error, ctx);
        } else {
          console.error(error);
        }
      },
    );
  }, []);

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return (): void => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
    };
  }, []);

  return { copyToClipboard, isCopied };
}
