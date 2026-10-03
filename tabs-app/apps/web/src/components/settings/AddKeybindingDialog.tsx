import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { WhenExpressionBuilder } from "./KeybindingsSettings";
import type { KeybindingCommand, KeybindingRule } from "@tabs/contracts";
import {
  type KeybindingRow,
  type WhenVariableOption,
  commandLabel,
  keybindingFromKeyboardEvent,
  whenAstToExpression,
} from "./keybindingsSettings.logic";
import { parseKeybindingShortcut } from "@tabs/shared/keybindings";
import { formatShortcutLabel } from "../../keybindings";
import { useState, type KeyboardEvent } from "react";
import { KeyboardIcon, PlusIcon, XIcon } from "lucide-react";
import { Kbd } from "../ui/kbd";
import { cn } from "../../lib/utils";

interface AddKeybindingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commandOptions: readonly KeybindingCommand[];
  allRows: readonly KeybindingRow[];
  variables: readonly WhenVariableOption[];
  isSaving: boolean;
  onSave: (rule: KeybindingRule) => void;
  platform: string;
}

export function AddKeybindingDialog({
  open,
  onOpenChange,
  commandOptions,
  allRows,
  variables,
  isSaving,
  onSave,
  platform,
}: AddKeybindingDialogProps) {
  const [command, setCommand] = useState<KeybindingCommand | "">("");
  const [key, setKey] = useState("");
  const [whenNode, setWhenNode] = useState<any>(undefined);
  const [isRecording, setIsRecording] = useState(false);

  const handleSave = () => {
    if (!command || !key) return;

    const expr = whenAstToExpression(whenNode)?.trim() ?? "";
    onSave({
      command: command as KeybindingCommand,
      key,
      ...(expr.length > 0 ? { when: expr } : {}),
    });

    setCommand("");
    setKey("");
    setWhenNode(undefined);
    setIsRecording(false);
    onOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setKey("");
      setIsRecording(false);
      return;
    }
    const next = keybindingFromKeyboardEvent(event.nativeEvent, platform);
    if (!next) return;
    setKey(next);
    setIsRecording(false);
  };

  const parsedShortcut = key ? parseKeybindingShortcut(key) : null;
  const formattedShortcut = parsedShortcut ? formatShortcutLabel(parsedShortcut, platform) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[92vw] sm:max-w-xl md:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
        <DialogHeader className="flex flex-col space-y-1 border-b border-border/50 px-5 py-4 shrink-0 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-foreground">
              <KeyboardIcon className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight text-foreground">
                Add Keybinding
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Configure a custom keybinding shortcut and context rule for your application.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Command <span className="text-destructive">*</span>
              </label>
              <Select
                value={command}
                onValueChange={(value) => setCommand(value as KeybindingCommand)}
              >
                <SelectTrigger className="h-9 w-full rounded-lg border-border/70 text-xs">
                  <SelectValue placeholder="Select a command..." />
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger={false}
                  className="max-h-60 w-[var(--radix-select-trigger-width)]"
                >
                  {commandOptions.map((cmd) => (
                    <SelectItem key={cmd} value={cmd} className="py-1.5">
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-foreground truncate">
                          {commandLabel(cmd)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 font-mono truncate">
                          {cmd}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Keybinding Shortcut <span className="text-destructive">*</span>
                </label>
                {key ? (
                  <button
                    type="button"
                    onClick={() => {
                      setKey("");
                      setIsRecording(false);
                    }}
                    className="text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                  >
                    <XIcon className="size-3" />
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="relative">
                <Input
                  placeholder={isRecording ? "Press key combination..." : "Click & press keys"}
                  value={isRecording ? "Press keys..." : key}
                  onFocus={() => setIsRecording(true)}
                  onBlur={() => setIsRecording(false)}
                  onKeyDown={handleKeyDown}
                  className={cn(
                    "h-9 rounded-lg border-border/70 font-mono text-xs transition-colors pr-16",
                    isRecording && "border-primary ring-2 ring-primary/20 bg-primary/5",
                  )}
                />
                {formattedShortcut && !isRecording ? (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <Kbd className="h-5 px-1.5 text-[11px] bg-muted border border-border/50 shadow-xs font-mono">
                      {formattedShortcut}
                    </Kbd>
                  </div>
                ) : null}
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                {isRecording
                  ? "Press Esc to clear recording."
                  : "Click box and press key combination on keyboard."}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/10 p-3.5">
            <WhenExpressionBuilder value={whenNode} variables={variables} onChange={setWhenNode} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border/50 px-5 py-3 shrink-0 bg-muted/20">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !command || !key}
            className="h-8 text-xs px-4 gap-1.5"
          >
            <PlusIcon className="size-3.5" />
            {isSaving ? "Saving..." : "Add Keybinding"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
