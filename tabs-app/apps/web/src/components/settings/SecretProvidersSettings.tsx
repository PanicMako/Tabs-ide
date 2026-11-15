import {
  SecretProviderId,
  SecretProviderKind,
  type SecretProviderConfig,
  type SecretReference,
} from "@tabs/contracts";
import { builtInSecretProviderDefinitions } from "@tabs/shared/secretProviders/registry";
import { OnePasswordAccount } from "@tabs/shared/secretProviders/onePassword";
import { PlusIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { ensureNativeApi } from "~/nativeApi";
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
import { Label } from "../ui/label";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

const ONE_PASSWORD_KIND = "one_password";
const decodeAccount = Schema.decodeUnknownOption(OnePasswordAccount);

/** The stored id: readable in settings.json and unique among the providers already configured. */
function providerIdFromLabel(label: string, taken: ReadonlySet<string>): SecretProviderId {
  const slug =
    label
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "secrets";
  let candidate = slug;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${slug}-${suffix}`;
  return SecretProviderId.make(candidate);
}

function accountOf(config: SecretProviderConfig): string | undefined {
  const value = (config.config as { readonly account?: unknown } | undefined)?.account;
  return typeof value === "string" ? value : undefined;
}

/**
 * Secret providers on the connected server, such as a 1Password account. A provider environment
 * variable can then name `op://vault/item/field` instead of holding the secret, which stays in
 * 1Password and is read by the server when an instance starts.
 */
export function SecretProvidersSettings({
  readOnly = false,
}: { readonly readOnly?: boolean } = {}) {
  const providers = useSettings((settings) => settings.secretProviders) ?? {};
  const { updateSettings } = useUpdateSettings();
  const [dialog, setDialog] = useState<
    null | { readonly mode: "add" } | { readonly mode: "edit"; readonly id: SecretProviderId }
  >(null);
  const entries = Object.entries(providers) as Array<[SecretProviderId, SecretProviderConfig]>;
  const editing = dialog?.mode === "edit" ? providers[dialog.id] : undefined;

  return (
    <>
      <SettingsSection
        title="Secret providers"
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" onClick={() => setDialog({ mode: "add" })}>
              <PlusIcon className="size-3" aria-hidden />
              Add provider
            </Button>
          ) : null
        }
      >
        {entries.length === 0 ? (
          <SettingsRow
            title="No secret providers configured."
            description="Add a 1Password account, then name one of its secrets as the value of a provider variable."
          />
        ) : (
          entries.map(([id, config]) => {
            const supported = config.kind === ONE_PASSWORD_KIND;
            const account = accountOf(config);
            return (
              <SettingsRow
                key={id}
                title={config.label}
                description={
                  supported
                    ? `${builtInSecretProviderDefinitions.find(config.kind)?.label ?? "1Password"}${account ? ` · ${account}` : ""}`
                    : `Unsupported provider (${config.kind})`
                }
                control={
                  !readOnly ? (
                    <div className="flex items-center gap-1">
                      {supported ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setDialog({ mode: "edit", id })}
                        >
                          Edit
                        </Button>
                      ) : null}
                      <RemoveSecretProviderButton
                        label={config.label}
                        onConfirm={() => updateSettings({ secretProviders: { [id]: null } })}
                      />
                    </div>
                  ) : null
                }
              />
            );
          })
        )}
        {entries.length > 0 ? <CheckSecretReference providers={entries} /> : null}
      </SettingsSection>
      {dialog !== null && !readOnly && (dialog.mode === "add" || editing !== undefined) ? (
        <SecretProviderDialog
          onClose={() => setDialog(null)}
          existingIds={new Set(Object.keys(providers))}
          {...(dialog.mode === "edit" && editing !== undefined
            ? { existing: { id: dialog.id, config: editing } }
            : {})}
        />
      ) : null}
    </>
  );
}

function SecretProviderDialog({
  onClose,
  existingIds,
  existing,
}: {
  readonly onClose: () => void;
  readonly existingIds: ReadonlySet<string>;
  readonly existing?: { readonly id: SecretProviderId; readonly config: SecretProviderConfig };
}) {
  const { updateSettings } = useUpdateSettings();
  const [label, setLabel] = useState(existing?.config.label ?? "1Password");
  const [account, setAccount] = useState(existing ? (accountOf(existing.config) ?? "") : "");
  const trimmedAccount = account.trim();
  const validAccount = decodeAccount(trimmedAccount)._tag === "Some";
  const canSave = label.trim().length > 0 && validAccount;

  const save = () => {
    if (!canSave) return;
    const id = existing?.id ?? providerIdFromLabel(label, existingIds);
    // The patch names only this entry; the server merges it into its map.
    updateSettings({
      secretProviders: {
        [id]: {
          kind: SecretProviderKind.make(ONE_PASSWORD_KIND),
          label: label.trim(),
          config: { account: trimmedAccount },
        },
      },
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit 1Password account" : "Add a 1Password account"}
          </DialogTitle>
          <DialogDescription>
            The server reads secrets with the 1Password CLI (`op`). Nothing from your vault is
            stored in Tabs.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="secret-provider-label">Name</Label>
              <Input
                id="secret-provider-label"
                value={label}
                maxLength={64}
                onChange={(event) => setLabel(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="secret-provider-account">Account</Label>
              <Input
                id="secret-provider-account"
                placeholder="my.1password.com"
                autoComplete="off"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              />
              {trimmedAccount.length > 0 && !validAccount ? (
                <p className="text-xs text-destructive-foreground">
                  Use the account shorthand, sign-in address or ID, with no spaces.
                </p>
              ) : null}
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {existing ? "Save" : "Add provider"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RemoveSecretProviderButton({
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
              Provider variables that read from {label} stop resolving and their instances stay
              unavailable until you point them elsewhere. The secrets themselves are untouched.
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
              Remove provider
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

type CheckState =
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "resolved" }
  | { readonly status: "failed"; readonly detail: string };

/** Reads one secret fresh on the server and reports whether it could be read; the value never returns. */
function CheckSecretReference({
  providers,
}: {
  readonly providers: ReadonlyArray<readonly [SecretProviderId, SecretProviderConfig]>;
}) {
  const [providerId, setProviderId] = useState<SecretProviderId>(providers[0]![0]);
  const [reference, setReference] = useState("");
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const trimmed = reference.trim();
  const definition = builtInSecretProviderDefinitions.find(ONE_PASSWORD_KIND);
  const valid = definition?.isReference(trimmed) === true;

  const check = () => {
    if (!valid || state.status === "checking") return;
    const source: SecretReference = { provider: providerId, reference: trimmed };
    setState({ status: "checking" });
    void ensureNativeApi()
      .server.checkSecretSource(source)
      .then((result) =>
        setState(
          result._tag === "Resolved"
            ? { status: "resolved" }
            : { status: "failed", detail: result.detail },
        ),
      )
      .catch(() =>
        setState({ status: "failed", detail: "Could not reach the server to check this secret." }),
      );
  };

  return (
    <SettingsRow
      title="Check a secret"
      description={
        state.status === "resolved"
          ? "The server read this secret. Instances that use it were refreshed."
          : state.status === "failed"
            ? state.detail
            : (definition?.invalidReferenceMessage ?? "Paste a reference to test it.")
      }
      control={
        <div className="flex items-center gap-2">
          {providers.length > 1 ? (
            <select
              aria-label="Secret provider"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={providerId}
              onChange={(event) => setProviderId(SecretProviderId.make(event.target.value))}
            >
              {providers.map(([id, config]) => (
                <option key={id} value={id}>
                  {config.label}
                </option>
              ))}
            </select>
          ) : null}
          <Input
            aria-label="Secret reference"
            className="w-56"
            placeholder={definition?.referencePlaceholder ?? "op://vault/item/field"}
            autoComplete="off"
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
              setState({ status: "idle" });
            }}
          />
          <Button
            size="xs"
            variant="outline"
            disabled={!valid || state.status === "checking"}
            onClick={check}
          >
            {state.status === "checking" ? "Checking…" : "Check"}
          </Button>
        </div>
      }
    />
  );
}
