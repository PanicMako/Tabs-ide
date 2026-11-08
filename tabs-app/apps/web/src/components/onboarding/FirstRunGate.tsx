import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { closeWelcomeWizard, manualOnboardingActiveAtom } from "../../onboarding/firstRun";
import {
  type FirstRunGateState,
  isFreshFirstRunWorkspace,
  resolveFirstRunDecision,
  transitionFirstRunGateState,
} from "../../onboarding/firstRun.logic";
import { readModelStateAtom } from "../../state/readModel";
import { isClientSettingsHydrated, useClientSettings } from "../../state/settings";
import { threadsHydratedAtom } from "../../state/threads";
import { useGuidedTourStore } from "../../stores/guidedTourStore";
import { WelcomeWizard } from "./WelcomeWizard";

const FIRST_RUN_DECISION_TIMEOUT_MS = 4_000;

export interface FirstRunGateProps {
  readonly enabled?: boolean;
  readonly children: React.ReactNode;
}

export function FirstRunGate({ enabled = true, children }: FirstRunGateProps) {
  const navigate = useNavigate();
  const clientSettings = useClientSettings();
  const onboardingCompletedAt = clientSettings.onboardingCompletedAt;
  const manualOnboardingActive = useAtomValue(manualOnboardingActiveAtom);
  const threadsHydrated = useAtomValue(threadsHydratedAtom);
  const readModel = useAtomValue(readModelStateAtom);

  const projects = readModel.projects;
  const threads = readModel.threads;

  const workspaceFresh = isFreshFirstRunWorkspace({
    projects,
    threads,
  });

  const settingsHydrated = isClientSettingsHydrated();

  const { decision: resolvedDecision } = resolveFirstRunDecision({
    enabled,
    hydrated: settingsHydrated,
    completed: onboardingCompletedAt !== null,
    threadsHydrated,
    projectCount: projects.length,
    threadCount: threads.length,
    workspaceFresh,
  });

  const [gateState, setGateState] = useState<FirstRunGateState>(() => ({
    decision: !enabled || onboardingCompletedAt !== null ? "app" : "pending",
    stalled: false,
  }));

  // Update gate state on new evidence
  useEffect(() => {
    if (!enabled) {
      setGateState({ decision: "app", stalled: false });
      return;
    }

    if (manualOnboardingActive) {
      setGateState({ decision: "wizard", stalled: false });
      return;
    }

    setGateState((prev) =>
      transitionFirstRunGateState(prev, {
        type: "evidence",
        decision: resolvedDecision,
      }),
    );
  }, [enabled, manualOnboardingActive, resolvedDecision]);

  // Stalled safety timer: after 4s timeout, transition to "app" so user is never locked out
  useEffect(() => {
    if (!enabled || gateState.decision !== "pending") return;
    const timer = window.setTimeout(() => {
      setGateState((prev) => transitionFirstRunGateState(prev, { type: "timeout" }));
    }, FIRST_RUN_DECISION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, gateState.decision]);

  // If manual onboarding was explicitly triggered or resolved to wizard
  if (manualOnboardingActive || gateState.decision === "wizard") {
    return (
      <div className="fixed inset-0 z-[9990] flex h-screen w-screen bg-background">
        <WelcomeWizard
          onDone={() => {
            const tour = useGuidedTourStore.getState();
            if (manualOnboardingActive || (!tour.isStarted && !tour.isDismissed)) {
              tour.resetTour();
            }
            closeWelcomeWizard();
            setGateState({ decision: "app", stalled: false });
            void navigate({ to: "/" });
          }}
        />
      </div>
    );
  }

  // If pending and not stalled, render children hidden or empty until resolved
  if (gateState.decision === "pending" && !gateState.stalled) {
    return null;
  }

  return <>{children}</>;
}
