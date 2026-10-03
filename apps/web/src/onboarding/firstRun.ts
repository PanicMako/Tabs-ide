import { Atom } from "@tabs/client-runtime/state";
import { useCallback } from "react";
import { appAtomRegistry } from "../state/atomRegistry";
import { hydrateClientSettings, updateClientSettings } from "../state/settings";

/**
 * Atom controlling whether the Welcome Wizard is forcibly open (e.g. from
 * Settings "Re-run Setup Wizard").
 */
export const manualOnboardingActiveAtom = Atom.make(false).pipe(
  Atom.withLabel("tabs-manual-onboarding-active"),
);

export function openWelcomeWizard() {
  appAtomRegistry.set(manualOnboardingActiveAtom, true);
}

export function closeWelcomeWizard() {
  appAtomRegistry.set(manualOnboardingActiveAtom, false);
}

/**
 * Marks first-run onboarding finished (or skipped) so FirstRunGate never
 * routes to the welcome wizard again automatically.
 */
export function useCompleteOnboarding(): () => Promise<void> {
  return useCallback(async () => {
    closeWelcomeWizard();
    hydrateClientSettings();
    const onboardingCompletedAt = new Date().toISOString();
    updateClientSettings((current) => ({ ...current, onboardingCompletedAt }));
  }, []);
}

/**
 * Resets the onboarding completed timestamp and opens the Welcome Wizard.
 */
export function useResetOnboarding(): () => Promise<void> {
  return useCallback(async () => {
    hydrateClientSettings();
    updateClientSettings((current) => ({ ...current, onboardingCompletedAt: null }));
    openWelcomeWizard();
  }, []);
}
