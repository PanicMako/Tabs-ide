import { describe, expect, it } from "vitest";
import { appAtomRegistry } from "../state/atomRegistry";
import { manualOnboardingActiveAtom, openWelcomeWizard, closeWelcomeWizard } from "./firstRun";

describe("manual onboarding state atom", () => {
  it("defaults to false", () => {
    appAtomRegistry.set(manualOnboardingActiveAtom, false);
    expect(appAtomRegistry.get(manualOnboardingActiveAtom)).toBe(false);
  });

  it("opens welcome wizard when openWelcomeWizard is called", () => {
    appAtomRegistry.set(manualOnboardingActiveAtom, false);
    openWelcomeWizard();
    expect(appAtomRegistry.get(manualOnboardingActiveAtom)).toBe(true);
  });

  it("closes welcome wizard when closeWelcomeWizard is called", () => {
    appAtomRegistry.set(manualOnboardingActiveAtom, true);
    closeWelcomeWizard();
    expect(appAtomRegistry.get(manualOnboardingActiveAtom)).toBe(false);
  });
});
