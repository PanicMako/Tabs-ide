import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

export type QuitConfirmationChoice = "save-and-quit" | "cancel";

export function QuitConfirmationModal(props: {
  open: boolean;
  onChoice: (choice: QuitConfirmationChoice) => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onChoice("cancel");
      }}
    >
      <DialogPopup showCloseButton={false} aria-describedby="quit-confirmation-description">
        <DialogHeader>
          <DialogTitle>Quit Tabs?</DialogTitle>
          <DialogDescription id="quit-confirmation-description">
            Tabs will save open editor changes before quitting. Running terminals and tasks will
            stop.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onChoice("cancel")}>
            Cancel
          </Button>
          <Button type="button" autoFocus onClick={() => props.onChoice("save-and-quit")}>
            Save & Quit
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
