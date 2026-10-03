import { FolderSearchIcon, GitBranchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { readNativeApi } from "../nativeApi";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { validateCloneSource } from "./cloneRepositoryValidation";
import { toastManager } from "./ui/toast";

interface CloneRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the cloned folder path after a successful clone. */
  onCloned: (clonedPath: string) => void | Promise<void>;
}

/**
 * Collects a git URL + destination folder and clones via the desktop bridge
 * (the user's local git, so existing SSH keys / credential helpers apply), then
 * hands the cloned path back so the caller can open it as a project.
 */
export function CloneRepositoryDialog(props: CloneRepositoryDialogProps) {
  const [url, setUrl] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloneInFlightRef = useRef(false);

  const reset = () => {
    setUrl("");
    setParentDir(null);
    setBusy(false);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return; // don't let the dialog close mid-clone
    if (!next) reset();
    props.onOpenChange(next);
  };

  const pickDestination = async () => {
    const api = readNativeApi();
    if (!api) return;
    const dir = await api.dialogs.pickFolder();
    if (dir) {
      setParentDir(dir);
      setError(null);
    }
  };

  const validationError = validateCloneSource(url);
  const canClone = validationError === null && parentDir !== null && !busy;

  const handleClone = async () => {
    if (cloneInFlightRef.current || parentDir === null) return;
    const sourceError = validateCloneSource(url);
    if (sourceError) {
      setError(sourceError);
      return;
    }
    const api = readNativeApi();
    if (!api) {
      setError("Cloning a repository requires the desktop app.");
      return;
    }
    cloneInFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.repositories.clone({ url: url.trim(), parentDir });
      if (result.ok) {
        reset();
        props.onOpenChange(false);
        try {
          await props.onCloned(result.path);
        } catch (cause) {
          toastManager.add({
            type: "error",
            title: "Repository cloned but could not be opened",
            description: cause instanceof Error ? cause.message : String(cause),
          });
        }
      } else {
        setError(result.error);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The repository could not be cloned.");
    } finally {
      cloneInFlightRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Clone from Git</DialogTitle>
            <DialogDescription>
              Clone a repository with your local git, then open it as a project. Uses your existing
              SSH keys and credential helpers.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              aria-label="Repository URL or path"
              aria-invalid={Boolean(url.trim()) && validationError !== null}
              aria-required="true"
              value={url}
              placeholder="https://github.com/owner/repo.git"
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canClone) {
                  void handleClone();
                }
              }}
            />
            {url.trim() && validationError ? (
              <p className="text-xs text-destructive" role="alert">
                {validationError}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void pickDestination()}
              >
                <FolderSearchIcon className="size-3.5" />
                {parentDir ? "Change folder" : "Choose folder…"}
              </Button>
              <span
                className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                title={parentDir ?? undefined}
              >
                {parentDir ? `Into ${parentDir}` : "No destination chosen"}
              </span>
            </div>
            {error ? (
              <p className="text-xs font-medium text-destructive dark:text-red-400">{error}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={!canClone} onClick={() => void handleClone()}>
              {busy ? (
                <>
                  <Spinner className="size-3.5" />
                  Cloning…
                </>
              ) : (
                <>
                  <GitBranchIcon className="size-3.5" />
                  Clone
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
