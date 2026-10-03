import { useCallback, useEffect, useState } from "react";
import type { DesktopBuildInfo, DesktopCodeHostState, DesktopUpdateState } from "@tabs/contracts";
import {
  type DesktopUpdateButtonAction,
  describeDesktopUpdate,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";
import { isElectron } from "../../env";
import { APP_VERSION } from "../../branding";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { DesktopUpdateReleaseNotes } from "../DesktopUpdateReleaseNotes";
import { SettingsRow, SettingsSection, SettingsSectionHeader } from "./SettingsLayout";

const TABS_RELEASES_URL = "https://github.com/PanicMako/Tabs-ide/releases";
const RESET_CONFIRMATION_PHRASE = "DELETE TABS DATA";

type DesktopOsKind = "mac" | "windows" | "linux" | "unknown";

function detectDesktopOs(): DesktopOsKind {
  if (typeof navigator === "undefined") return "unknown";
  const ua = `${navigator.userAgent} ${navigator.platform ?? ""}`.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "unknown";
}

function uninstallInstructions(os: DesktopOsKind): string[] {
  switch (os) {
    case "mac":
      return [
        "Quit Tabs.",
        "Open Finder → Applications and drag Tabs to the Trash.",
        "Optional: delete ~/.tabs to remove the cached editor runtime (~1.6 GB).",
      ];
    case "windows":
      return [
        "Quit Tabs.",
        "Open Settings → Apps → Installed apps, find Tabs and choose Uninstall.",
        "Optional: delete %USERPROFILE%\\.tabs to remove the cached editor runtime.",
      ];
    case "linux":
      return [
        "Quit Tabs.",
        "Delete the AppImage you downloaded (or remove the package via your package manager).",
        "Optional: delete ~/.tabs to remove the cached editor runtime.",
      ];
    default:
      return [
        "Quit Tabs, then remove the application using your operating system's standard uninstall flow.",
        "Optional: delete the ~/.tabs folder to remove the cached editor runtime.",
      ];
  }
}

function desktopUpdateButtonLabel(action: DesktopUpdateButtonAction): string {
  if (action === "install") return "Restart & install";
  if (action === "download") return "Download update";
  return "";
}

function DesktopUpdateControl({
  state,
  runUpdateAction,
}: {
  readonly state: DesktopUpdateState;
  readonly runUpdateAction: (action: DesktopUpdateButtonAction) => void;
}) {
  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "none") {
    if (state.status === "disabled" || state.status === "error") {
      return (
        <Button
          size="xs"
          variant="outline"
          className="cursor-pointer"
          onClick={() => void window.desktopBridge?.openExternal(TABS_RELEASES_URL)}
        >
          View releases
        </Button>
      );
    }
    return (
      <div className="flex items-center gap-1">
        <DesktopUpdateReleaseNotes state={state} />
        <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {state.status === "checking"
            ? "Checking…"
            : state.status === "downloading"
              ? "Downloading…"
              : state.status === "installing"
                ? "Preparing to restart…"
                : "Up to date"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <DesktopUpdateReleaseNotes state={state} />
      <Button
        size="xs"
        variant="outline"
        className="cursor-pointer"
        disabled={isDesktopUpdateButtonDisabled(state)}
        title={getDesktopUpdateButtonTooltip(state)}
        onClick={() => runUpdateAction(action)}
      >
        {desktopUpdateButtonLabel(action)}
      </Button>
    </div>
  );
}

export function AboutSettings() {
  const [showBuildDetails, setShowBuildDetails] = useState(false);
  const [buildInfo, setBuildInfo] = useState<DesktopBuildInfo | null>(null);
  useEffect(() => {
    let active = true;
    void window.desktopBridge
      ?.getBuildInfo?.()
      .then((info) => {
        if (active) setBuildInfo(info);
      })
      .catch(() => {
        if (active) setBuildInfo(null);
      });
    return () => {
      active = false;
    };
  }, []);
  const [codeHostState, setCodeHostState] = useState<DesktopCodeHostState | null>(null);
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    let cancelled = false;
    void bridge.getCodeHostState().then(
      (state) => {
        if (!cancelled) setCodeHostState(state);
      },
      () => {
        if (!cancelled) setCodeHostState(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const [updateActionError, setUpdateActionError] = useState<string | null>(null);
  const [resetDialogStep, setResetDialogStep] = useState<"review" | "confirm" | null>(null);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetActionError, setResetActionError] = useState<string | null>(null);
  const [resetStartupError, setResetStartupError] = useState<string | null>(null);
  const [resetInProgress, setResetInProgress] = useState(false);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    let cancelled = false;
    void bridge.getUpdateState().then((next) => {
      if (!cancelled) setUpdateState(next);
    });
    const unsubscribe = bridge.onUpdateState((next) => {
      if (!cancelled) setUpdateState(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getDataResetStartupError) return;
    let cancelled = false;
    void bridge
      .getDataResetStartupError()
      .then((message) => {
        if (!cancelled) setResetStartupError(message);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResetStartupError(
            error instanceof Error ? error.message : "Could not verify the previous reset.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runUpdateAction = useCallback((action: DesktopUpdateButtonAction) => {
    const bridge = window.desktopBridge;
    if (!bridge || action === "none") return;
    setUpdateActionError(null);
    const run = action === "install" ? bridge.installUpdate() : bridge.downloadUpdate();
    void run
      .then((result) => {
        setUpdateState(result.state);
        setUpdateActionError(getDesktopUpdateActionError(result));
      })
      .catch((error: unknown) => {
        setUpdateActionError(error instanceof Error ? error.message : "Update action failed.");
      });
  }, []);

  const beginDataReset = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge?.resetTabsUserData) {
      setResetActionError("This Tabs build does not support resetting local data.");
      return;
    }
    setResetActionError(null);
    setResetInProgress(true);
    try {
      const started = await bridge.resetTabsUserData();
      if (!started) {
        throw new Error("Tabs could not start the data reset. Close any pop-out window and retry.");
      }
      setResetDialogStep(null);
    } catch (error) {
      setResetActionError(error instanceof Error ? error.message : "Could not reset Tabs data.");
      setResetInProgress(false);
      setResetDialogStep(null);
    }
  }, []);

  const closeResetDialog = useCallback(() => {
    if (resetInProgress) return;
    setResetDialogStep(null);
    setResetPhrase("");
  }, [resetInProgress]);

  const isPrimaryWindow = !window.desktopBridge?.isPopout;

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="About"
        description="Application build details, software updates, and diagnostic information."
      />

      <SettingsSection title="Application Details">
        <SettingsRow
          title="Version"
          description="Public Beta · Active development. Expect some bugs and rough edges."
          control={
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showBuildDetails}
              onClick={() => setShowBuildDetails((shown) => !shown)}
            >
              {showBuildDetails
                ? `${APP_VERSION} · ${buildInfo?.channel ?? "beta"} · ${buildInfo?.commit ?? "build unknown"}`
                : APP_VERSION}
            </Button>
          }
          status={
            showBuildDetails && buildInfo ? (
              <span>
                {buildInfo.platform} · {buildInfo.arch} · Electron {buildInfo.electron}
              </span>
            ) : null
          }
        />

        {isElectron ? (
          <SettingsRow
            title="Code-OSS version"
            description="The embedded editor runtime selected by this Tabs installation."
            control={
              <code className="text-xs font-medium text-muted-foreground">
                {codeHostState?.version ??
                  (codeHostState?.available === false ? "Unavailable" : "Unknown")}
              </code>
            }
          />
        ) : null}

        {isElectron && updateState ? (
          <SettingsRow
            title="Software update"
            description={describeDesktopUpdate(updateState)}
            status={
              updateActionError ? (
                <span className="text-destructive">{updateActionError}</span>
              ) : updateState.status === "downloading" &&
                typeof updateState.downloadPercent === "number" ? (
                <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-border">
                  <div
                    role="progressbar"
                    aria-label="Downloading Tabs update"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.floor(updateState.downloadPercent)}
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{
                      width: `${Math.floor(updateState.downloadPercent)}%`,
                    }}
                  />
                </div>
              ) : null
            }
            control={<DesktopUpdateControl state={updateState} runUpdateAction={runUpdateAction} />}
          />
        ) : null}

        {isElectron ? (
          <SettingsRow
            title="Uninstall Tabs"
            description="Remove Tabs from this computer."
            status={
              <ol className="ms-4 list-decimal space-y-0.5">
                {uninstallInstructions(detectDesktopOs()).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            }
          />
        ) : null}
        <SettingsRow
          title="Beta feedback"
          description="Include reproduction steps and sanitized diagnostics. Never share credentials, private code, or prompts."
          control={
            <Button
              variant="outline"
              render={
                <a
                  href="https://github.com/PanicMako/Tabs-ide/issues/new?template=bug_report.yml"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              Report a Bug
            </Button>
          }
        />
        <SettingsRow
          title="Basic diagnostics"
          description="Copies only version, platform, browser runtime, and editor version; no logs, provider identifiers, paths, or credentials."
          control={
            <Button
              variant="outline"
              onClick={() => {
                const summary = `Tabs ${APP_VERSION} (Public Beta)\nPlatform: ${window.desktopBridge?.getClientPlatform?.() ?? "unknown"}\nBuild: ${buildInfo?.commit ?? "unknown"}\nArchitecture: ${buildInfo?.arch ?? "unknown"}\nElectron: ${buildInfo?.electron ?? "unknown"}\nCode-OSS: ${codeHostState?.version ?? "unknown"}`;
                void navigator.clipboard
                  .writeText(summary)
                  .catch(() => setUpdateActionError("Could not copy diagnostics. Try again."));
              }}
            >
              Copy Diagnostics
            </Button>
          }
        />
      </SettingsSection>

      {isElectron && isPrimaryWindow && window.desktopBridge?.resetTabsUserData ? (
        <SettingsSection
          title="Reset local data"
          description="Start Tabs again with a clean local profile and the first-run setup wizard."
        >
          <SettingsRow
            title="Reset Tabs data"
            description="Remove local projects, threads, settings, Tabs-stored credentials, saved connections, browser-profile data, attachments, and caches. Tabs will restart and show the setup wizard."
            status={
              resetStartupError ? (
                <p className="text-destructive" role="alert">
                  The last reset did not finish: {resetStartupError} You can retry it below.
                </p>
              ) : resetActionError ? (
                <p className="text-destructive" role="alert">
                  {resetActionError}
                </p>
              ) : resetInProgress ? (
                <p role="status" aria-live="polite">
                  Tabs is closing to clear local data, then it will reopen.
                </p>
              ) : null
            }
            control={
              <Button
                variant="destructive-outline"
                disabled={resetInProgress}
                onClick={() => {
                  setResetActionError(null);
                  setResetPhrase("");
                  setResetDialogStep("review");
                }}
              >
                Reset Tabs data…
              </Button>
            }
          />
        </SettingsSection>
      ) : null}

      <AlertDialog
        open={resetDialogStep !== null}
        onOpenChange={(open) => {
          if (!open) closeResetDialog();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resetDialogStep === "confirm"
                ? "Confirm complete data reset"
                : "Reset all local Tabs data?"}
            </AlertDialogTitle>
            {resetDialogStep === "confirm" ? (
              <AlertDialogDescription>
                This will permanently remove Tabs’ local projects and threads, settings, saved
                connections, Tabs-stored credentials, attachments, and browser-profile site data.
                Tabs will restart and open the first-run setup wizard.
              </AlertDialogDescription>
            ) : (
              <AlertDialogDescription>
                This is permanent. Tabs will remove its local project and thread records, local
                settings and credentials, attachments, saved connections, browser-profile site data,
                caches, and logs. The app will then restart as a fresh setup.
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>

          {resetDialogStep === "review" ? (
            <div className="space-y-2 px-6 pb-5 text-sm">
              <p className="font-medium">These stay on this computer:</p>
              <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                <li>Project files and managed Git worktrees.</li>
                <li>
                  The downloaded Code OSS runtime and its editor settings, profiles, and extensions.
                </li>
                <li>OS-level accounts and data stored by remote services.</li>
              </ul>
              <p className="text-muted-foreground">
                Tabs-stored credentials and local connection entries are removed. You may need to
                reconnect remote environments and sign in to browser profiles again.
              </p>
            </div>
          ) : (
            <form
              className="space-y-3 px-6 pb-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (resetPhrase === RESET_CONFIRMATION_PHRASE) void beginDataReset();
              }}
            >
              <label className="block space-y-2 text-sm" htmlFor="reset-tabs-data-confirmation">
                Type <code className="font-semibold">{RESET_CONFIRMATION_PHRASE}</code> to continue.
                <Input
                  id="reset-tabs-data-confirmation"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={resetPhrase}
                  onChange={(event) => setResetPhrase(event.target.value)}
                  aria-describedby="reset-tabs-data-phrase-help"
                />
              </label>
              <p id="reset-tabs-data-phrase-help" className="text-xs text-muted-foreground">
                Code OSS state and all project/worktree files are preserved.
              </p>
            </form>
          )}

          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" disabled={resetInProgress} onClick={closeResetDialog} />
              }
            >
              Cancel
            </AlertDialogClose>
            {resetDialogStep === "review" ? (
              <Button variant="destructive" onClick={() => setResetDialogStep("confirm")}>
                Continue to final confirmation
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={resetPhrase !== RESET_CONFIRMATION_PHRASE || resetInProgress}
                onClick={() => void beginDataReset()}
              >
                Delete Tabs data and restart
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

export default AboutSettings;
