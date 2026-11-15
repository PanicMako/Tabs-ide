import {
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type SecretProviderId,
} from "@tabs/contracts";
import { builtInSecretProviderDefinitions } from "@tabs/shared/secretProviders/registry";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useSettings } from "../../hooks/useSettings";
import { ensureNativeApi } from "~/nativeApi";
import { refreshServerConfig } from "~/state/settings";
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
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  environmentFromRows,
  newEnvironmentRow,
  rowError,
  rowsFromEnvironment,
  type EnvironmentRow,
} from "./providerEnvironment.logic";

const ONE_PASSWORD_KIND = "one_password";

/**
 * Edits the environment variables a provider instance starts with. A value is typed in, or read
 * from a secret provider by reference so the secret never lands in settings.
 */
export function ProviderEnvironmentDialog(props: {
  readonly instanceId: string;
  readonly instance: ProviderInstanceConfig;
  readonly onClose: () => void;
}) {
  const secretProviders = useSettings((settings) => settings.secretProviders) ?? {};
  const providerIds = Object.keys(secretProviders) as Array<SecretProviderId>;
  const firstProvider = providerIds[0];
  const definition = builtInSecretProviderDefinitions.find(ONE_PASSWORD_KIND);
  const isReference = (value: string) => definition?.isReference(value) === true;
  const previous = props.instance.environment ?? [];
  const [rows, setRows] = useState<ReadonlyArray<EnvironmentRow>>(() =>
    rowsFromEnvironment(previous),
  );
  const [saving, setSaving] = useState(false);

  const update = (id: string, patch: Partial<EnvironmentRow>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const errors = rows.map((row) => rowError(rows, row, isReference, firstProvider !== undefined));
  const invalid = errors.some((error) => error !== null);

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    try {
      await ensureNativeApi().server.mutateProviderInstance({
        operation: "upsert",
        instanceId: ProviderInstanceId.make(props.instanceId),
        instance: {
          ...props.instance,
          environment: environmentFromRows(rows, firstProvider, previous),
        },
      });
      await refreshServerConfig();
      props.onClose();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not save variables",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Environment variables</DialogTitle>
          <DialogDescription>
            Set for this agent when it starts. Paste an{" "}
            <code className="text-xs">op://vault/item/field</code> reference to read a value from
            your secret provider instead of storing it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-3">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No variables yet.</p>
            ) : null}
            {rows.map((row, index) => (
              <div key={row.id} className="grid gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="Variable name"
                    className="w-44 font-mono text-xs"
                    placeholder="NAME"
                    autoComplete="off"
                    value={row.name}
                    onChange={(event) => update(row.id, { name: event.target.value })}
                  />
                  {row.secret !== "" || row.value === "" ? (
                    <Input
                      aria-label="Secret reference"
                      className="min-w-0 flex-1 font-mono text-xs"
                      placeholder={definition?.referencePlaceholder ?? "op://vault/item/field"}
                      autoComplete="off"
                      value={row.secret}
                      onChange={(event) => update(row.id, { secret: event.target.value })}
                    />
                  ) : null}
                  {row.secret === "" ? (
                    <Input
                      aria-label="Variable value"
                      className="min-w-0 flex-1 font-mono text-xs"
                      type={row.sensitive ? "password" : "text"}
                      placeholder="Value"
                      autoComplete="off"
                      value={row.value}
                      onChange={(event) => update(row.id, { value: event.target.value })}
                    />
                  ) : null}
                  <Switch
                    aria-label="Hide value"
                    checked={row.sensitive}
                    onCheckedChange={(checked) => update(row.id, { sensitive: checked })}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove variable"
                    onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
                {errors[index] ? (
                  <p className="text-xs text-destructive-foreground">{errors[index]}</p>
                ) : null}
              </div>
            ))}
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRows((current) => [...current, newEnvironmentRow()])}
              >
                <PlusIcon className="mr-1.5 size-3.5" />
                Add variable
              </Button>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={invalid || saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
