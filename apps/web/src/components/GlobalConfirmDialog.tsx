import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { subscribeToConfirm, type ConfirmRequest } from "~/lib/customConfirm";
export function GlobalConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    return subscribeToConfirm((req) => {
      setRequest(req);
    });
  }, []);

  if (!request) return null;

  const handleCancel = () => {
    request.resolve(false);
  };

  const handleConfirm = () => {
    request.resolve(true);
  };

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) handleCancel();
      }}
    >
      <DialogContent className="max-w-[400px]">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-base font-bold text-foreground">Confirm Action</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
            {request.message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex items-center justify-end gap-2 pt-4 border-t border-border/40 bg-transparent">
          <Button size="sm" variant="ghost" onClick={handleCancel} className="text-xs h-8">
            Cancel
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={handleConfirm}
            className="text-xs h-8 font-semibold"
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
