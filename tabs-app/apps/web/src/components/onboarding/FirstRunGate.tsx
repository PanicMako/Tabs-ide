import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import {
  closeWelcomeWizard,
  manualOnboardingActiveAtom,
  useCompleteOnboarding,
} from "../../onboarding/firstRun";
import {
  type FirstRunGateState,
  isFreshFirstRunWorkspace,
  resolveFirstRunDecision,
  transitionFirstRunGateState,
} from "../../onboarding/firstRun.logic";
import { readModelStateAtom } from "../../state/readModel";
import { useClientSettings } from "../../state/settings";
import { threadsHydratedAtom } from "../../state/threads";
import { WelcomeWizard } from "./WelcomeWizard";

const FIRST_RUN_DECISION_TIMEOUT_MS = 4_000;

export interface FirstRunGateProps {
  readonly enabled?: boolean;
  readonly children: React.ReactNode;
}

export function FirstRunGate({ enabled = true, children }: FirstRunGateProps) {
  const clientSettings = useClientSettings();
  const onboardingCompletedAt = clientSettings.onboardingCompletedAt;
  const manualOnboardingActive = useAtomValue(manualOnboardingActiveAtom);
  const threadsHydrated = useAtomValue(threadsHydratedAtom);
  const readModel = useAtomValue(readModelStateAtom);
  const completeOnboarding = useCompleteOnboarding();

  const projects = readModel.projects;
  const threads = readModel.threads;

  const workspaceFresh = isFreshFirstRunWorkspace({
    projects,
    threads,
  });

  const { decision: resolvedDecision, persistCompletion } = resolveFirstRunDecision({
    enabled,
    hydrated: true,
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

    if (persistCompletion && onboardingCompletedAt === null) {
      void completeOnboarding().catch(() => undefined);
    }

    setGateState((prev) =>
      transitionFirstRunGateState(prev, {
        type: "evidence",
        decision: resolvedDecision,
      }),
    );
  }, [
    completeOnboarding,
    enabled,
    manualOnboardingActive,
    onboardingCompletedAt,
    persistCompletion,
    resolvedDecision,
  ]);

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
            closeWelcomeWizard();
            setGateState({ decision: "app", stalled: false });
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
