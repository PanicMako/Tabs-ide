import { PartnerCenterRegistrationId, type NativeApi } from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useConfirm } from "../../hooks/useConfirm";
import { readNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow } from "./SettingsLayout";

type ConnectionRequest = NativeApi["preview"]["partnerCenterConnection"];
const isRegistrationId = Schema.is(PartnerCenterRegistrationId);

export function PartnerCenterConnectionSettings() {
  if (typeof window === "undefined" || !window.desktopBridge) return null;
  // A desktop window can be routed to a saved environment by these parameters.
  const params = new URLSearchParams(window.location.search);
  if (params.has("tabsWsUrl") || params.has("tabsEnvironmentId")) return null;
  if (!window.desktopBridge.getWsUrl?.()) return null;

  const request = readNativeApi()?.preview?.partnerCenterConnection;
  return request ? <PartnerCenterConnectionRow request={request} /> : null;
}

function PartnerCenterConnectionRow({ request }: { request: ConnectionRequest }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readGeneration = useRef(0);
  const clientSecretInput = useRef<HTMLInputElement>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  const readStatus = useCallback(async () => {
    const generation = ++readGeneration.current;
    setError(null);
    try {
      const result = await request({ action: "read" });
      if (generation === readGeneration.current) setConfigured(result.configured);
    } catch {
      if (generation === readGeneration.current) {
        setError("Could not read the Partner Center connection.");
      }
    }
  }, [request]);

  useEffect(() => {
    void readStatus();
    return () => {
      ++readGeneration.current;
    };
  }, [readStatus]);

  function closeEditor() {
    if (clientSecretInput.current) clientSecretInput.current.value = "";
    setEditing(false);
    setError(null);
    connectButton.current?.focus();
  }

  async function changeConnection(input: Parameters<ConnectionRequest>[0]) {
    setBusy(true);
    setError(null);
    try {
      setConfigured((await request(input)).configured);
      if (input.action === "configure") closeEditor();
    } catch {
      setError(
        input.action === "configure"
          ? "Could not save the Partner Center connection. Re-enter the client secret and try again."
          : "Could not disconnect Partner Center. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !clientSecretInput.current) return;
    const fields = new FormData(event.currentTarget);
    const tenantId = String(fields.get("tenantId") ?? "").trim();
    const clientId = String(fields.get("clientId") ?? "").trim();
    const clientSecret = clientSecretInput.current.value;
    clientSecretInput.current.value = "";
    if (!isRegistrationId(tenantId) || !isRegistrationId(clientId) || !clientSecret.trim()) {
      setError("Enter valid Entra tenant and application IDs and a client secret value.");
      return;
    }
    void changeConnection({
      action: "configure",
      connection: { tenantId, clientId, clientSecret },
    });
  }

  async function disconnect() {
    if (await confirm("Disconnect Partner Center and remove the saved app credentials?")) {
      await changeConnection({ action: "clear" });
    }
  }

  return (
    <SettingsRow
      title="Microsoft Partner Center"
      description="Use an Entra app to look up Microsoft Store submission status in browser workflows."
      status={
        <>
          <span role="status">
            {configured === null
              ? error
                ? null
                : "Checking connection…"
              : configured
                ? "Configured"
                : "Not configured"}
          </span>
          {error && !editing ? <p role="alert">{error}</p> : null}
        </>
      }
      control={
        configured === null ? (
          error && (
            <Button size="sm" variant="outline" onClick={() => void readStatus()}>
              Try again
            </Button>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {configured ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={editing || busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
            ) : null}
            <Button
              ref={connectButton}
              size="sm"
              variant="outline"
              aria-expanded={editing}
              aria-disabled={busy}
              onClick={() => {
                if (busy) return;
                setError(null);
                setEditing(true);
              }}
            >
              {configured ? "Reconnect" : "Connect"}
            </Button>
          </div>
        )
      }
    >
      {editing ? (
        <form autoComplete="off" noValidate className="mt-4 max-w-md space-y-3" onSubmit={save}>
          <p className="text-xs text-muted-foreground">
            Associate the Entra app with your Partner Center account and copy the client secret
            value when you create it.{" "}
            <a
              href="https://learn.microsoft.com/en-us/windows/uwp/monetize/create-and-manage-submissions-using-windows-store-services"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              Microsoft setup instructions
            </a>
          </p>
          <label className="block space-y-1.5 text-xs font-medium">
            <span>Directory (tenant) ID</span>
            <Input name="tenantId" autoFocus required disabled={busy} />
          </label>
          <label className="block space-y-1.5 text-xs font-medium">
            <span>Application (client) ID</span>
            <Input name="clientId" required disabled={busy} />
          </label>
          <label className="block space-y-1.5 text-xs font-medium">
            <span>Client secret</span>
            <Input
              ref={clientSecretInput}
              type="password"
              required
              maxLength={2048}
              disabled={busy}
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={closeEditor}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save connection"}
            </Button>
          </div>
        </form>
      ) : null}
      {confirmDialog}
    </SettingsRow>
  );
}
