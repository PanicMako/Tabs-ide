import { useEffect, useRef } from "react";

/**
 * Surfaces outside the workspace (the Command Palette) ask it to open an
 * extension's toolbar tool. The workspace owns the active project and decides
 * whether the tool is available there, exactly as for Quick Actions.
 */
const OPEN_EXTENSION_TOOL_EVENT = "tabs:open-extension-tool";

export interface OpenExtensionToolRequest {
  /** The toolbar tool id from `extensionToolbarToolId`. */
  readonly toolbarToolId: string;
  /** Resolves when the tool is shown; rejects with a reason the caller can show. */
  readonly settle: { resolve: () => void; reject: (error: Error) => void };
}

export function requestOpenExtensionTool(toolbarToolId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const detail: OpenExtensionToolRequest = { toolbarToolId, settle: { resolve, reject } };
    const event = new CustomEvent<OpenExtensionToolRequest>(OPEN_EXTENSION_TOOL_EVENT, {
      detail,
      cancelable: true,
    });
    // An uncancelled event means no workspace was listening.
    if (window.dispatchEvent(event)) reject(new Error("Open a project first."));
  });
}

export function useOpenExtensionToolRequests(open: (toolbarToolId: string) => Promise<void>): void {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const listener = (event: Event) => {
      const { detail } = event as CustomEvent<OpenExtensionToolRequest>;
      if (!detail?.settle || typeof detail.toolbarToolId !== "string") return;
      event.preventDefault();
      openRef
        .current(detail.toolbarToolId)
        .then(detail.settle.resolve, (error: unknown) =>
          detail.settle.reject(error instanceof Error ? error : new Error(String(error))),
        );
    };
    window.addEventListener(OPEN_EXTENSION_TOOL_EVENT, listener);
    return () => window.removeEventListener(OPEN_EXTENSION_TOOL_EVENT, listener);
  }, []);
}
