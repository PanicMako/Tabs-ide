import { useEffect, useState } from "react";
import { PinIcon, XIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "./ui/dialog";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";

export interface WorkspaceToolActionTarget {
  id: string;
  label: string;
  temporary?: boolean;
  closable?: boolean;
}
export function WorkspaceToolActions({
  tool,
  onClose,
  onKeep,
}: {
  tool: WorkspaceToolActionTarget;
  onClose?: ((id: string) => void) | undefined;
  onKeep?: ((id: string) => void) | undefined;
}) {
  if (!tool.closable) return null;
  return (
    <span
      className="no-drag inline-flex shrink-0 items-center gap-0.5 pr-1"
      data-slot="workspace-tool-actions"
    >
      {tool.temporary && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Keep ${tool.label} in workspace`}
                onClick={(event) => {
                  event.stopPropagation();
                  onKeep?.(tool.id);
                }}
              >
                <PinIcon aria-hidden="true" className="size-3" />
                Keep
              </button>
            }
          />
          <TooltipPopup>Save this temporary tool to your workspace</TooltipPopup>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`Close ${tool.label}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose?.(tool.id);
              }}
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          }
        />
        <TooltipPopup>
          {tool.temporary ? "Close temporary tool" : "Close tab · reopen in Workspace settings"}
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
export function KeepWorkspaceToolDialog({
  tool,
  onClose,
  onKeep,
}: {
  tool: WorkspaceToolActionTarget | null;
  onClose: () => void;
  onKeep: (id: string, label: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => setName(tool?.label ?? ""), [tool?.id, tool?.label]);
  return (
    <Dialog
      open={Boolean(tool)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-sm">
        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (tool && name.trim()) onKeep(tool.id, name.trim());
          }}
        >
          <div className="space-y-2">
            <DialogTitle>Keep in workspace</DialogTitle>
            <DialogDescription>
              Give this tool a name. It will stay in your toolbar until you close it, and you can
              manage it in Workspace settings.
            </DialogDescription>
          </div>
          <label className="grid gap-2 text-sm">
            <span>Name</span>
            <Input
              autoFocus
              required
              aria-label="Tool name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Keep tool
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
