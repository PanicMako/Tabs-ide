import type { ServerDirectEndpoint } from "@tabs/contracts";
import { QrCode } from "@tabs/shared/qrCode";
import { CheckIcon, CopyIcon, LinkIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useConfirm } from "~/hooks/useConfirm";
import { cn } from "~/lib/utils";
import { primaryVoiceConnection } from "../../speech/primaryVoiceConnection";
import { useServerConfig } from "../../state/settings";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { toastManager } from "../ui/toast";
import {
  buildPairingLinkUrl,
  describeAccessClient,
  ENDPOINT_KIND_LABEL,
  formatCountdown,
  secondsUntil,
} from "./remoteAccess.logic";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

interface PairingLink {
  readonly id: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}
interface ClientSession {
  readonly sessionId: string;
  readonly client: {
    readonly label?: string;
    readonly deviceType?: string;
    readonly os?: string;
    readonly browser?: string;
  };
  readonly lastConnectedAt: string | null;
  readonly issuedAt: string;
  readonly connected: boolean;
  readonly current: boolean;
}
interface FreshLink {
  readonly url: string;
  readonly expiresAt: string;
}

const REFRESH_MS = 10_000;

/** Calls this window's own server, on the same connection voice input uses. */
async function accessRequest<T>(path: string, init?: { method: "POST"; body?: unknown }) {
  const connection = await primaryVoiceConnection();
  const response = await fetch(new URL(path, connection.httpBaseUrl), {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(connection.httpAuthorization?._tag === "Bearer"
        ? { Authorization: `Bearer ${connection.httpAuthorization.token}` }
        : {}),
    },
    ...(init ? { body: JSON.stringify(init.body ?? {}) } : {}),
    credentials: "include",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  return (await response.json()) as T;
}

function fail(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "Try again.",
  });
}

function QrImage({ value }: { readonly value: string }) {
  const cells = useMemo(() => {
    const qr = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
    const path: string[] = [];
    for (let y = 0; y < qr.size; y += 1)
      for (let x = 0; x < qr.size; x += 1)
        if (qr.getModule(x, y)) path.push(`M${x + 2},${y + 2}h1v1h-1z`);
    return { size: qr.size + 4, path: path.join("") };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label="Pairing link QR code"
      viewBox={`0 0 ${cells.size} ${cells.size}`}
      shapeRendering="crispEdges"
      className="size-36 shrink-0 rounded-[var(--radius-tile)] bg-white"
    >
      <path d={cells.path} fill="#111" />
    </svg>
  );
}

function CopyButton({ text, label }: { readonly text: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
    >
      {copied ? <CheckIcon className="size-3.5 mr-2" /> : <CopyIcon className="size-3.5 mr-2" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function PairingCard({ fresh }: { readonly fresh: FreshLink }) {
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ticks the visible countdown while the link is on screen
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const left = secondsUntil(fresh.expiresAt, now);
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <div className={cn("transition-opacity", left === 0 && "opacity-30")}>
        <QrImage value={fresh.url} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[13px] font-medium text-foreground">
          {left > 0 ? "Scan with the other device, or open the link there." : "This link expired."}
        </p>
        <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
          {fresh.url}
        </p>
        <div className="flex items-center gap-2">
          {left > 0 ? <CopyButton text={fresh.url} label="Copy link" /> : null}
          <span className="text-[11px] tabular-nums text-muted-foreground/80">
            {left > 0 ? `Works once, for ${formatCountdown(left)} more` : "Make a new one below."}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Lets this machine be opened from a phone or another laptop, and shows who has been let in. */
export function RemoteAccessSection() {
  const config = useServerConfig();
  const endpoints: ReadonlyArray<ServerDirectEndpoint> = config?.directEndpoints ?? [];
  const [endpointUrl, setEndpointUrl] = useState<string | null>(null);
  const chosen = endpointUrl ?? endpoints[0]?.httpBaseUrl ?? null;
  const [fresh, setFresh] = useState<FreshLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [links, setLinks] = useState<ReadonlyArray<PairingLink>>([]);
  const [clients, setClients] = useState<ReadonlyArray<ClientSession>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const refresh = useCallback(async () => {
    try {
      const [nextLinks, nextClients] = await Promise.all([
        accessRequest<PairingLink[]>("/api/auth/pairing-links"),
        accessRequest<ClientSession[]>("/api/auth/clients"),
      ]);
      setLinks(nextLinks);
      setClients(nextClients);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load access.");
    }
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the server for who is paired while this page is open
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const createLink = async () => {
    if (!chosen) return;
    setCreating(true);
    try {
      const result = await accessRequest<{ credential: string; expiresAt: string }>(
        "/api/auth/pairing-token",
        { method: "POST", body: {} },
      );
      setFresh({
        url: buildPairingLinkUrl(chosen, result.credential),
        expiresAt: result.expiresAt,
      });
      void refresh();
    } catch (error) {
      fail("Could not make a pairing link", error);
    } finally {
      setCreating(false);
    }
  };

  const revokeLink = async (id: string) => {
    try {
      await accessRequest("/api/auth/pairing-links/revoke", { method: "POST", body: { id } });
      setLinks((current) => current.filter((link) => link.id !== id));
    } catch (error) {
      fail("Could not revoke the link", error);
    }
  };

  const revokeClient = async (client: ClientSession) => {
    const { name } = describeAccessClient(client.client);
    if (!(await confirm(`Sign ${name} out?\n\nIt will need a new pairing link to come back.`)))
      return;
    try {
      await accessRequest("/api/auth/clients/revoke", {
        method: "POST",
        body: { sessionId: client.sessionId },
      });
      setClients((current) => current.filter((entry) => entry.sessionId !== client.sessionId));
    } catch (error) {
      fail("Could not sign that device out", error);
    }
  };

  const others = clients.filter((client) => !client.current);
  const revokeOthers = async () => {
    if (
      !(await confirm(`Sign out ${others.length} other device${others.length === 1 ? "" : "s"}?`))
    )
      return;
    try {
      await accessRequest("/api/auth/clients/revoke-others", { method: "POST" });
      void refresh();
    } catch (error) {
      fail("Could not sign the other devices out", error);
    }
  };

  return (
    <SettingsSection
      title="Let another device in"
      description="Open Tabs from your phone or another laptop. Each pairing link works once and expires quickly."
    >
      {confirmDialog}
      <SettingsRow
        title="Address"
        description={
          endpoints.length > 0
            ? "The address the other device will reach this machine at."
            : "This server only listens on this machine. Start it on your network or Tailscale to share it."
        }
        control={
          endpoints.length > 0 ? (
            <Select
              value={chosen ?? ""}
              onValueChange={(value) => {
                if (value) {
                  setEndpointUrl(value);
                  setFresh(null);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Address" className="min-w-52 max-w-72">
                <span className="min-w-0 truncate">
                  {chosen
                    ? `${ENDPOINT_KIND_LABEL[endpoints.find((entry) => entry.httpBaseUrl === chosen)?.kind ?? ""] ?? "Address"} · ${new URL(chosen).host}`
                    : "Choose"}
                </span>
              </SelectTrigger>
              <SelectPopup align="end">
                {endpoints.map((entry) => (
                  <SelectItem key={entry.httpBaseUrl} value={entry.httpBaseUrl}>
                    {ENDPOINT_KIND_LABEL[entry.kind] ?? entry.kind} ·{" "}
                    {new URL(entry.httpBaseUrl).host}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null
        }
      />
      <SettingsRow
        title="Pairing link"
        description="Scan it or open it on the new device to sign it in."
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={!chosen || creating}
            onClick={() => void createLink()}
          >
            {creating ? (
              <LoaderCircleIcon className="size-3.5 mr-2 animate-spin" />
            ) : (
              <LinkIcon className="size-3.5 mr-2" />
            )}
            {fresh ? "Make another" : "Make a link"}
          </Button>
        }
      />
      {fresh ? <PairingCard fresh={fresh} /> : null}

      {links.length > 0 ? (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <div className="pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Waiting to be used
          </div>
          <ul className="divide-y divide-border/60">
            {links.map((link) => (
              <li key={link.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[12.5px] font-medium text-foreground/90">
                    {link.label ?? "Pairing link"}
                  </div>
                  <div className="text-[11px] text-muted-foreground/80">
                    Made {formatRelativeTimeLabel(link.createdAt)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label="Revoke this link"
                  onClick={() => void revokeLink(link.id)}
                >
                  <XIcon className="size-3.5 mr-1" />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-t border-border px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3 pb-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Paired devices
          </span>
          {others.length > 1 ? (
            <Button variant="ghost" size="xs" onClick={() => void revokeOthers()}>
              Sign out all others
            </Button>
          ) : null}
        </div>
        {loadError ? (
          <p role="alert" className="py-2 text-[12px] text-destructive">
            {loadError}
          </p>
        ) : clients.length === 0 ? (
          <p className="py-2 text-[12px] text-muted-foreground/80">Nothing is paired yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {clients.map((client) => {
              const { name, detail } = describeAccessClient(client.client);
              return (
                <li key={client.sessionId} className="flex items-center gap-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      client.connected ? "bg-foreground/70" : "bg-foreground/20",
                    )}
                  />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] font-medium text-foreground/90">
                        {name}
                      </span>
                      {client.current ? (
                        <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">
                          This device
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground/80">
                      {[
                        detail,
                        client.connected
                          ? "Connected now"
                          : client.lastConnectedAt
                            ? `Last seen ${formatRelativeTimeLabel(client.lastConnectedAt)}`
                            : `Paired ${formatRelativeTimeLabel(client.issuedAt)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {client.current ? null : (
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Sign ${name} out`}
                      onClick={() => void revokeClient(client)}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}
