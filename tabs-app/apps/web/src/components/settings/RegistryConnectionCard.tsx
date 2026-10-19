import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react";
import type { DesktopBridge } from "@tabs/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
export interface RegistryConnection {
  origin: string | null;
  connected: boolean;
  trusted?: boolean;
  managed?: boolean;
}
export function RegistryConnectionCard({
  bridge,
  connection,
  open,
  onOpenChange,
  onConnected,
  busy: parentBusy,
}: {
  bridge: DesktopBridge | undefined;
  connection: RegistryConnection | null;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onConnected: (value: RegistryConnection) => void;
  busy: boolean;
}) {
  const [origin, setOrigin] = useState(connection?.origin ?? "https://exchange.buildwithtabs.com");
  const [root, setRoot] = useState("");
  const [rootName, setRootName] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [pin, setPin] = useState("");
  const [trustId, setTrustId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const rootInput = useRef<HTMLInputElement>(null),
    connectionInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setConfirmation("");
      setError(null);
    } else {
      setToken("");
    }
  }, [open]);
  async function readFile(file: File | undefined, kind: "root" | "connection") {
    setError(null);
    if (!file) return;
    if (kind === "root") {
      setRoot("");
      setRootName("");
    } else {
      setSettingsName("");
      setPin("");
      setTrustId("");
      setConfirmation("");
    }
    try {
      if (file.size > 512 * 1024) throw new Error("Choose a JSON file smaller than 512 KB.");
      const text = await file.text();
      const value = JSON.parse(text);
      if (kind === "root") {
        if (value.signed?._type !== "root" || !Array.isArray(value.signatures))
          throw new Error("Choose the public root.json file, not your encrypted signing backup.");
        setRoot(text);
        setRootName(file.name);
      } else {
        if (
          typeof value.TABS_EXCHANGE_ORIGIN !== "string" ||
          typeof value.TABS_EXCHANGE_TRUST_ROOT_SHA256 !== "string" ||
          typeof value.TABS_EXCHANGE_TRUST_ID !== "string"
        )
          throw new Error("Choose the desktop connection settings downloaded from Release studio.");
        setSettingsName(file.name);
        setOrigin(value.TABS_EXCHANGE_ORIGIN);
        setPin(value.TABS_EXCHANGE_TRUST_ROOT_SHA256);
        setTrustId(value.TABS_EXCHANGE_TRUST_ID);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this file.");
    }
  }
  async function connect() {
    if (busy || parentBusy) return;
    setError(null);
    setBusy(true);
    try {
      if (!bridge?.configureRegistryConnection)
        throw new Error(
          "Update Tabs to a version with guided Exchange setup. This older desktop build cannot save a connection from Settings.",
        );
      const trimmed = origin.trim();
      if (confirmation.trim() !== trimmed)
        throw new Error("Type the exact registry address to confirm this connection.");
      const value = await bridge.configureRegistryConnection({
        origin: trimmed,
        root,
        rootSha256: pin.trim(),
        trustId: trustId.trim() || `registry-${pin.trim().slice(0, 16)}`,
        confirmOrigin: confirmation.trim(),
      });
      onConnected(value);
      onOpenChange(false);
      setNotice("Exchange connected. You can now review and install signed extensions.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the connection.");
    } finally {
      setBusy(false);
    }
  }
  if (!bridge) return null;
  return (
    <>
      <section
        className={`extension-connection ${connection?.trusted ? "is-connected" : ""}`}
        aria-labelledby="registry-connection-title"
      >
        <div className="extension-connection-mark" aria-hidden="true">
          {connection?.trusted ? <ShieldCheckIcon /> : <KeyRoundIcon />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="registry-connection-title">
            {connection?.trusted
              ? "Connected to Exchange"
              : "One connection. Your next workspace tool."}
          </h3>
          <p>
            {connection?.trusted
              ? connection.origin
              : "Browse published extensions below. Connect your registry’s public trust file when you’re ready to install."}
          </p>
        </div>
        <Button
          variant={connection?.trusted ? "outline" : "default"}
          disabled={parentBusy}
          onClick={() => {
            setOrigin(connection?.origin ?? "https://exchange.buildwithtabs.com");
            setError(null);
            onOpenChange(true);
          }}
        >
          {connection?.trusted ? "Connection settings" : "Connect Exchange"}
        </Button>
      </section>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) onOpenChange(value);
        }}
      >
        <DialogPopup className="max-w-xl" aria-describedby="registry-setup-description">
          <DialogHeader>
            <DialogTitle>Connect your Exchange</DialogTitle>
            <DialogDescription id="registry-setup-description">
              Choose the registry you trust. Public trust files contain no passwords or private
              signing keys.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-5 overflow-y-auto px-6 pb-5">
            {connection?.managed ? (
              <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
                This connection is managed by desktop environment settings. You can view its address
                and manage a private read token here; update those settings to change its trust
                identity.
              </p>
            ) : (
              <>
                <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
                  <strong>Two public files. One connection.</strong>
                  <p className="mt-1 text-muted-foreground">
                    In Exchange, open Review desk → Releases. Download <b>root.json</b> and{" "}
                    <b>desktop connection settings</b>. Never choose the signing backup.
                  </p>
                  <Button
                    variant="link"
                    className="mt-2 h-auto p-0"
                    onClick={() =>
                      void bridge.openExternal("https://exchange.buildwithtabs.com/admin/releases")
                    }
                  >
                    Open Release studio <ArrowUpRightIcon className="size-3" />
                  </Button>
                </div>
                <input
                  ref={connectionInput}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  aria-label="Desktop connection settings file"
                  onChange={(event) => void readFile(event.target.files?.[0], "connection")}
                />
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => connectionInput.current?.click()}
                >
                  <UploadIcon className="size-4" />
                  1. Import connection settings
                </Button>
                {settingsName && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Settings imported: {settingsName}
                  </p>
                )}
                <div className="space-y-2">
                  <p className="text-sm font-medium">2. Choose the public trust file</p>
                  <input
                    ref={rootInput}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    aria-label="Public root.json file"
                    onChange={(event) => void readFile(event.target.files?.[0], "root")}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => rootInput.current?.click()}
                    >
                      <UploadIcon className="size-4" />
                      Choose root.json
                    </Button>
                    <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {rootName || "No file selected"}
                    </span>
                  </div>
                </div>
                <details className="rounded-xl border border-border p-4 text-sm">
                  <summary className="cursor-pointer font-medium">Connection details</summary>
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="exchange-setup-origin" className="text-sm font-medium">
                        Registry address
                      </label>
                      <Input
                        id="exchange-setup-origin"
                        value={origin}
                        onChange={(event) => setOrigin(event.target.value)}
                        disabled={busy}
                        placeholder="https://exchange.buildwithtabs.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="exchange-setup-pin" className="text-sm font-medium">
                        Trust fingerprint
                      </label>
                      <Input
                        id="exchange-setup-pin"
                        value={pin}
                        onChange={(event) => setPin(event.target.value)}
                        disabled={busy}
                        maxLength={64}
                        placeholder="Paste the SHA-256 from Release studio"
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Imported settings fill this in. Tabs checks that the public file matches
                        before saving.
                      </p>
                    </div>
                  </div>
                </details>
                <div className="space-y-2">
                  <label htmlFor="exchange-setup-confirm" className="text-sm font-medium">
                    3. Confirm this registry
                  </label>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    Type {origin.trim()} to allow signed installations from this registry.
                    Connecting does not install or enable an extension.
                  </p>
                  <Input
                    id="exchange-setup-confirm"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                  />
                </div>
              </>
            )}
            <details className="rounded-xl border border-border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Private registry access{" "}
                <span className="font-normal text-muted-foreground">· optional</span>
              </summary>
              <p className="my-3 text-xs text-muted-foreground">
                Public Exchange needs no login or token. Only add a read token if your operator runs
                a private registry; it does not replace the public trust file.
              </p>
              <label htmlFor="registry-read-token" className="text-sm">
                Private registry read token
              </label>
              <Input
                id="registry-read-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={busy}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !token || !connection?.origin || !bridge.setRegistryCredential}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await bridge.setRegistryCredential!(connection!.origin!, token);
                      setToken("");
                      onConnected(await bridge.getRegistryConnection!());
                      setNotice("Private read credential saved.");
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : "Could not save credential.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save read credential
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !connection?.connected || !bridge.setRegistryCredential}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await bridge.setRegistryCredential!(connection!.origin!, null);
                      onConnected(await bridge.getRegistryConnection!());
                      setNotice("Private read credential removed.");
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : "Could not remove credential.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove saved credential
                </Button>
              </div>
            </details>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {connection?.trusted && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckIcon className="size-4" />
                Signed installation is configured.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {!connection?.managed && (
              <Button
                disabled={busy || !root || !pin || confirmation.trim() !== origin.trim()}
                onClick={() => void connect()}
              >
                {busy ? "Checking connection…" : "Trust & connect"}
              </Button>
            )}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
