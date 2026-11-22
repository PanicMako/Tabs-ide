// Adapted in spirit from Orca's computer-use permission onboarding: a guided checklist whose
// status refreshes by itself when the person comes back from System Settings.
import { CheckIcon, CircleDashedIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComputerUsePermissionStatus } from "@tabs/contracts";
import { ensureNativeApi } from "~/nativeApi";
import { useGsapSurface } from "~/hooks/useGsapSurface";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel } from "../ui/collapsible";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { SettingsRow } from "./SettingsLayout";
import { computerUseReady, computerUseSetupSteps } from "./computerUsePermissionCopy";

type CheckState =
  | { readonly status: "idle" }
  | { readonly status: "checking"; readonly previous: ComputerUsePermissionStatus | null }
  | { readonly status: "done"; readonly result: ComputerUsePermissionStatus }
  | { readonly status: "failed" };

const POLL_MS = 2000;

export function ComputerUseSettingsRow() {
  const enabled = useSettings((settings) => settings.computerUseEnabled);
  const { updateSettings } = useUpdateSettings();
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const panelRef = useGsapSurface<HTMLDivElement>(undefined, "panel");
  const latest = useRef<ComputerUsePermissionStatus | null>(null);

  const check = useCallback(() => {
    setState((current) => ({
      status: "checking",
      previous: current.status === "done" ? current.result : latest.current,
    }));
    return ensureNativeApi()
      .server.computerUsePermissions()
      .then((result) => {
        latest.current = result;
        setState({ status: "done", result });
        return result;
      })
      .catch(() => {
        setState({ status: "failed" });
        return null;
      });
  }, []);

  // Check when turned on, again whenever the window regains focus (the person is back from
  // System Settings), and every couple of seconds while a required step is still open.
  useEffect(() => {
    if (!enabled) return;
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, check]);

  const result =
    state.status === "done" ? state.result : state.status === "checking" ? state.previous : null;
  const ready = result ? computerUseReady(result) : false;
  const supported = result?.platformSupported !== false;
  useEffect(() => {
    if (!enabled || !result || !supported) return;
    const everythingGranted = result.accessibility && result.screenRecording === "granted";
    if (everythingGranted) return;
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, result, supported, check]);

  const openPane = (url: string) => {
    void ensureNativeApi()
      .shell.openExternal(url)
      .catch(() =>
        toastManager.add({
          type: "error",
          title: "Could not open System Settings",
          description: "Open System Settings > Privacy & Security yourself.",
        }),
      );
  };

  const steps = result && supported ? computerUseSetupSteps(result) : [];

  return (
    <SettingsRow
      title="Computer use"
      description="Let agents work in other apps on your computer: read what is on screen, click, type and scroll. Only full-access threads can use it, and agents cannot type into password fields."
      control={
        <Switch
          aria-label="Computer use"
          checked={enabled}
          onCheckedChange={(checked) => void updateSettings({ computerUseEnabled: checked })}
        />
      }
    >
      <Collapsible open={enabled}>
        <CollapsiblePanel ref={panelRef}>
          <div className="mt-4 space-y-3" role="status" aria-live="polite">
            {state.status === "failed" ? (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Could not read permission status.</span>
                <Button size="xs" variant="outline" onClick={() => void check()}>
                  <RefreshCwIcon /> Try again
                </Button>
              </div>
            ) : !result ? (
              <p className="text-xs text-muted-foreground">Checking permissions…</p>
            ) : !supported ? (
              <p className="text-xs text-muted-foreground">
                Setup in System Settings is only needed on macOS. On Windows it uses PowerShell; on
                Linux it needs python3 with AT-SPI and xdotool.
              </p>
            ) : (
              <>
                <ol className="divide-y divide-border/60 rounded-[var(--radius-control)] border border-border/60">
                  {steps.map((step, index) => (
                    <li key={step.id} className="flex items-start gap-3 px-3 py-3">
                      <span
                        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground"
                        aria-hidden="true"
                      >
                        {step.state === "granted" ? (
                          <CheckIcon className="size-3 text-foreground" />
                        ) : (
                          <span className="text-[10px]">{index + 1}</span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p
                          className="text-sm text-foreground"
                          style={{ fontFamily: "var(--font-row, var(--font-sans))" }}
                        >
                          {step.title}
                          {step.optional ? (
                            <span className="ml-2 text-[11px] text-muted-foreground">Optional</span>
                          ) : null}
                        </p>
                        <p
                          className="text-xs leading-relaxed text-muted-foreground"
                          style={{ fontFamily: "var(--font-supporting, var(--font-sans))" }}
                        >
                          {step.detail}
                        </p>
                      </div>
                      {step.state === "granted" ? (
                        <span className="mt-0.5 text-[11px] text-muted-foreground">Allowed</span>
                      ) : (
                        <Button
                          size="xs"
                          variant={step.optional ? "outline" : "default"}
                          onClick={() => openPane(step.paneUrl)}
                        >
                          Open System Settings <ExternalLinkIcon />
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
                <div className="flex items-center gap-3 text-xs">
                  {ready ? (
                    <span className="flex items-center gap-1.5 text-foreground">
                      <CheckIcon className="size-3.5" /> Ready. Agents can use your computer.
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <CircleDashedIcon className="size-3.5" /> Waiting for Accessibility. This
                      updates by itself when you come back.
                    </span>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    disabled={state.status === "checking"}
                    onClick={() => void check()}
                  >
                    <RefreshCwIcon /> Check again
                  </Button>
                </div>
                {!ready ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    macOS may ask you to quit and reopen Tabs after you switch it on.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </SettingsRow>
  );
}
