import type { ThreadId } from "@tabs/contracts";
import { browserQuickActionPage } from "@tabs/shared/browserQuickAction";
import { useEffect, useRef, useState } from "react";
import {
  addSurfaceFileToDraft,
  prepareDroppedSurfaceAttachment,
  requireSurfaceAttachmentSlot,
  surfaceAttachmentFile,
  surfaceScope,
  type SurfaceLocation,
} from "~/lib/threadSurfaceAttachment";
import { useCompanionSurfaceStore, type CompanionSurface } from "~/stores/companionSurfaceStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export function AttachOpenBrowserDialog({
  location,
  threads,
  isCurrent,
  onClose,
}: {
  location: SurfaceLocation;
  threads: ReadonlyMap<ThreadId, string>;
  isCurrent: () => boolean;
  onClose: () => void;
}) {
  const workspaces = useCompanionSurfaceStore((state) => state.workspaces);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const options = Array.from(threads.entries()).flatMap(([threadId, title]) => {
    if (threadId === location.threadId) return [];
    const source = { ...location, threadId };
    return (workspaces[surfaceScope(source)]?.tabs ?? []).flatMap((tab) => {
      const page = tab.url ? browserQuickActionPage(tab.url) : undefined;
      return tab.kind === "browser" && page && tab.pageRef && tab.browserInstanceId
        ? [{ source, title, tab, page }]
        : [];
    });
  });

  const attach = async (source: SurfaceLocation, tab: CompanionSurface) => {
    const canAttach = () => active.current && isCurrent();
    if (pending || !canAttach()) return;
    setPending(true);
    setError(undefined);
    try {
      requireSurfaceAttachmentSlot(location);
      const file = surfaceAttachmentFile(source, tab);
      if (!file) throw new Error("Open the browser page before moving it.");
      const attachment = await prepareDroppedSurfaceAttachment(location, file, canAttach);
      if (!attachment) return;
      addSurfaceFileToDraft(location, attachment);
      if (canAttach()) onClose();
    } catch (cause) {
      if (canAttach())
        setError(cause instanceof Error ? cause.message : "Could not attach this tab.");
    } finally {
      if (canAttach()) setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          active.current = false;
          onClose();
        }
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Attach an open browser tab</DialogTitle>
          <DialogDescription>Move the selected tab into this conversation.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-2">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {options.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Open a browser tab in another conversation in this project first.
            </p>
          )}
          {options.map(({ source, title, tab, page }) => (
            <Button
              key={tab.id}
              type="button"
              variant="outline"
              className="h-auto min-w-0 flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
              disabled={pending}
              onClick={() => void attach(source, tab)}
            >
              <span>{tab.title || "Browser tab"}</span>
              <span
                className="break-all text-xs font-normal text-muted-foreground"
                title={`Tab ${tab.id}`}
              >
                {page.origin}
                {page.pathname}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {tab.profileId ?? "default"} · {title}
              </span>
            </Button>
          ))}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
