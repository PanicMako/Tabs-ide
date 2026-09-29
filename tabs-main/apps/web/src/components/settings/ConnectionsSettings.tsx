import type { DesktopSshPasswordPromptRequest } from "@tabs/contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { SettingsSection } from "./SettingsLayout";
import { toastManager } from "~/components/ui/toast";
import { useConfirm } from "~/hooks/useConfirm";
import { useTheme } from "~/hooks/useTheme";
import { getActiveFontCombo } from "~/lib/themes";
import {
  Link2Icon,
  MonitorIcon,
  ShieldCheckIcon,
  InfoIcon,
  LockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TerminalIcon,
  PlusIcon,
  Trash2Icon,
  LoaderCircleIcon,
} from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogClose,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import {
  listManualConnections,
  registerManualRemote,
  registerManualSsh,
  removeManualConnection,
  type SavedManualConnection,
} from "~/connection/manualConnections";
import {
  connectEnvironmentApi,
  connectedEnvironmentIds,
  disconnectEnvironmentApi,
} from "~/connection/environmentApiRegistry";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { ManagedCloudConnections } from "./ManagedCloudConnections";
import {
  validateRemoteHost,
  validateSshPort,
  validateSshTarget,
} from "~/connection/connectionInputValidation";

interface TailscaleStatus {
  available: boolean;
  running: boolean;
  magicDnsName: string | null;
  ipv4: string | null;
}

export function ConnectionsSettings() {
  const isDesktop = typeof window !== "undefined" && !!window.desktopBridge;
  const { confirm, confirmDialog } = useConfirm();
  const { fontPreferences } = useTheme();
  const activeFontCombo = getActiveFontCombo(fontPreferences);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus>({
    available: false,
    running: false,
    magicDnsName: null,
    ipv4: null,
  });
  const [isLoadingTailscale, setIsLoadingTailscale] = useState(true);

  // Wizard States
  const [guideStep, setGuideStep] = useState(1);
  const [httpsStep, setHttpsStep] = useState(1);

  // Add Environment Dialog Form States
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"remote" | "ssh">("remote");
  const [remoteHost, setRemoteHost] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [savedConnections, setSavedConnections] = useState<readonly SavedManualConnection[]>([]);
  const [connectedIds, setConnectedIds] = useState<ReadonlySet<string>>(
    () => new Set(connectedEnvironmentIds()),
  );
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const connectionInFlightRef = useRef(false);
  const [sshPasswordPrompts, setSshPasswordPrompts] = useState<
    readonly DesktopSshPasswordPromptRequest[]
  >([]);
  const [sshPassword, setSshPassword] = useState("");

  // Load Tailscale status
  useEffect(() => {
    const fetchTailscale = async () => {
      if (!isDesktop) {
        setIsLoadingTailscale(false);
        return;
      }
      try {
        const status = await window.desktopBridge!.getTailscaleStatus();
        setTailscaleStatus(status);
      } catch {
        // Keep default state
      } finally {
        setIsLoadingTailscale(false);
      }
    };

    fetchTailscale();
    const interval = setInterval(fetchTailscale, 10000);
    return () => clearInterval(interval);
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop) return;
    void listManualConnections()
      .then(setSavedConnections)
      .catch(() => undefined);
    return window.desktopBridge!.onSshPasswordPrompt((request) => {
      setSshPasswordPrompts((current) =>
        current.some((prompt) => prompt.requestId === request.requestId)
          ? current
          : [...current, request],
      );
    });
  }, [isDesktop]);

  const activeSshPasswordPrompt = sshPasswordPrompts[0] ?? null;

  const resolveActiveSshPasswordPrompt = (password: string | null) => {
    if (!activeSshPasswordPrompt || !window.desktopBridge) return;
    const requestId = activeSshPasswordPrompt.requestId;
    setSshPasswordPrompts((current) =>
      current.filter((request) => request.requestId !== requestId),
    );
    setSshPassword("");
    void window.desktopBridge
      .resolveSshPasswordPrompt(requestId, password)
      .then((resolved) => {
        if (resolved) return;
        toastManager.add({
          type: "error",
          title: "SSH password request expired",
          description: "Try connecting to the environment again.",
        });
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not answer SSH password request",
          description: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const openUrl = (url: string) => {
    if (typeof window !== "undefined" && window.desktopBridge) {
      window.desktopBridge.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  };

  const handleAddEnvironment = async () => {
    if (connectionInFlightRef.current) return;
    const validationError =
      addMode === "remote"
        ? validateRemoteHost(remoteHost) || (!pairingCode.trim() ? "Enter the pairing code." : null)
        : validateSshTarget(sshHost) || validateSshPort(sshPort);
    if (validationError) {
      toastManager.add({
        type: "error",
        title: "Check connection details",
        description: validationError,
      });
      return;
    }
    connectionInFlightRef.current = true;
    setIsSavingConnection(true);
    try {
      if (addMode === "remote") {
        await registerManualRemote({ host: remoteHost, pairingCode });
      } else {
        const at = sshHost.lastIndexOf("@");
        const hostname = at >= 0 ? sshHost.slice(at + 1) : sshHost;
        const username = at >= 0 ? sshHost.slice(0, at) : null;
        await registerManualSsh({
          alias: sshHost,
          hostname,
          username,
          port: Number.parseInt(sshPort, 10),
        });
      }
      setSavedConnections(await listManualConnections());
      toastManager.add({
        type: "success",
        title: "Environment connected",
        description: "The remote environment was verified and saved.",
      });
      setIsAddOpen(false);
      setRemoteHost("");
      setPairingCode("");
      setSshHost("");
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not connect environment",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      connectionInFlightRef.current = false;
      setIsSavingConnection(false);
    }
  };

  const isTailscaleReady = tailscaleStatus.available && tailscaleStatus.running;

  return (
    <div className="space-y-6">
      {confirmDialog}

      <Dialog
        open={activeSshPasswordPrompt !== null}
        onOpenChange={(open) => {
          if (!open) resolveActiveSshPasswordPrompt(null);
        }}
      >
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>SSH authentication</DialogTitle>
            <DialogDescription>
              Enter the password for{" "}
              <span className="font-medium text-foreground">
                {activeSshPasswordPrompt?.username ? activeSshPasswordPrompt.username + "@" : ""}
                {activeSshPasswordPrompt?.destination}
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                resolveActiveSshPasswordPrompt(sshPassword);
              }}
            >
              <div className="space-y-2">
                <label htmlFor="ssh-password" className="text-xs font-semibold text-foreground">
                  {activeSshPasswordPrompt?.prompt || "Password"}
                </label>
                <Input
                  id="ssh-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={sshPassword}
                  onChange={(event) => setSshPassword(event.target.value)}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Your password is sent directly to the local SSH process and is not saved by Tabs.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-4">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => resolveActiveSshPasswordPrompt(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={sshPassword.length === 0}>
                  Continue
                </Button>
              </div>
            </form>
          </DialogPanel>
        </DialogContent>
      </Dialog>

      <div>
        <div className="space-y-1.5">
          <h2
            className={cn(
              "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
              activeFontCombo.sansClass,
            )}
            style={{ fontFamily: "var(--font-sans)", textTransform: "capitalize" }}
          >
            Connections
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure network access, Tailscale HTTPS tunnels, and remote environment connections.
          </p>
        </div>
        <div
          className="h-[5px] w-full my-5 rounded-full dark:block hidden"
          style={{ background: "linear-gradient(to right, rgba(255,255,255,0.25), transparent)" }}
        />
        <div
          className="h-[5px] w-full my-5 rounded-full dark:hidden block"
          style={{ background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)" }}
        />
      </div>

      <SettingsSection title="This Environment">
        {/* Tailscale Row */}
        <div className="border-t border-border/60 px-4 py-4 first:border-t-0 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
                    <Link2Icon className="size-4.5 text-foreground/80" />
                  </span>
                  <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                    Tailscale HTTPS
                  </span>
                </div>
                <Dialog
                  onOpenChange={(open) => {
                    if (open) setHttpsStep(1);
                  }}
                >
                  <DialogTrigger
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="size-6 text-muted-foreground hover:text-foreground p-0 rounded-full flex items-center justify-center"
                      >
                        <InfoIcon className="size-4" />
                      </Button>
                    }
                  />
                  <DialogContent className="max-w-[520px]">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-[18px]">
                        <Link2Icon className="size-5 text-primary" />
                        Tailscale HTTPS
                      </DialogTitle>
                      <DialogDescription className="text-[13px]">
                        Concept Guide — Step {httpsStep} of 3
                      </DialogDescription>
                    </DialogHeader>
                    <DialogPanel className="space-y-6 pt-5 pb-3">
                      {httpsStep === 1 && (
                        <div className="space-y-4 text-center py-4">
                          <div className="mx-auto size-16 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                            <ShieldCheckIcon className="size-8" />
                          </div>
                          <div className="space-y-2">
                            <h4 className="text-[16px] font-bold text-foreground">
                              1. Private Mesh Network (Tailnet)
                            </h4>
                            <p className="text-[13px] text-muted-foreground leading-relaxed px-6">
                              Tailscale links your devices together in a secure peer-to-peer virtual
                              private network. All connections are end-to-end encrypted using
                              WireGuard.
                            </p>
                          </div>
                        </div>
                      )}

                      {httpsStep === 2 && (
                        <div className="space-y-4 text-center py-4">
                          <div className="mx-auto size-16 rounded-full bg-info/10 flex items-center justify-center border border-info/20 text-info">
                            <MonitorIcon className="size-8" />
                          </div>
                          <div className="space-y-2">
                            <h4 className="text-[16px] font-bold text-foreground">
                              2. MagicDNS Mapping
                            </h4>
                            <p className="text-[13px] text-muted-foreground leading-relaxed px-6">
                              MagicDNS automatically translates dynamic IP addresses into clean,
                              stable, human-readable hostnames (e.g.{" "}
                              <code className="bg-muted px-1.5 py-0.5 rounded text-[12px] font-mono text-foreground font-semibold">
                                my-server.ts.net
                              </code>
                              ).
                            </p>
                          </div>
                        </div>
                      )}

                      {httpsStep === 3 && (
                        <div className="space-y-4 text-center py-4">
                          <div className="mx-auto size-16 rounded-full bg-success/10 flex items-center justify-center border border-success/20 text-success">
                            <LockIcon className="size-8" />
                          </div>
                          <div className="space-y-2">
                            <h4 className="text-[16px] font-bold text-foreground">
                              3. Private SSL Certificates
                            </h4>
                            <p className="text-[13px] text-muted-foreground leading-relaxed px-6">
                              Tailscale provisions trusted Let's Encrypt certificates directly for
                              your MagicDNS domain name. This enables fully verified, private HTTPS
                              inside your browser.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Navigation Controls */}
                      <div className="flex items-center justify-between pt-5 border-t border-border/40">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setHttpsStep((s) => Math.max(1, s - 1))}
                          className={cn(
                            "text-xs h-8 gap-1 pl-1.5 pr-2.5",
                            httpsStep === 1 && "invisible",
                          )}
                        >
                          <ChevronLeftIcon className="size-4" />
                          Back
                        </Button>

                        {/* Pagination Dots */}
                        <div className="flex items-center gap-1.5">
                          {[1, 2, 3].map((step) => (
                            <span
                              key={step}
                              onClick={() => setHttpsStep(step)}
                              className={cn(
                                "size-1.5 rounded-full transition-all cursor-pointer",
                                httpsStep === step
                                  ? "bg-primary scale-125"
                                  : "bg-muted-foreground/30 hover:bg-muted-foreground/50",
                              )}
                            />
                          ))}
                        </div>

                        {httpsStep < 3 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHttpsStep((s) => Math.min(3, s + 1))}
                            className="text-xs h-8 gap-1 pl-2.5 pr-1.5"
                          >
                            Next
                            <ChevronRightIcon className="size-4" />
                          </Button>
                        ) : (
                          <DialogClose
                            render={
                              <Button size="sm" variant="secondary" className="text-xs h-8">
                                Finish
                              </Button>
                            }
                          />
                        )}
                      </div>
                    </DialogPanel>
                  </DialogContent>
                </Dialog>
              </div>
              <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-xl mt-1">
                {isLoadingTailscale
                  ? "Checking Tailscale status..."
                  : !tailscaleStatus.available
                    ? "Install Tailscale to enable secure peer-to-peer HTTPS access."
                    : !tailscaleStatus.running
                      ? "Start Tailscale to activate secure HTTPS routing."
                      : "Securely connected to Tailnet via MagicDNS. Domain: "}
                {tailscaleStatus.running && tailscaleStatus.magicDnsName && (
                  <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono font-semibold">
                    {tailscaleStatus.magicDnsName}
                  </code>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isLoadingTailscale ? (
                <span className="text-xs text-muted-foreground">Checking...</span>
              ) : !tailscaleStatus.available ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => openUrl("https://tailscale.com/download")}
                  className="text-xs h-7 px-3 font-semibold"
                >
                  Install Tailscale
                </Button>
              ) : !tailscaleStatus.running ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => openUrl("https://tailscale.com/download")}
                  className="text-xs h-7 px-3 font-semibold"
                >
                  Open Tailscale
                </Button>
              ) : (
                <span className="text-xs text-success font-semibold flex items-center gap-1 bg-success/10 border border-success/20 px-2.5 py-1 rounded-full">
                  <ShieldCheckIcon className="size-3.5 text-success" />
                  Connected
                </span>
              )}
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Remote Environments"
        headerAction={
          <Dialog
            onOpenChange={(open) => {
              if (open) setGuideStep(1);
            }}
          >
            <DialogTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-5 text-muted-foreground hover:text-foreground"
                >
                  <InfoIcon className="size-3.5" />
                </Button>
              }
            />
            <DialogContent className="max-w-[520px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-[18px]">
                  <MonitorIcon className="size-5 text-primary" />
                  Connections Guide
                </DialogTitle>
                <DialogDescription className="text-[13px]">
                  Setup Steps — Step {guideStep} of 4
                </DialogDescription>
              </DialogHeader>
              <DialogPanel className="space-y-6 pt-5 pb-3">
                {guideStep === 1 && (
                  <div className="space-y-4 text-center py-4">
                    <div className="mx-auto size-16 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                      <MonitorIcon className="size-8" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[16px] font-bold text-foreground">
                        1. Expose Host Environment
                      </h4>
                      <p className="text-[13px] text-muted-foreground leading-relaxed px-6">
                        Navigate to the target remote server's settings panel, switch to{" "}
                        <strong>Connections</strong>, and enable the <strong>Network Access</strong>{" "}
                        toggle.
                      </p>
                    </div>
                  </div>
                )}

                {guideStep === 2 && (
                  <div className="space-y-4 text-center py-4">
                    <div className="mx-auto size-16 rounded-full bg-success/10 flex items-center justify-center border border-success/20 text-success">
                      <ShieldCheckIcon className="size-8" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[16px] font-bold text-foreground">
                        2. Configure Secure Mesh (Tailscale)
                      </h4>
                      <p className="text-[13px] text-muted-foreground leading-relaxed px-6">
                        Ensure Tailscale is installed and running on both devices to map a secure
                        encrypted connection without firewall modifications.
                      </p>
                    </div>
                  </div>
                )}

                {guideStep === 3 && (
                  <div className="space-y-4 text-center py-4">
                    <div className="mx-auto size-16 rounded-full bg-info/10 flex items-center justify-center border border-info/20 text-info">
                      <Link2Icon className="size-8" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[16px] font-bold text-foreground">
                        3. Connect on Client Editor
                      </h4>
                      <p className="text-[13px] text-muted-foreground leading-relaxed px-6">
                        On your local machine, choose <strong>Add environment</strong>, enter the
                        remote server IP or MagicDNS address, and press connect.
                      </p>
                    </div>
                  </div>
                )}

                {guideStep === 4 && (
                  <div className="space-y-4 text-center py-4">
                    <div className="mx-auto size-16 rounded-full bg-success/10 flex items-center justify-center border border-success/20 text-success">
                      <LockIcon className="size-8" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[16px] font-bold text-foreground">
                        4. Authorize Session
                      </h4>
                      <p className="text-[13px] text-muted-foreground leading-relaxed px-6">
                        Input the pairing authorization codes to complete credentials exchange.
                        Connections are end-to-end encrypted.
                      </p>
                    </div>
                  </div>
                )}

                {/* Navigation Controls */}
                <div className="flex items-center justify-between pt-5 border-t border-border/40">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setGuideStep((s) => Math.max(1, s - 1))}
                    className={cn(
                      "text-xs h-8 gap-1 pl-1.5 pr-2.5",
                      guideStep === 1 && "invisible",
                    )}
                  >
                    <ChevronLeftIcon className="size-4" />
                    Back
                  </Button>

                  {/* Pagination Dots */}
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4].map((step) => (
                      <span
                        key={step}
                        onClick={() => setGuideStep(step)}
                        className={cn(
                          "size-1.5 rounded-full transition-all cursor-pointer",
                          guideStep === step
                            ? "bg-primary scale-125"
                            : "bg-muted-foreground/30 hover:bg-muted-foreground/50",
                        )}
                      />
                    ))}
                  </div>

                  {guideStep < 4 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setGuideStep((s) => Math.min(4, s + 1))}
                      className="text-xs h-8 gap-1 pl-2.5 pr-1.5"
                    >
                      Next
                      <ChevronRightIcon className="size-4" />
                    </Button>
                  ) : (
                    <DialogClose
                      render={
                        <Button size="sm" variant="secondary" className="text-xs h-8">
                          Finish
                        </Button>
                      }
                    />
                  )}
                </div>
              </DialogPanel>
            </DialogContent>
          </Dialog>
        }
      >
        {hasCloudPublicConfig() ? <ManagedCloudConnections /> : null}
        <div className="px-6 py-12 text-center border-t border-border/60 first:border-t-0">
          <div className="mx-auto max-w-sm space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              {savedConnections.length === 0
                ? "No saved remote environments"
                : `${savedConnections.length} saved environment${savedConnections.length === 1 ? "" : "s"}`}
            </h3>
            <p className="text-xs text-muted-foreground/80 leading-relaxed">
              Connect to remote servers, virtual machines, or other instances of the editor running
              in different environments.
            </p>
            {savedConnections.length > 0 && (
              <div className="space-y-2 pt-2 text-left">
                {savedConnections.map((connection) => (
                  <div
                    key={connection.environmentId}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5"
                  >
                    {connection.kind === "ssh" ? (
                      <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Link2Icon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-foreground">
                        {connection.label}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {connection.kind.toUpperCase()} · {connection.environmentId}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Connect to ${connection.label}`}
                      onClick={async () => {
                        try {
                          await connectEnvironmentApi(connection.environmentId);
                          setConnectedIds(new Set(connectedEnvironmentIds()));
                        } catch (error) {
                          toastManager.add({
                            title: "Could not connect",
                            description:
                              error instanceof Error ? error.message : "Connection failed.",
                            type: "error",
                          });
                        }
                      }}
                    >
                      {connectedIds.has(connection.environmentId) ? "Connected" : "Connect"}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${connection.label}`}
                      onClick={async () => {
                        disconnectEnvironmentApi(connection.environmentId);
                        await removeManualConnection(connection.environmentId);
                        setSavedConnections(await listManualConnections());
                        setConnectedIds(new Set(connectedEnvironmentIds()));
                      }}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-2">
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8 gap-1.5 font-semibold"
                    >
                      <PlusIcon className="size-3.5" />
                      Add environment
                    </Button>
                  }
                />
                <DialogContent className="max-w-[520px]">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-[18px]">
                      <MonitorIcon className="size-5 text-primary" />
                      Add Environment
                    </DialogTitle>
                    <DialogDescription className="text-[13px]">
                      Pair another environment directly or through SSH.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogPanel className="space-y-6 pt-2 pb-3">
                    <>
                      {/* Connection Type Toggle */}
                      <div
                        className="tabs-segmented grid grid-cols-2"
                        role="group"
                        aria-label="Connection type"
                      >
                        <button
                          type="button"
                          onClick={() => setAddMode("remote")}
                          aria-pressed={addMode === "remote"}
                          className={cn(
                            "flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all",
                            addMode === "remote"
                              ? "font-semibold"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Link2Icon className="size-3.5" />
                          Remote link
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddMode("ssh")}
                          aria-pressed={addMode === "ssh"}
                          className={cn(
                            "flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all",
                            addMode === "ssh"
                              ? "font-semibold"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <TerminalIcon className="size-3.5" />
                          SSH Connection
                        </button>
                      </div>

                      {/* Fields */}
                      {addMode === "remote" ? (
                        <div className="space-y-4 text-left">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-foreground">
                              Backend Host Address
                            </label>
                            <Input
                              aria-label="Remote backend address"
                              aria-required="true"
                              value={remoteHost}
                              onChange={(e) => setRemoteHost(e.target.value)}
                              placeholder="e.g. https://my-server.tailnet.ts.net"
                              className="text-xs h-9 bg-background/50"
                            />
                            <span className="text-[11px] text-muted-foreground block mt-0.5">
                              Enter the URL or MagicDNS address of your remote editor instance.
                            </span>
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-foreground">
                              Pairing Code
                            </label>
                            <Input
                              aria-label="Pairing code"
                              aria-required="true"
                              type="password"
                              value={pairingCode}
                              onChange={(e) => setPairingCode(e.target.value)}
                              placeholder="Enter pairing verification token"
                              className="text-xs h-9 bg-background/50"
                            />
                            <span className="text-[11px] text-muted-foreground block mt-0.5">
                              The access token shown in the host environment settings.
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 text-left">
                          <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2 space-y-1">
                              <label className="text-xs font-semibold text-foreground">
                                SSH Host / Alias
                              </label>
                              <Input
                                aria-label="SSH host or alias"
                                aria-required="true"
                                value={sshHost}
                                onChange={(e) => setSshHost(e.target.value)}
                                placeholder="e.g. user@hostname"
                                className="text-xs h-9 bg-background/50"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-semibold text-foreground">Port</label>
                              <Input
                                aria-label="SSH port"
                                aria-required="true"
                                inputMode="numeric"
                                value={sshPort}
                                onChange={(event) => setSshPort(event.target.value)}
                                placeholder="22"
                                className="text-xs h-9 bg-background/50"
                              />
                            </div>
                          </div>
                          <span className="text-[11px] text-muted-foreground block">
                            Uses local SSH config files, credentials, and secure port-forwarding
                            tunnels.
                          </span>
                        </div>
                      )}

                      {/* Footer Actions */}
                      <div className="flex items-center justify-end gap-2 pt-5 border-t border-border/40">
                        <DialogClose
                          render={
                            <Button size="sm" variant="ghost" className="text-xs h-8">
                              Cancel
                            </Button>
                          }
                        />
                        <Button
                          size="sm"
                          variant="default"
                          onClick={handleAddEnvironment}
                          disabled={
                            isSavingConnection ||
                            (addMode === "remote"
                              ? validateRemoteHost(remoteHost) !== null || !pairingCode.trim()
                              : validateSshTarget(sshHost) !== null ||
                                validateSshPort(sshPort) !== null)
                          }
                          className="text-xs h-8 font-semibold"
                        >
                          {isSavingConnection && (
                            <LoaderCircleIcon className="mr-1 size-3.5 animate-spin" />
                          )}
                          {isSavingConnection ? "Connecting…" : "Add environment"}
                        </Button>
                      </div>
                    </>
                  </DialogPanel>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </SettingsSection>

      <p className="text-xs text-muted-foreground/60 px-0.5">
        Remote environments let Tabs connect to other machines, VMs, or instances running the
        editor. Use Tailscale for secure encrypted access without port forwarding.
      </p>
    </div>
  );
}
