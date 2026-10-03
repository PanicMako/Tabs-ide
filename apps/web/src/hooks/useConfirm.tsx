import { useState, useCallback } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";

export function useConfirm() {
  const [state, setState] = useState<{
    message: string;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      setState({ message, resolve });
    });
  }, []);

  const handleClose = useCallback(
    (value: boolean) => {
      if (state) {
        state.resolve(value);
        setState(null);
      }
    },
    [state],
  );

  const confirmDialog = (
    <AlertDialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) handleClose(false);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-wrap">
            {state?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
            }
          />
          <Button variant="destructive" onClick={() => handleClose(true)}>
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}
