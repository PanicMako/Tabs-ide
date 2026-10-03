import type { AuditFinding } from "@tabs/contracts";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export interface PatchPreviewModalProps {
  readonly finding: AuditFinding | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function PatchPreviewModal({ finding, isOpen, onClose }: PatchPreviewModalProps) {
  if (!isOpen || !finding || !finding.suggestedFix) return null;

  const fix = finding.suggestedFix;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="border-b border-border/70 p-4 bg-muted/40 shrink-0">
          <DialogTitle className="text-base font-semibold text-foreground">
            Safe Repair Patch Preview
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            {fix.description}
          </DialogDescription>
        </DialogHeader>

        {/* Patch Content */}
        <DialogPanel className="p-4 space-y-4 font-mono text-xs">
          <div className="text-muted-foreground">
            Affected File(s):{" "}
            <span className="text-foreground font-semibold">{fix.affectedFiles.join(", ")}</span>
          </div>

          <pre className="p-4 bg-muted/60 rounded-lg border border-border overflow-x-auto text-foreground">
            {fix.replacementPatch.split("\n").map((line, idx) => {
              let color = "text-muted-foreground";
              if (line.startsWith("+") && !line.startsWith("+++"))
                color = "text-emerald-500 bg-emerald-500/10 font-semibold";
              else if (line.startsWith("-") && !line.startsWith("---"))
                color = "text-red-500 bg-red-500/10 font-semibold";
              else if (line.startsWith("@")) color = "text-foreground font-bold";

              return (
                <div key={idx} className={color}>
                  {line}
                </div>
              );
            })}
          </pre>
        </DialogPanel>

        {/* Footer */}
        <DialogFooter className="p-4 bg-muted/40 border-t border-border flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground italic">
            Automated preview • Reversible in Git
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs text-muted-foreground border-border"
            >
              Close Preview
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
