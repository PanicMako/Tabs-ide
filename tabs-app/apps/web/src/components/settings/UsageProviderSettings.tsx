import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";

export function UsageProviderSettings({
  environmentLabel = "Local",
  readOnly = false,
}: {
  readonly environmentLabel?: string;
  readonly readOnly?: boolean;
} = {}) {
  const sources = useSettings((s) => s.usageLimitSources) ?? {};
  const { updateSettings } = useUpdateSettings();
  const [adding, setAdding] = useState(false);
  const entries = Object.entries(sources);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Usage Limit Hubs</h3>
          <p className="text-xs text-muted-foreground">
            Connect CLIProxyAPI hubs to pool quotas and monitor provider limits.
          </p>
        </div>
        {!readOnly && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <PlusIcon className="size-3.5" aria-hidden />
            <span>Add hub</span>
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden divide-y divide-border/40">
        {entries.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">
            No CLIProxyAPI usage hubs configured.
          </div>
        ) : (
          entries.map(([id, source]) => {
            const label = source.label?.trim() || source.url;
            return (
              <div key={id} className="flex items-center justify-between p-4 gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground break-all">
                    CLI Proxy{source.enabled ? "" : " · Disabled"}
                    {label !== source.url ? ` · ${source.url}` : ""}
                  </div>
                </div>
                {!readOnly && (
                  <RemoveUsageProviderButton
                    label={label}
                    onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {adding && !readOnly ? (
        <AddUsageLimitSourceDialog
          open
          onOpenChange={setAdding}
          environmentLabel={environmentLabel}
        />
      ) : null}
    </div>
  );
}

function RemoveUsageProviderButton({
  label,
  onConfirm,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The hub's management key is deleted from this server. Its accounts leave the Limits
              view; the hub itself is untouched. Add it again with the URL and key to bring them
              back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Remove hub
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
