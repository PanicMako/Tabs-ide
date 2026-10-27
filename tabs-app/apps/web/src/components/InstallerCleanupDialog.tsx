import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

export function InstallerCleanupDialog() {
  const [candidate, setCandidate] = useState<{ name: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void window.desktopBridge
      ?.getInstallerCleanupCandidate?.()
      .then((value) => {
        if (active && value && localStorage.getItem(`tabs:kept-installer:${value.name}`) !== "yes")
          setCandidate(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const keep = () => {
    if (busy) return;
    if (candidate) localStorage.setItem(`tabs:kept-installer:${candidate.name}`, "yes");
    setCandidate(null);
  };
  const trash = async () => {
    if (!window.desktopBridge?.trashInstalledDmg) return;
    setBusy(true);
    setError("");
    try {
      await window.desktopBridge.trashInstalledDmg();
      setCandidate(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move the installer to Trash.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={candidate !== null}
      onOpenChange={(open) => {
        if (!open) keep();
      }}
    >
      <DialogPopup showCloseButton={false} aria-describedby="installer-cleanup-description">
        <DialogHeader>
          <DialogTitle>Move the installer to Trash?</DialogTitle>
          <DialogDescription id="installer-cleanup-description">
            Tabs is running from Applications. You can now move {candidate?.name} (
            {((candidate?.size ?? 0) / 1e9).toFixed(2)} GB) from Downloads to Trash. Your installed
            app and data stay in place. Empty Trash later to reclaim the space.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" autoFocus disabled={busy} onClick={keep}>
            Keep installer
          </Button>
          <Button disabled={busy} onClick={() => void trash()}>
            {busy ? "Verifying installer…" : "Move to Trash"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
